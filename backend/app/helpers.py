"""Shared non-route helpers used by the Soberan API."""
from __future__ import annotations

import html
import json
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import models
from .expense_categories import (
    INTERNAL_TRANSFER_CATEGORY,
    is_canonical_category,
    normalize_category,
)

PAYROLL_COMPANY_CONFIG_KEY = "payroll_company_config"
ENVELOPE_ACCOUNT_MAP_KEY = "envelope_account_map"
SALARY_RECONCILIATION_KEY = "salary_reconciliation"

def sanitize_string(text: str) -> str:
    if not text: return ""
    return html.escape(text).strip()

def norm_company_key(name: Optional[str]) -> str:
    return (name or "").strip().lower()

def user_settings_json(db: Session, key: str, default: Any):
    row = db.query(models.UserSettings).filter(models.UserSettings.key == key).first()
    if not row or not row.value:
        return default
    try:
        return json.loads(row.value)
    except json.JSONDecodeError:
        return default

def payroll_company_entry(db: Session, company_name: Optional[str]) -> Dict[str, Any]:
    if not company_name:
        return {}
    cfg = user_settings_json(db, PAYROLL_COMPANY_CONFIG_KEY, {})
    if not isinstance(cfg, dict):
        return {}
    return cfg.get(norm_company_key(company_name), {}) or {}

def is_prestacion_income_text(*parts: Optional[str]) -> bool:
    """Detecta prestación/desempleo/SEPE aunque venga mal etiquetada como «Nómina …»."""
    hay = " ".join((p or "").strip().lower() for p in parts if p)
    if not hay:
        return False
    if "prestaci" in hay or "desempleo" in hay:
        return True
    return "sepe" in hay.split() or " sepe " in f" {hay} " or hay.startswith("sepe ") or hay.endswith(" sepe")


def is_prestacion_income_entry(entry: Any) -> bool:
    return is_prestacion_income_text(
        getattr(entry, "categoria", None),
        getattr(entry, "nombre", None),
        getattr(entry, "empresa", None),
    )


def format_prestacion_calendar_title(nombre: Optional[str]) -> str:
    """Título de calendario para paro: no usar el framing «Nómina {empresa}»."""
    n = (nombre or "").strip()
    low = n.lower()
    if low.startswith("nómina ") or low.startswith("nomina "):
        n = n.split(None, 1)[1].strip() if " " in n else ""
        low = n.lower()
    for prefix in ("prestación", "prestacion"):
        if low.startswith(prefix):
            rest = n[len(prefix):].lstrip(" .:-–—")
            return f"Prestación · {rest}" if rest else "Prestación"
    return f"Prestación · {n}" if n else "Prestación"


def recurring_company_from_nombre(nombre: Optional[str]) -> Optional[str]:
    n = (nombre or "").strip()
    low = n.lower()
    # Paro/SEPE no es empresa de nómina aunque el nombre empiece por «Nómina ».
    if is_prestacion_income_text(n):
        return None
    if low.startswith("nómina "):
        rest = n[7:].strip()
        return rest or None
    return None

def envelope_account_label(db: Session, recurring_id: int, envelope_map: Dict[str, Any]) -> str:
    aid = envelope_map.get(str(recurring_id))
    if not aid:
        return ""
    try:
        aid_int = int(aid)
    except (TypeError, ValueError):
        return ""
    acc = db.query(models.Account).filter(models.Account.id == aid_int).first()
    if not acc:
        return ""
    return acc.alias_real or ""

def validate_transaction_category(category: str, *, required: bool = True) -> str:
    normalized = normalize_category(category)
    if not required and not (category or "").strip():
        return ""
    if not required and not normalized:
        return ""
    if not normalized:
        if required:
            raise HTTPException(status_code=400, detail="La categoría es obligatoria y debe ser específica.")
        return ""
    if normalized == INTERNAL_TRANSFER_CATEGORY:
        return normalized
    if not is_canonical_category(normalized):
        raise HTTPException(
            status_code=400,
            detail="La categoría debe ser una de la taxonomía fija de gasto o ingreso.",
        )
    return normalized

def annual_irpf_quota_2026(taxable_base: float) -> float:
    """Progressive IRPF 2026 estimator over annual taxable base (orientative)."""
    brackets = [
        (12450.0, 0.19),
        (20200.0, 0.24),
        (35200.0, 0.30),
        (60000.0, 0.37),
        (300000.0, 0.45),
        (float("inf"), 0.47),
    ]
    remaining = max(taxable_base, 0.0)
    prev_limit = 0.0
    tax = 0.0
    for limit, rate in brackets:
        tramo = min(max(limit - prev_limit, 0.0), remaining)
        if tramo <= 0:
            prev_limit = limit
            continue
        tax += tramo * rate
        remaining -= tramo
        prev_limit = limit
        if remaining <= 0:
            break
    return max(tax, 0.0)

