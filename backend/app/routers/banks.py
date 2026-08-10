"""GoCardless bank sync and health-audit routes."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..bank_categorization import (
    apply_expense_intelligence,
    infer_transaction_category,
    load_budget_category_hints,
    looks_like_user_clean_name,
)
from ..database import get_db
from ..gocardless_bank_api import GoCardlessBankAPI, format_gocardless_error
from ..helpers import sanitize_string
from ..internal_transfers import detect_internal_transfers, mark_internal_pair, unmark_internal
from ..payroll_detect import detect_payroll_hints
from ..expense_categories import is_canonical_category, is_learnable_token, normalize_category
from ..schemas import (
    AccountLinkRequest,
    BankSyncRequest,
    LearnCategoryRuleBody,
    LearnMerchantNameBody,
    RequisitionCreate,
    SmartCleanExpensesBody,
)

logger = logging.getLogger("soberan")
router = APIRouter()

def _gc_client() -> GoCardlessBankAPI:
    secret_id = os.getenv("GOCARDLESS_SECRET_ID", "")
    secret_key = os.getenv("GOCARDLESS_SECRET_KEY", "")
    if not secret_id or not secret_key:
        raise HTTPException(status_code=503, detail="Credenciales de GoCardless no configuradas (GOCARDLESS_SECRET_ID / GOCARDLESS_SECRET_KEY).")
    return GoCardlessBankAPI(secret_id=secret_id, secret_key=secret_key)


def _parse_requisition_status(raw_status) -> str:
    if isinstance(raw_status, dict):
        return str(raw_status.get("short") or raw_status.get("long") or "").upper()
    return str(raw_status or "").upper()


def _pretty_institution_name(name: str | None, institution_id: str | None = None) -> str:
    raw = (name or institution_id or "Banco").strip()
    if not raw:
        return "Banco"
    if "_" in raw and raw.upper() == raw:
        return raw.split("_", 1)[0].title()
    return raw


def _merge_account_profile(client: GoCardlessBankAPI, gc_id: str) -> dict:
    profile: dict = {"gocardless_account_id": gc_id}
    try:
        meta = client.get_account_metadata(gc_id)
        profile.update({k: v for k, v in meta.items() if v is not None})
    except Exception as err:
        logger.warning(f"metadata for {gc_id}: {err}")
    try:
        details = client.get_account_details(gc_id)
        acc = details.get("account") or {}
        profile.update({k: v for k, v in acc.items() if v is not None})
    except Exception as err:
        logger.warning(f"details for {gc_id}: {err}")
    return profile


def _gocardless_account_label(profile: dict, institution_name: str | None = None) -> str:
    bank = _pretty_institution_name(institution_name)
    owner = str(profile.get("ownerName") or profile.get("owner_name") or "").strip()
    product = str(profile.get("product") or "").strip()
    display_name = str(profile.get("displayName") or "").strip()
    account_name = str(profile.get("name") or "").strip()
    iban = profile.get("iban")
    iban_suffix = str(iban)[-4:] if iban else None

    account_part = ""
    for candidate in (product, display_name, account_name):
        if not candidate:
            continue
        if owner and candidate.casefold() == owner.casefold():
            continue
        account_part = candidate
        break

    if account_part and iban_suffix:
        return sanitize_string(f"{bank} · {account_part} ·{iban_suffix}"[:200])
    if account_part:
        return sanitize_string(f"{bank} · {account_part}"[:200])
    if iban_suffix:
        return sanitize_string(f"{bank} · Cuenta ·{iban_suffix}"[:200])
    return sanitize_string(f"{bank} · Cuenta"[:200])


def _apply_gocardless_identity(
    acc: models.Account,
    client: GoCardlessBankAPI,
    gc_id: str,
    *,
    institution_name: str | None = None,
    profile: dict | None = None,
) -> None:
    merged = profile or _merge_account_profile(client, gc_id)
    label = _gocardless_account_label(merged, institution_name)
    if label:
        acc.alias_real = label
    iban = merged.get("iban")
    if iban:
        acc.iban = str(iban).strip().upper()
    bank = _pretty_institution_name(institution_name)
    if bank:
        acc.banco = sanitize_string(bank[:120])


_BANK_LINKED_STATUSES = {"LN", "SU", "LINKED"}


def _is_requisition_linked(status: str | None) -> bool:
    value = (status or "").upper()
    return value in _BANK_LINKED_STATUSES or value.endswith("LINKED")


def _should_import_requisition(status: str | None, account_ids: list) -> bool:
    if account_ids:
        return True
    return _is_requisition_linked(status)


def _pick_gc_balance(balances: list) -> dict | None:
    """Prefer saldo disponible actual (interim) sobre closingBooked (suele ir 1 día retrasado)."""
    if not balances:
        return None
    for balance_type in ("interimAvailable", "expected", "interimBooked", "closingBooked"):
        match = next((b for b in balances if b.get("balanceType") == balance_type), None)
        if match:
            return match
    return balances[0]


def _apply_account_balance(acc: models.Account, client: GoCardlessBankAPI, gc_id: str) -> bool:
    balances_data = client.get_account_balances(gc_id)
    balances = balances_data.get("balances", [])
    picked = _pick_gc_balance(balances)
    if picked:
        acc.balance_actual = float(picked["balanceAmount"]["amount"])
        return True
    return False


def _load_category_rules(db: Session) -> dict:
    category_rules_row = db.query(models.UserSettings).filter(models.UserSettings.key == "category_rules").first()
    try:
        return json.loads(category_rules_row.value) if category_rules_row and category_rules_row.value else {}
    except json.JSONDecodeError:
        return {}


def _save_category_rules(db: Session, rules: dict) -> None:
    row = db.query(models.UserSettings).filter(models.UserSettings.key == "category_rules").first()
    payload = json.dumps(rules, ensure_ascii=False)
    if row:
        row.value = payload
    else:
        db.add(models.UserSettings(key="category_rules", value=payload))
    db.commit()


def _load_merchant_names(db: Session) -> dict:
    row = db.query(models.UserSettings).filter(models.UserSettings.key == "merchant_names").first()
    try:
        return json.loads(row.value) if row and row.value else {}
    except json.JSONDecodeError:
        return {}


def _save_merchant_names(db: Session, names: dict) -> None:
    row = db.query(models.UserSettings).filter(models.UserSettings.key == "merchant_names").first()
    payload = json.dumps(names, ensure_ascii=False)
    if row:
        row.value = payload
    else:
        db.add(models.UserSettings(key="merchant_names", value=payload))
    db.commit()


def _stable_gc_tx_id(gc_account_id: str, tx: dict, amount: float, tx_date: datetime, description: str) -> str:
    gc_tx_id = tx.get("transactionId") or tx.get("internalTransactionId")
    if gc_tx_id:
        return str(gc_tx_id)
    raw = f"{gc_account_id}|{tx_date.isoformat()}|{amount:.4f}|{description}"
    return f"hash_{hashlib.sha256(raw.encode()).hexdigest()[:40]}"


def _categorize(description: str, amount: float, hints: list[dict], rules: dict) -> str:
    return infer_transaction_category(description, amount, hints, rules)


def _apply_expense_intelligence_to_model(
    tx: models.Transaction,
    hints: list[dict],
    rules: dict,
    merchant_names: dict,
    *,
    allow_heuristic_rename: bool = True,
) -> tuple[bool, bool]:
    """Mutate tx in place. Returns (categorized, renamed)."""
    result = apply_expense_intelligence(
        amount=float(tx.amount or 0),
        description=tx.description_raw or "",
        category=tx.category_anon or "",
        hints=hints,
        category_rules=rules,
        merchant_names=merchant_names,
        es_interna=bool(getattr(tx, "es_interna", False)),
        es_pending=bool(getattr(tx, "es_pending", False)),
        excluida_presupuesto=bool(getattr(tx, "excluida_presupuesto", False)),
        allow_heuristic_rename=allow_heuristic_rename,
    )
    categorized = False
    renamed = False
    if result["categorized"] and result["category"] != (tx.category_anon or ""):
        tx.category_anon = sanitize_string(result["category"])
        categorized = True
    if result["renamed"] and result["description"] != (tx.description_raw or ""):
        tx.description_raw = sanitize_string(str(result["description"])[:_DESC_MAX])
        renamed = True
    return categorized, renamed


def _apply_gc_fields_to_tx(
    existing: models.Transaction,
    amount: float,
    tx_date: datetime,
    description: str,
    es_pending: bool,
    hints: list[dict],
    rules: dict,
    merchant_names: dict | None = None,
) -> bool:
    changed = False
    names = merchant_names if merchant_names is not None else {}
    if existing.amount != amount:
        existing.amount = amount
        changed = True
    if tx_date and existing.date != tx_date:
        existing.date = tx_date
        changed = True
    # Do not clobber a user-cleaned expense name with a richer bank dump
    if looks_like_user_clean_name(existing.description_raw) and float(amount or 0) < 0:
        pass
    elif _should_refresh_description(existing.description_raw, description):
        existing.description_raw = sanitize_string(description[:_DESC_MAX])
        changed = True
    if es_pending and not existing.es_pending:
        existing.es_pending = True
        changed = True
    elif not es_pending and existing.es_pending:
        existing.es_pending = False
        changed = True
    if not existing.es_interna:
        raw_cat = (existing.category_anon or "").strip()
        if raw_cat:
            normalized = normalize_category(raw_cat)
            if normalized and normalized != raw_cat and is_canonical_category(normalized):
                existing.category_anon = sanitize_string(normalized)
                changed = True
            elif not normalized and raw_cat:
                # General / Sin categoría → empty
                existing.category_anon = ""
                changed = True
        if not (existing.category_anon or "").strip():
            category = _categorize(existing.description_raw or description, amount, hints, rules)
            if category:
                existing.category_anon = sanitize_string(category)
                changed = True
        cat_applied, name_applied = _apply_expense_intelligence_to_model(
            existing, hints, rules, names, allow_heuristic_rename=True,
        )
        if cat_applied or name_applied:
            changed = True
    return changed


def _find_pending_match(
    db: Session,
    account_id: int,
    amount: float,
    tx_date: datetime,
) -> models.Transaction | None:
    start = tx_date - timedelta(days=5)
    end = tx_date + timedelta(days=1)
    return (
        db.query(models.Transaction)
        .filter(
            models.Transaction.account_id == account_id,
            models.Transaction.es_pending == True,
            models.Transaction.amount == amount,
            models.Transaction.date >= start,
            models.Transaction.date <= end,
        )
        .order_by(models.Transaction.date.desc())
        .first()
    )


def _import_gc_tx_list(
    db: Session,
    acc: models.Account,
    gc_id: str,
    booked: list,
    hints: list[dict],
    rules: dict,
    *,
    es_pending: bool = False,
    merchant_names: dict | None = None,
) -> tuple[int, int]:
    created_count = 0
    updated_count = 0
    names = merchant_names if merchant_names is not None else {}
    for tx in booked:
        amount_info = tx.get("transactionAmount", {})
        amount = float(amount_info.get("amount", 0))
        booking_date_str = tx.get("bookingDate") or tx.get("valueDate")
        tx_date = _parse_gocardless_tx_date(booking_date_str)
        description = _gocardless_tx_description(tx)
        gc_tx_id = _stable_gc_tx_id(gc_id, tx, amount, tx_date, description)

        existing = db.query(models.Transaction).filter(
            models.Transaction.gocardless_tx_id == gc_tx_id
        ).first()
        if existing:
            if _apply_gc_fields_to_tx(
                existing, amount, tx_date, description, es_pending, hints, rules, names,
            ):
                updated_count += 1
            continue

        if not es_pending:
            pending_match = _find_pending_match(db, acc.id, amount, tx_date)
            if pending_match:
                pending_match.gocardless_tx_id = gc_tx_id
                _apply_gc_fields_to_tx(
                    pending_match, amount, tx_date, description, False, hints, rules, names,
                )
                updated_count += 1
                continue

        category = _categorize(description, amount, hints, rules)
        new_tx = models.Transaction(
            account_id=acc.id,
            amount=amount,
            category_anon=sanitize_string(category),
            description_raw=sanitize_string(str(description)[:_DESC_MAX]),
            date=tx_date,
            gocardless_tx_id=gc_tx_id,
            es_pending=es_pending,
        )
        _apply_expense_intelligence_to_model(new_tx, hints, rules, names)
        db.add(new_tx)
        created_count += 1
    return created_count, updated_count


def _resolve_date_from(db: Session, account_id: int, date_from: str | None) -> str | None:
    if date_from:
        return date_from
    now = datetime.utcnow()
    lookback_start = now - timedelta(days=31)
    last_tx = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.account_id == account_id,
            models.Transaction.gocardless_tx_id.isnot(None),
        )
        .order_by(models.Transaction.date.desc())
        .first()
    )
    if last_tx and last_tx.date:
        extended = last_tx.date - timedelta(days=14)
        if extended < lookback_start:
            lookback_start = extended
    else:
        lookback_start = now - timedelta(days=90)
    return lookback_start.date().isoformat()


def _parse_gocardless_tx_date(raw: str | None) -> datetime:
    if not raw:
        return datetime.utcnow()
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        pass
    try:
        return datetime.strptime(raw[:10], "%Y-%m-%d")
    except ValueError:
        return datetime.utcnow()


_DESC_MAX = 900

_PLACEHOLDER_DESCRIPTIONS = frozenset({
    "",
    "importado gocardless",
    "importado",
    "movimiento bancario",
})

_GENERIC_BANK_CODES = frozenset({
    "pmnt",
    "pmnt-icdt",
    "pmnt-rcdt",
    "pmnt-irct",
    "pmnt-icdt-stdo",
    "pmnt-irct-stdo",
})


def _normalize_gc_space(text: str) -> str:
    return " ".join(text.split()).strip()


def _first_gc_text(*values) -> str | None:
    collected = _collect_gc_texts(*values)
    return collected[0] if collected else None


def _dict_gc_text_values(data: dict) -> list[str]:
    preferred = (
        "name",
        "iban",
        "bban",
        "reference",
        "unstructured",
        "additionalRemittanceInformation",
        "identification",
        "proprietary",
        "issuer",
    )
    texts: list[str] = []
    for key in preferred:
        val = data.get(key)
        if isinstance(val, str):
            texts.append(val)
        elif isinstance(val, dict):
            texts.extend(_dict_gc_text_values(val))
    return texts


def _collect_gc_texts(*values) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        chunks: list[str] = []
        if value is None:
            continue
        if isinstance(value, str):
            chunks = [value]
        elif isinstance(value, (list, tuple)):
            for item in value:
                if isinstance(item, str):
                    chunks.append(item)
                elif isinstance(item, dict):
                    chunks.extend(_dict_gc_text_values(item))
        elif isinstance(value, dict):
            chunks.extend(_dict_gc_text_values(value))
        for chunk in chunks:
            cleaned = _normalize_gc_space(chunk)
            if not cleaned:
                continue
            key = cleaned.casefold()
            if key in seen:
                continue
            seen.add(key)
            out.append(cleaned)
    return out


def _append_unique_desc_part(parts: list[str], candidate: str | None) -> None:
    if not candidate:
        return
    text = _normalize_gc_space(candidate)
    if not text:
        return
    low = text.casefold()
    for i, existing in enumerate(parts):
        el = existing.casefold()
        if low == el:
            return
        if low in el:
            return
        if el in low:
            parts[i] = text
            return
    parts.append(text)


def _account_tail(account) -> str | None:
    if not isinstance(account, dict):
        return None
    raw = account.get("iban") or account.get("bban")
    if not isinstance(raw, str):
        return None
    cleaned = raw.replace(" ", "").upper()
    if len(cleaned) < 4:
        return cleaned or None
    return f"…{cleaned[-4:]}"


def _bank_transaction_code_label(raw) -> str | None:
    if isinstance(raw, str):
        cleaned = _normalize_gc_space(raw)
        return cleaned or None
    if isinstance(raw, dict):
        codes = [
            str(raw.get(k)).strip()
            for k in ("domainCode", "familyCode", "subFamilyCode")
            if raw.get(k) is not None and str(raw.get(k)).strip()
        ]
        if codes:
            return "-".join(codes)
    return None


def _is_placeholder_description(description: str | None) -> bool:
    return (description or "").strip().lower() in _PLACEHOLDER_DESCRIPTIONS


def _should_refresh_description(existing: str | None, new: str) -> bool:
    old = (existing or "").strip()
    new_desc = (new or "").strip()
    if not new_desc or new_desc.casefold() == "movimiento bancario":
        return False
    if _is_placeholder_description(old):
        return True
    if old == new_desc:
        return False
    old_l = old.casefold()
    new_l = new_desc.casefold()
    if len(new_desc) > len(old) and (old_l in new_l or new_l.startswith(old_l)):
        return True
    # Cryptic bank leftovers → richer payload on a later sync
    if len(old) <= 28 and len(new_desc) >= len(old) + 10:
        return True
    return False


def _gocardless_tx_description(tx: dict) -> str:
    """Build the richest human-readable label from Berlin Group / GoCardless fields."""
    amount_info = tx.get("transactionAmount") or {}
    try:
        amount = float(amount_info.get("amount", 0))
    except (TypeError, ValueError):
        amount = 0.0
    currency = amount_info.get("currency") if isinstance(amount_info, dict) else None

    remittance_parts = _collect_gc_texts(
        tx.get("remittanceInformationUnstructured"),
        tx.get("remittanceInformationUnstructuredArray"),
        tx.get("remittanceInformationStructured"),
        tx.get("remittanceInformationStructuredArray"),
    )
    remittance = " · ".join(remittance_parts) if remittance_parts else None

    creditor = _first_gc_text(tx.get("creditorName"), tx.get("ultimateCreditor"))
    debtor = _first_gc_text(tx.get("debtorName"), tx.get("ultimateDebtor"))
    if amount < 0:
        counterparty = creditor or debtor
        account_tail = _account_tail(tx.get("creditorAccount")) or _account_tail(tx.get("debtorAccount"))
    elif amount > 0:
        counterparty = debtor or creditor
        account_tail = _account_tail(tx.get("debtorAccount")) or _account_tail(tx.get("creditorAccount"))
    else:
        counterparty = _first_gc_text(creditor, debtor)
        account_tail = _account_tail(tx.get("creditorAccount")) or _account_tail(tx.get("debtorAccount"))

    extras = _collect_gc_texts(
        tx.get("additionalInformation"),
        tx.get("additionalInformationStructured"),
        tx.get("proprietaryBankTransactionCode"),
        tx.get("purposeCode"),
        tx.get("entryReference"),
        tx.get("endToEndId"),
        tx.get("mandateId"),
        tx.get("checkId"),
        tx.get("creditorId"),
        tx.get("debtorId"),
    )
    mcc = tx.get("merchantCategoryCode")
    if mcc is not None and str(mcc).strip():
        extras.append(f"MCC {str(mcc).strip()}")

    btc = _bank_transaction_code_label(tx.get("bankTransactionCode"))
    if btc and btc.casefold() not in _GENERIC_BANK_CODES:
        extras.append(btc)

    fx = tx.get("currencyExchange")
    if isinstance(fx, dict):
        instructed = fx.get("instructedAmount")
        if isinstance(instructed, dict):
            ia = instructed.get("amount")
            ic = instructed.get("currency")
            if ia is not None and ic:
                extras.append(f"{ia} {ic}")
        else:
            src = fx.get("sourceCurrency") or fx.get("unitCurrency")
            if src and currency and str(src).upper() != str(currency).upper():
                extras.append(f"FX {src}→{currency}")

    parts: list[str] = []
    _append_unique_desc_part(parts, counterparty)
    _append_unique_desc_part(parts, remittance)
    for extra in extras:
        _append_unique_desc_part(parts, extra)
    _append_unique_desc_part(parts, account_tail)
    if isinstance(currency, str) and currency.strip().upper() not in ("", "EUR"):
        _append_unique_desc_part(parts, currency.strip().upper())

    if parts:
        return " — ".join(parts)[:_DESC_MAX]
    return "Movimiento bancario"


def _import_gocardless_transactions(
    db: Session,
    acc: models.Account,
    client: GoCardlessBankAPI,
    gc_id: str,
    category_rules: dict,
    date_from: str | None,
    date_to: str | None = None,
    merchant_names: dict | None = None,
) -> tuple[int, int]:
    hints = load_budget_category_hints(db)
    names = merchant_names if merchant_names is not None else {}
    txs_data = client.get_account_transactions(gc_id, date_from=date_from, date_to=date_to)
    transactions = txs_data.get("transactions", {})
    booked = transactions.get("booked", [])
    pending = transactions.get("pending", [])

    created_booked, updated_booked = _import_gc_tx_list(
        db, acc, gc_id, booked, hints, category_rules, es_pending=False, merchant_names=names,
    )
    created_pending, updated_pending = _import_gc_tx_list(
        db, acc, gc_id, pending, hints, category_rules, es_pending=True, merchant_names=names,
    )
    return created_booked + created_pending, updated_booked + updated_pending


def _sync_bank_account(
    db: Session,
    client: GoCardlessBankAPI,
    acc: models.Account,
    category_rules: dict,
    date_from: str | None = None,
    date_to: str | None = None,
    merchant_names: dict | None = None,
) -> dict:
    gc_id = acc.gocardless_account_id
    if not gc_id:
        return {"account_id": acc.id, "alias": acc.alias_real, "created": 0, "updated": 0, "balance_updated": False}

    created_count = 0
    updated_count = 0
    balance_updated = False
    try:
        try:
            profile = _merge_account_profile(client, gc_id)
            _apply_gocardless_identity(acc, client, gc_id, institution_name=acc.banco, profile=profile)
        except Exception as identity_err:
            logger.warning(f"sync identity refresh failed for account {acc.id}: {identity_err}")

        try:
            balance_updated = _apply_account_balance(acc, client, gc_id)
        except Exception as balance_err:
            logger.warning(f"sync balance failed for account {acc.id}: {balance_err}")

        effective_from = _resolve_date_from(db, acc.id, date_from)
        try:
            created_count, updated_count = _import_gocardless_transactions(
                db, acc, client, gc_id, category_rules, effective_from,
                date_to=date_to, merchant_names=merchant_names,
            )
        except Exception as tx_err:
            logger.error(f"sync transactions failed for account {acc.id}: {tx_err}")
            raise

        acc.last_sync_at = datetime.utcnow()
        acc.last_sync_error = None
        db.commit()
        db.refresh(acc)
        internal_pairs = detect_internal_transfers(db, days=45)
        return {
            "account_id": acc.id,
            "alias": acc.alias_real,
            "created": created_count,
            "updated": updated_count,
            "balance_updated": balance_updated,
            "balance_actual": acc.balance_actual,
            "internal_pairs_detected": internal_pairs,
        }
    except Exception as err:
        logger.error(f"sync error for account {acc.id} ({gc_id}): {err}")
        db.rollback()
        friendly = format_gocardless_error(err)
        try:
            acc.last_sync_error = friendly[:500]
            db.commit()
        except Exception:
            db.rollback()
        return {"account_id": acc.id, "alias": acc.alias_real, "error": friendly}


def _import_single_account(
    db: Session,
    client: GoCardlessBankAPI,
    gc_id: str,
    institution_name: str,
    category_rules: dict | None = None,
) -> tuple[int | None, int]:
    profile = _merge_account_profile(client, gc_id)
    existing = db.query(models.Account).filter(models.Account.gocardless_account_id == gc_id).first()
    if existing:
        acc = existing
    else:
        iban = profile.get("iban")
        manual = None
        if iban:
            manual = (
                db.query(models.Account)
                .filter(
                    models.Account.iban == str(iban).strip().upper(),
                    models.Account.gocardless_account_id.is_(None),
                )
                .first()
            )
        if manual:
            acc = manual
            acc.gocardless_account_id = gc_id
        else:
            acc = models.Account(
                alias_real=_gocardless_account_label(profile, institution_name),
                alias_anonimo=f"ACC_{uuid.uuid4().hex[:6].upper()}",
                tipo="gasto",
                balance_actual=0.0,
                banco=institution_name,
                gocardless_account_id=gc_id,
                iban=str(iban).strip().upper() if iban else None,
            )
            db.add(acc)
            db.flush()

    _apply_gocardless_identity(acc, client, gc_id, institution_name=institution_name, profile=profile)
    rules = category_rules if category_rules is not None else _load_category_rules(db)
    sync_result = _sync_bank_account(db, client, acc, rules)
    if sync_result.get("error"):
        logger.warning(f"import sync partial for {gc_id}: {sync_result['error']}")
    return acc.id, int(sync_result.get("created") or 0)


def _import_requisition_accounts(
    db: Session,
    client: GoCardlessBankAPI,
    db_req: models.BankRequisition,
) -> tuple[list[int], int]:
    """Create or link Soberan accounts for every GoCardless account on a consent."""
    remote = client.get_requisition(db_req.requisition_id)
    status_str = _parse_requisition_status(remote.get("status"))
    account_ids = list(remote.get("accounts") or [])
    db_req.status = status_str or db_req.status
    if not db_req.institution_name and db_req.institution_id:
        db_req.institution_name = _pretty_institution_name(None, db_req.institution_id)
    db_req.updated_at = datetime.utcnow()
    db.commit()

    if not _should_import_requisition(status_str, account_ids):
        return [], 0

    institution_name = _pretty_institution_name(db_req.institution_name, db_req.institution_id)
    category_rules = _load_category_rules(db)
    touched: list[int] = []
    transactions_created = 0
    for gc_id in account_ids:
        try:
            account_id, tx_created = _import_single_account(
                db, client, gc_id, institution_name, category_rules
            )
            if account_id is not None:
                touched.append(account_id)
                transactions_created += tx_created
        except Exception as err:
            logger.error(f"import bank account {gc_id}: {err}")
            db.rollback()
    return touched, transactions_created


@router.get("/banks/list")
def list_banks(country: str = "ES"):
    """List supported banks for a given country via GoCardless."""
    try:
        client = _gc_client()
        return client.institution.get_institutions(country)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"list_banks error: {e}")
        raise HTTPException(status_code=502, detail=format_gocardless_error(e))


@router.post("/banks/requisition")
def create_bank_requisition(req: RequisitionCreate, db: Session = Depends(get_db)):
    """Create a GoCardless requisition (consent link) for a bank."""
    try:
        client = _gc_client()
        reference = f"soberan-{uuid.uuid4().hex[:12]}"
        result = client.create_requisition(
            institution_id=req.institution_id,
            redirect_url=req.redirect_url,
            reference=reference,
        )
        db_req = models.BankRequisition(
            requisition_id=result["id"],
            institution_id=req.institution_id,
            institution_name=req.institution_name,
            status=result.get("status", {}).get("short", "CR") if isinstance(result.get("status"), dict) else str(result.get("status", "CR")),
            link=result.get("link"),
            reference=reference,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(db_req)
        db.commit()
        db.refresh(db_req)
        return {"id": db_req.id, "requisition_id": result["id"], "link": result.get("link"), "status": db_req.status}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"create_bank_requisition error: {e}")
        raise HTTPException(status_code=502, detail=format_gocardless_error(e))


@router.get("/banks/requisitions")
def list_bank_requisitions(db: Session = Depends(get_db)):
    """List all stored requisitions with health hints."""
    rows = db.query(models.BankRequisition).order_by(models.BankRequisition.created_at.desc()).all()
    now = datetime.utcnow()
    result = []
    for r in rows:
        status = (r.status or "").upper()
        stale = False
        if r.updated_at and status in {"LN", "SU", "LINKED"}:
            stale = (now - r.updated_at).total_seconds() > 86400 * 90
        result.append({
            "id": r.id,
            "requisition_id": r.requisition_id,
            "institution_id": r.institution_id,
            "institution_name": r.institution_name,
            "status": r.status,
            "link": r.link,
            "reference": r.reference,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            "needs_reauth": status in {"EX", "RJ", "REJECTED", "EXPIRED"},
            "possibly_stale": stale,
        })
    return result


@router.get("/banks/requisition/{requisition_id}")
def get_bank_requisition(requisition_id: str, db: Session = Depends(get_db)):
    """Refresh requisition status from GoCardless and return it with linked accounts."""
    db_req = db.query(models.BankRequisition).filter(models.BankRequisition.requisition_id == requisition_id).first()
    if not db_req:
        raise HTTPException(status_code=404, detail="Requisición no encontrada")
    try:
        client = _gc_client()
        remote = client.get_requisition(requisition_id)
        status_str = _parse_requisition_status(remote.get("status"))
        db_req.status = status_str or db_req.status
        if not db_req.institution_name and db_req.institution_id:
            db_req.institution_name = _pretty_institution_name(None, db_req.institution_id)
        db_req.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(db_req)

        imported_ids: list[int] = []
        imported_transactions = 0
        if _should_import_requisition(status_str, list(remote.get("accounts") or [])):
            imported_ids, imported_transactions = _import_requisition_accounts(db, client, db_req)

        institution_name = _pretty_institution_name(db_req.institution_name, db_req.institution_id)
        gc_accounts = remote.get("accounts", [])
        account_details = []
        for gc_acc_id in gc_accounts:
            try:
                profile = _merge_account_profile(client, gc_acc_id)
                account_details.append({
                    "gocardless_account_id": gc_acc_id,
                    "iban": profile.get("iban"),
                    "name": _gocardless_account_label(profile, institution_name),
                    "currency": profile.get("currency"),
                })
            except Exception as detail_err:
                logger.warning(f"Could not fetch details for {gc_acc_id}: {detail_err}")
                account_details.append({"gocardless_account_id": gc_acc_id})

        return {
            "id": db_req.id,
            "requisition_id": db_req.requisition_id,
            "institution_id": db_req.institution_id,
            "status": db_req.status,
            "link": db_req.link,
            "accounts": account_details,
            "imported_account_ids": imported_ids,
            "imported_transactions": imported_transactions,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_bank_requisition error: {e}")
        raise HTTPException(status_code=502, detail=format_gocardless_error(e))


@router.delete("/banks/requisition/{requisition_id}")
def delete_bank_requisition(requisition_id: str, db: Session = Depends(get_db)):
    """Delete a requisition from GoCardless and from the local DB."""
    db_req = db.query(models.BankRequisition).filter(models.BankRequisition.requisition_id == requisition_id).first()
    if not db_req:
        raise HTTPException(status_code=404, detail="Requisición no encontrada")
    gc_account_ids: list[str] = []
    try:
        client = _gc_client()
        remote = client.get_requisition(requisition_id)
        gc_account_ids = list(remote.get("accounts") or [])
        client.delete_requisition(requisition_id)
    except Exception as e:
        logger.warning(f"Could not delete requisition from GoCardless: {e}")
    if gc_account_ids:
        for gc_id in gc_account_ids:
            acc = db.query(models.Account).filter(models.Account.gocardless_account_id == gc_id).first()
            if acc:
                acc.gocardless_account_id = None
                acc.last_sync_at = None
                acc.last_sync_error = None
    db.delete(db_req)
    db.commit()
    return {"status": "ok", "unlinked_accounts": len(gc_account_ids)}


@router.post("/banks/import-accounts")
def import_bank_accounts(db: Session = Depends(get_db)):
    """Import all GoCardless accounts from linked consents into Cuentas."""
    try:
        client = _gc_client()
    except HTTPException:
        raise

    rows = db.query(models.BankRequisition).order_by(models.BankRequisition.updated_at.desc()).all()
    imported: list[int] = []
    transactions_created = 0
    for db_req in rows:
        ids, tx_count = _import_requisition_accounts(db, client, db_req)
        imported.extend(ids)
        transactions_created += tx_count
    return {
        "status": "ok",
        "imported": len(imported),
        "account_ids": imported,
        "transactions_created": transactions_created,
    }


@router.post("/banks/link")
def link_bank_account(req: AccountLinkRequest, db: Session = Depends(get_db)):
    """Link a GoCardless account ID to an existing Soberan account."""
    acc = db.query(models.Account).filter(models.Account.id == req.soberan_account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Cuenta de Soberan no encontrada")
    conflict = db.query(models.Account).filter(
        models.Account.gocardless_account_id == req.gocardless_account_id,
        models.Account.id != req.soberan_account_id,
    ).first()
    if conflict:
        raise HTTPException(status_code=409, detail="Esta cuenta de GoCardless ya está vinculada a otra cuenta de Soberan")
    acc.gocardless_account_id = req.gocardless_account_id
    if req.institution_name and not acc.banco:
        acc.banco = sanitize_string(req.institution_name[:120])
    sync_result: dict = {"created": 0}
    try:
        client = _gc_client()
        db.flush()
        category_rules = _load_category_rules(db)
        sync_result = _sync_bank_account(db, client, acc, category_rules)
        if sync_result.get("error"):
            raise HTTPException(status_code=502, detail=sync_result["error"])
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"link_bank_account sync failed for {req.gocardless_account_id}: {e}")
        db.commit()
        db.refresh(acc)
    else:
        db.refresh(acc)
    return {
        "status": "ok",
        "account_id": acc.id,
        "gocardless_account_id": req.gocardless_account_id,
        "alias_real": acc.alias_real,
        "balance_actual": acc.balance_actual,
        "transactions_created": sync_result.get("created", 0),
    }


@router.post("/banks/unlink/{account_id}")
def unlink_bank_account(account_id: int, db: Session = Depends(get_db)):
    """Remove the GoCardless link from a Soberan account."""
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    acc.gocardless_account_id = None
    acc.last_sync_at = None
    db.commit()
    return {"status": "ok"}


def _apply_category_rules(description: str, rules: dict) -> str:
    """Legacy helper — prefer infer_transaction_category."""
    return infer_transaction_category(description, 0, [], rules)


@router.get("/banks/sync-status")
def bank_sync_status(db: Session = Depends(get_db)):
    """Summary of linked accounts, last sync and consent health."""
    linked = db.query(models.Account).filter(models.Account.gocardless_account_id.isnot(None)).all()
    now = datetime.utcnow()
    accounts = []
    stale_count = 0
    error_count = 0
    for acc in linked:
        stale = False
        if acc.last_sync_at:
            stale = (now - acc.last_sync_at).total_seconds() > 86400
        else:
            stale = True
        if stale:
            stale_count += 1
        if acc.last_sync_error:
            error_count += 1
        accounts.append({
            "id": acc.id,
            "alias_real": acc.alias_real,
            "last_sync_at": acc.last_sync_at.isoformat() if acc.last_sync_at else None,
            "last_sync_error": acc.last_sync_error,
            "stale": stale,
        })
    requisitions = list_bank_requisitions(db)
    needs_reauth = [r for r in requisitions if r.get("needs_reauth")]
    return {
        "linked_count": len(linked),
        "stale_count": stale_count,
        "error_count": error_count,
        "accounts": accounts,
        "requisitions_needing_reauth": needs_reauth,
        "gocardless_configured": bool(os.getenv("GOCARDLESS_SECRET_ID") and os.getenv("GOCARDLESS_SECRET_KEY")),
    }


@router.get("/banks/payroll-hints")
def bank_payroll_hints(db: Session = Depends(get_db)):
    return {"hints": detect_payroll_hints(db)}


@router.post("/banks/detect-internal-transfers")
def bank_detect_internal_transfers(days: int = 30, db: Session = Depends(get_db)):
    pairs = detect_internal_transfers(db, days=days)
    return {"pairs_detected": pairs}


@router.post("/banks/learn-category-rule")
def learn_category_rule(body: LearnCategoryRuleBody, db: Session = Depends(get_db)):
    pattern = (body.pattern or "").strip().lower()
    category = normalize_category(body.category or "")
    if len(pattern) < 3 or not category:
        raise HTTPException(status_code=400, detail="Patrón (≥3 chars) y categoría requeridos")
    if not is_learnable_token(pattern):
        raise HTTPException(status_code=400, detail="Patrón demasiado genérico para aprender (ej. compra, pago, bizum).")
    if not is_canonical_category(category):
        raise HTTPException(status_code=400, detail="La categoría debe ser de la taxonomía fija de gasto o ingreso.")
    rules = _load_category_rules(db)
    rules[pattern] = category
    _save_category_rules(db, rules)
    return {"status": "ok", "pattern": pattern, "category": category}


@router.post("/banks/learn-merchant-name")
def learn_merchant_name(body: LearnMerchantNameBody, db: Session = Depends(get_db)):
    pattern = (body.pattern or "").strip().lower()
    name = sanitize_string((body.name or "").strip())
    if len(pattern) < 3 or not name:
        raise HTTPException(status_code=400, detail="Patrón (≥3 chars) y nombre requeridos")
    if not is_learnable_token(pattern):
        raise HTTPException(status_code=400, detail="Patrón demasiado genérico para aprender (ej. compra, pago, bizum).")
    if not looks_like_user_clean_name(name):
        raise HTTPException(status_code=400, detail="El nombre debe ser corto y limpio (sin códigos bancarios).")
    names = _load_merchant_names(db)
    names[pattern] = name
    _save_merchant_names(db, names)
    return {"status": "ok", "pattern": pattern, "name": name}


@router.post("/banks/smart-clean-expenses")
def smart_clean_expenses(body: SmartCleanExpensesBody = None, db: Session = Depends(get_db)):
    """Apply learned category + merchant name rules to eligible expenses in a month."""
    if body is None:
        body = SmartCleanExpensesBody()
    now = datetime.utcnow()
    mes = int(body.mes or now.month)
    anio = int(body.anio or now.year)
    if mes < 1 or mes > 12:
        raise HTTPException(status_code=400, detail="mes inválido")
    start = datetime(anio, mes, 1)
    end = datetime(anio + 1, 1, 1) if mes == 12 else datetime(anio, mes + 1, 1)

    hints = load_budget_category_hints(db)
    rules = _load_category_rules(db)
    names = _load_merchant_names(db)

    txs = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.date >= start,
            models.Transaction.date < end,
            models.Transaction.amount < 0,
        )
        .all()
    )
    categorized = 0
    renamed = 0
    for tx in txs:
        cat_ok, name_ok = _apply_expense_intelligence_to_model(
            tx, hints, rules, names, allow_heuristic_rename=True,
        )
        if cat_ok:
            categorized += 1
        if name_ok:
            renamed += 1
    if categorized or renamed:
        db.commit()
    return {
        "status": "ok",
        "mes": mes,
        "anio": anio,
        "categorized": categorized,
        "renamed": renamed,
        "scanned": len(txs),
    }


@router.post("/banks/sync")
def sync_bank_accounts(req: BankSyncRequest = None, db: Session = Depends(get_db)):
    """Sync balances and transactions from all (or one) GoCardless-linked account(s)."""
    if req is None:
        req = BankSyncRequest()
    try:
        client = _gc_client()
    except HTTPException:
        raise

    if req.account_id:
        linked = db.query(models.Account).filter(
            models.Account.id == req.account_id,
            models.Account.gocardless_account_id != None,
        ).all()
    else:
        linked = db.query(models.Account).filter(models.Account.gocardless_account_id != None).all()

    if not linked:
        return {"status": "ok", "synced": 0, "created": 0, "message": "No linked accounts found."}

    # Prefer accounts that haven't synced recently (or failed) so rate-limited
    # runs still make progress across the many Revolut pockets.
    linked = sorted(
        linked,
        key=lambda a: (
            a.last_sync_at is not None and not a.last_sync_error,
            a.last_sync_at or datetime.min,
        ),
    )

    category_rules = _load_category_rules(db)
    merchant_names = _load_merchant_names(db)
    total_created = 0
    total_updated = 0
    error_count = 0
    results = []
    # Space calls: each account hits details/balances/transactions.
    pace_sec = 1.25 if len(linked) > 1 else 0.0

    for idx, acc in enumerate(linked):
        if idx > 0 and pace_sec > 0:
            time.sleep(pace_sec)
        result = _sync_bank_account(
            db, client, acc, category_rules,
            date_from=req.date_from,
            date_to=req.date_to,
            merchant_names=merchant_names,
        )
        results.append(result)
        if result.get("error"):
            error_count += 1
        else:
            total_created += int(result.get("created") or 0)
            total_updated += int(result.get("updated") or 0)

    status = "ok" if error_count == 0 else ("partial" if error_count < len(linked) else "error")
    return {
        "status": status,
        "synced": len(linked),
        "created": total_created,
        "updated": total_updated,
        "error_count": error_count,
        "accounts": results,
    }

@router.get("/health-audit")
def health_audit(db: Session = Depends(get_db)):
    """Diagnostic endpoint to verify system integrity."""
    try:
        return {
            "status": "healthy",
            "database": "connected",
            "counts": {
                "accounts": db.query(models.Account).count(),
                "transactions": db.query(models.Transaction).count(),
                "goals": db.query(models.Goal).count()
            },
            "gocardless_configured": bool(os.getenv("GOCARDLESS_SECRET_ID") and os.getenv("GOCARDLESS_SECRET_KEY"))
        }
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}
