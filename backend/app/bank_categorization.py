"""Infer transaction categories from budget entries and user rules.

Also applies expense-only merchant naming from learned `merchant_names`.
"""
from __future__ import annotations

import re
from typing import Any

from sqlalchemy.orm import Session

from . import models
from .expense_categories import (
    SUBSCRIPTION_CATEGORY,
    canonicalize_for_amount,
    is_learnable_token,
    normalize_category,
)

_PAYROLL_KEYWORDS = ("nomina", "nómina", "salario", "payroll")

_PLACEHOLDER_DESCRIPTIONS = frozenset({
    "",
    "importado gocardless",
    "importado",
    "movimiento bancario",
    "—",
    "-",
})

_TOKEN_SPLIT_RE = re.compile(r"[\s—\-|,;/·]+")


def load_budget_category_hints(db: Session) -> list[dict]:
    """Hints map merchant/nombre → taxonomy category (never partida name as category)."""
    hints: list[dict] = []
    for entry in db.query(models.RecurringEntry).all():
        if entry.tipo_partida == "suscripcion":
            cat = SUBSCRIPTION_CATEGORY
        else:
            cat = normalize_category(entry.categoria)
        if not cat:
            continue
        # Only use taxonomy categories as inference targets
        canon = canonicalize_for_amount(cat, 1.0 if entry.es_ingreso else -1.0)
        if not canon:
            continue
        hints.append({
            "categoria": canon,
            "nombre": (entry.nombre or "").strip().lower(),
            "empresa": (entry.empresa or "").strip().lower(),
            "monto": float(entry.monto_estimado or 0),
            "es_ingreso": bool(entry.es_ingreso),
        })
    return hints


def infer_transaction_category(
    description: str,
    amount: float,
    hints: list[dict],
    rules: dict,
) -> str:
    text = (description or "").lower()
    for pattern, category in rules.items():
        pat = (pattern or "").strip().lower()
        if pat and pat in text:
            return canonicalize_for_amount(str(category), amount)

    if amount > 0:
        for keyword in _PAYROLL_KEYWORDS:
            if keyword in text:
                return "Nómina"
        for hint in hints:
            if not hint.get("es_ingreso"):
                continue
            cat = hint.get("categoria") or ""
            if not cat:
                continue
            nombre = hint.get("nombre") or ""
            empresa = hint.get("empresa") or ""
            if nombre and len(nombre) >= 3 and nombre in text:
                return cat
            if empresa and len(empresa) >= 3 and empresa in text:
                return cat
    else:
        for hint in hints:
            if hint.get("es_ingreso"):
                continue
            cat = hint.get("categoria") or ""
            if not cat:
                continue
            nombre = hint.get("nombre") or ""
            empresa = hint.get("empresa") or ""
            if nombre and len(nombre) >= 4 and nombre in text:
                return cat
            if empresa and len(empresa) >= 3 and empresa in text:
                return cat
    return ""


def extract_learnable_token(description: str) -> str | None:
    """First learnable merchant-like token from a bank or user description."""
    for part in _TOKEN_SPLIT_RE.split((description or "").strip()):
        cleaned = part.strip()
        if is_learnable_token(cleaned):
            return cleaned.lower()
    return None


def looks_like_bank_raw_description(description: str | None) -> bool:
    """True when description still looks like a GoCardless / bank dump."""
    d = (description or "").strip()
    if d.lower() in _PLACEHOLDER_DESCRIPTIONS:
        return True
    if " — " in d or " · " in d:
        return True
    if re.search(r"\bMCC\s*\d+\b", d, flags=re.IGNORECASE):
        return True
    if "…" in d or re.search(r"\bES\d{2}", d, flags=re.IGNORECASE):
        return True
    if len(d) > 60:
        return True
    return False


def looks_like_user_clean_name(description: str | None) -> bool:
    """Short user-facing label that should not be overwritten by sync intelligence."""
    d = (description or "").strip()
    if not d or d.lower() in _PLACEHOLDER_DESCRIPTIONS:
        return False
    if looks_like_bank_raw_description(d):
        return False
    if len(d) > 40:
        return False
    # Generic leftovers (COMPRA, PAGO…) are not user-customized labels
    return extract_learnable_token(d) is not None


def match_merchant_name(description: str, merchant_names: dict) -> str | None:
    text = (description or "").lower()
    if not text or not merchant_names:
        return None
    # Longer patterns first to prefer "mercadona sa" over "merc"
    items = sorted(
        ((str(k).strip().lower(), str(v).strip()) for k, v in merchant_names.items() if k and v),
        key=lambda kv: len(kv[0]),
        reverse=True,
    )
    for pattern, name in items:
        if len(pattern) >= 3 and pattern in text:
            return name
    return None


def suggest_clean_name_from_bank(description: str) -> str | None:
    """Derive a short display name from the first bank counterparty segment."""
    d = (description or "").strip()
    if not d:
        return None
    head = d.split(" — ")[0].strip()
    head = re.sub(r"\bMCC\s*\d+\b", "", head, flags=re.IGNORECASE).strip(" ·|-")
    head = re.sub(r"…\w{2,8}\b", "", head).strip()
    head = re.sub(r"\s{2,}", " ", head).strip()
    if len(head) < 3:
        return None
    if len(head) > 40:
        cut = head[:40]
        if " " in cut:
            cut = cut.rsplit(" ", 1)[0]
        head = cut.strip() or head[:40]
    if head.isupper() and len(head) > 3:
        head = head.title()
    if looks_like_bank_raw_description(head):
        return None
    return head


def expense_eligible_for_intelligence(
    *,
    amount: float,
    es_interna: bool = False,
    es_pending: bool = False,
    excluida_presupuesto: bool = False,
) -> bool:
    if float(amount or 0) >= 0:
        return False
    if es_interna or es_pending or excluida_presupuesto:
        return False
    return True


def apply_expense_intelligence(
    *,
    amount: float,
    description: str,
    category: str,
    hints: list[dict],
    category_rules: dict,
    merchant_names: dict,
    es_interna: bool = False,
    es_pending: bool = False,
    excluida_presupuesto: bool = False,
    allow_heuristic_rename: bool = True,
) -> dict[str, Any]:
    """Apply expense-only category + name intelligence.

    Returns dict with keys: description, category, renamed, categorized.
    Income / internal / pending / omitted rows are returned unchanged.
    """
    desc = (description or "").strip() or "—"
    cat = (category or "").strip()
    out = {
        "description": desc,
        "category": cat,
        "renamed": False,
        "categorized": False,
    }
    if not expense_eligible_for_intelligence(
        amount=amount,
        es_interna=es_interna,
        es_pending=es_pending,
        excluida_presupuesto=excluida_presupuesto,
    ):
        return out

    if not cat:
        inferred = infer_transaction_category(desc, amount, hints, category_rules)
        if inferred:
            out["category"] = inferred
            out["categorized"] = True

    if looks_like_user_clean_name(desc):
        return out

    if looks_like_bank_raw_description(desc) or desc.lower() in _PLACEHOLDER_DESCRIPTIONS:
        learned = match_merchant_name(desc, merchant_names)
        if learned:
            out["description"] = learned
            out["renamed"] = learned != desc
            return out
        if allow_heuristic_rename:
            suggested = suggest_clean_name_from_bank(desc)
            if suggested and suggested != desc:
                out["description"] = suggested
                out["renamed"] = True
    return out