def estimate_payroll(
    bruto_mensual: float,
    pagas: int = 14,
    ss_pct: Optional[float] = None,
    contract_type: str = "indefinido",
    personal_minimum: float = 5550.0,
    work_expense: float = 2000.0,
    irpf_pct_override: Optional[float] = None
):
    bruto_mensual = max(float(bruto_mensual), 0.0)
    pagas = max(int(pagas), 12)
    annual_gross = bruto_mensual * pagas
    if ss_pct is None:
        # Referencia 2026 trabajador RG: CC 4.70 + desempleo 1.55/1.60 + FP 0.10 + MEI 0.15
        ss_pct = 6.50 if contract_type == "indefinido" else 6.55
    ss_rate = max(float(ss_pct), 0.0) / 100.0
    ss_amount = bruto_mensual * ss_rate
    annual_ss = ss_amount * pagas
    if irpf_pct_override is None:
        taxable_base = max(annual_gross - annual_ss - max(personal_minimum, 0.0) - max(work_expense, 0.0), 0.0)
        annual_tax = annual_irpf_quota_2026(taxable_base)
        irpf_rate = (annual_tax / annual_gross) if annual_gross > 0 else 0.0
    else:
        irpf_rate = max(float(irpf_pct_override), 0.0) / 100.0
        taxable_base = max(annual_gross - annual_ss - max(personal_minimum, 0.0) - max(work_expense, 0.0), 0.0)
        annual_tax = annual_gross * irpf_rate
    irpf_amount = bruto_mensual * irpf_rate
    neto = max(bruto_mensual - ss_amount - irpf_amount, 0.0)
    return {
        "bruto_mensual": round(bruto_mensual, 2),
        "pagas": pagas,
        "contract_type": contract_type,
        "ss_pct": round(ss_rate * 100.0, 2),
        "irpf_pct": round(irpf_rate * 100.0, 2),
        "ss_amount": round(ss_amount, 2),
        "irpf_amount": round(irpf_amount, 2),
        "neto_estimado": round(neto, 2),
        "annual_gross": round(annual_gross, 2),
        "annual_ss": round(annual_ss, 2),
        "taxable_base_2026": round(taxable_base, 2),
        "annual_irpf_quota": round(annual_tax, 2),
        "personal_minimum": round(max(personal_minimum, 0.0), 2),
        "work_expense": round(max(work_expense, 0.0), 2),
    }

def resolve_recurring_days_for_period(db: Session, anio: int, mes: int):
    """Resolve recurring income/expense days using historical settings when available."""
    set_income = db.query(models.UserSettings).filter(models.UserSettings.key == "recurring_income_day").first()
    set_expense = db.query(models.UserSettings).filter(models.UserSettings.key == "recurring_expense_day").first()
    income_day = int(set_income.value) if set_income and set_income.value and str(set_income.value).isdigit() else 1
    expense_day = int(set_expense.value) if set_expense and set_expense.value and str(set_expense.value).isdigit() else 5

    hist_set = db.query(models.UserSettings).filter(models.UserSettings.key == "recurring_days_history").first()
    target_period = f"{int(anio):04d}-{int(mes):02d}"
    if hist_set and hist_set.value:
        try:
            history = json.loads(hist_set.value)
            applicable = [
                h for h in history
                if isinstance(h, dict)
                and isinstance(h.get("effective_period"), str)
                and h.get("effective_period") <= target_period
            ]
            if applicable:
                latest = sorted(applicable, key=lambda x: x.get("effective_period"))[-1]
                if str(latest.get("income_day", "")).isdigit():
                    income_day = int(latest["income_day"])
                if str(latest.get("expense_day", "")).isdigit():
                    expense_day = int(latest["expense_day"])
        except json.JSONDecodeError:
            pass

    income_day = max(1, min(income_day, 28))
    expense_day = max(1, min(expense_day, 28))
    return income_day, expense_day

def resolve_income_day_with_window(db: Session, anio: int, mes: int, company_name: Optional[str] = None):
    """Resolve expected income day plus optional early window (global or per payroll company)."""
    mode_set = db.query(models.UserSettings).filter(models.UserSettings.key == "recurring_income_mode").first()
    adv_set = db.query(models.UserSettings).filter(models.UserSettings.key == "recurring_income_advance_days").first()
    mode = mode_set.value if mode_set and mode_set.value else "fixed"
    advance_days = int(adv_set.value) if adv_set and str(adv_set.value).isdigit() else 0
    advance_days = max(0, min(advance_days, 10))

    pcfg = payroll_company_entry(db, company_name)
    if isinstance(pcfg, dict):
        if pcfg.get("income_mode") in ("penultimate", "fixed"):
            mode = pcfg["income_mode"]
        if str(pcfg.get("advance_days", "")).isdigit():
            advance_days = max(0, min(int(pcfg["advance_days"]), 10))

    income_day, _ = resolve_recurring_days_for_period(db, anio, mes)
    if mode == "penultimate":
        last_day = (datetime(anio + (1 if mes == 12 else 0), 1 if mes == 12 else mes + 1, 1) - timedelta(days=1)).day
        income_day = max(1, min(last_day - 1, 28 if last_day <= 28 else last_day - 1))
    elif isinstance(pcfg, dict) and str(pcfg.get("income_day", "")).isdigit():
        income_day = max(1, min(int(pcfg["income_day"]), 28))

    earliest_day = max(1, income_day - advance_days)
    return income_day, earliest_day


def _save_payroll_company_config(db: Session, cfg: dict) -> None:
    payload = json.dumps(cfg, ensure_ascii=False)
    row = db.query(models.UserSettings).filter(models.UserSettings.key == PAYROLL_COMPANY_CONFIG_KEY).first()
    if row:
        row.value = payload
    else:
        db.add(models.UserSettings(key=PAYROLL_COMPANY_CONFIG_KEY, value=payload))


def payroll_account_history(entry: dict) -> list:
    raw = entry.get("account_history") if isinstance(entry, dict) else None
    if not isinstance(raw, list):
        return []
    cleaned = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        try:
            cleaned.append({
                "account_id": int(row["account_id"]),
                "account_alias": str(row.get("account_alias") or ""),
                "from_date": str(row.get("from_date") or row.get("from") or ""),
                "to_date": row.get("to_date") or row.get("to"),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return cleaned


def get_payroll_account_config(db: Session, empresa: str) -> dict:
    key = norm_company_key(empresa)
    if not key:
        return {"empresa": empresa, "account_id": None, "account_alias": None, "income_mode": "fixed", "history": []}
    cfg = user_settings_json(db, PAYROLL_COMPANY_CONFIG_KEY, {})
    if not isinstance(cfg, dict):
        cfg = {}
    entry = cfg.get(key, {}) if isinstance(cfg.get(key), dict) else {}
    account_id = entry.get("account_id")
    alias = None
    if account_id is not None:
        try:
            acc = db.query(models.Account).filter(models.Account.id == int(account_id)).first()
            alias = acc.alias_real if acc else entry.get("account_alias")
        except (TypeError, ValueError):
            account_id = None
    return {
        "empresa": empresa,
        "account_id": int(account_id) if account_id is not None else None,
        "account_alias": alias,
        "income_mode": entry.get("income_mode") or "fixed",
        "history": payroll_account_history(entry),
    }


def set_payroll_account(
    db: Session,
    empresa: str,
    account_id: int,
    *,
    archive_previous_account: bool = False,
) -> dict:
    key = norm_company_key(empresa)
    if not key:
        raise HTTPException(status_code=400, detail="Empresa requerida")

    new_acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not new_acc:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    if new_acc.archivada:
        raise HTTPException(status_code=400, detail="No puedes asignar una cuenta archivada como destino de nómina")

    cfg = user_settings_json(db, PAYROLL_COMPANY_CONFIG_KEY, {})
    if not isinstance(cfg, dict):
        cfg = {}
    entry = dict(cfg.get(key, {}) if isinstance(cfg.get(key), dict) else {})
    history = payroll_account_history(entry)
    old_id = entry.get("account_id")
    today = datetime.utcnow().date().isoformat()

    try:
        old_id_int = int(old_id) if old_id is not None else None
    except (TypeError, ValueError):
        old_id_int = None

    if old_id_int is not None and old_id_int != account_id:
        closed = False
        for row in reversed(history):
            if row["account_id"] == old_id_int and not row.get("to_date"):
                row["to_date"] = today
                closed = True
                break
        if not closed:
            old_acc = db.query(models.Account).filter(models.Account.id == old_id_int).first()
            history.append({
                "account_id": old_id_int,
                "account_alias": old_acc.alias_real if old_acc else str(old_id_int),
                "from_date": today,
                "to_date": today,
            })
        if archive_previous_account:
            old_acc = db.query(models.Account).filter(models.Account.id == old_id_int).first()
            if old_acc:
                old_acc.archivada = True

    if old_id_int != account_id:
        history.append({
            "account_id": account_id,
            "account_alias": new_acc.alias_real,
            "from_date": today,
            "to_date": None,
        })

    entry["account_id"] = account_id
    entry["account_history"] = history
    cfg[key] = entry
    _save_payroll_company_config(db, cfg)
    db.commit()
    return get_payroll_account_config(db, empresa)
