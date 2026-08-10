"""Detect payroll and recurring income candidates from bank transactions."""
from __future__ import annotations

import json
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from . import models
from .helpers import PAYROLL_COMPANY_CONFIG_KEY, norm_company_key, user_settings_json

_PAYROLL_TOLERANCE_PCT = 0.08
_PAYROLL_TOLERANCE_EUR = 50.0


def _within_tolerance(expected: float, actual: float) -> bool:
    if expected <= 0:
        return False
    diff = abs(actual - expected)
    return diff <= _PAYROLL_TOLERANCE_EUR or diff / expected <= _PAYROLL_TOLERANCE_PCT


def detect_payroll_hints(db: Session, *, days: int = 45) -> list[dict]:
    since = datetime.utcnow() - timedelta(days=days)
    positive = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.date >= since,
            models.Transaction.amount > 0,
            models.Transaction.es_interna.is_(False),
        )
        .order_by(models.Transaction.date.desc())
        .all()
    )

    cfg = user_settings_json(db, PAYROLL_COMPANY_CONFIG_KEY, {})
    if not isinstance(cfg, dict):
        cfg = {}

    active_jobs = db.query(models.WorkHistory).filter(models.WorkHistory.fecha_fin.is_(None)).all()
    hints: list[dict] = []
    seen_tx: set[int] = set()

    for job in active_jobs:
        empresa = (job.empresa or "").strip()
        if not empresa:
            continue
        key = norm_company_key(empresa)
        payroll_cfg = cfg.get(key, {}) if isinstance(cfg.get(key), dict) else {}
        expected_account_id = payroll_cfg.get("account_id")

        breakdown = (
            db.query(models.SalaryBreakdown)
            .filter(models.SalaryBreakdown.empresa == empresa)
            .order_by(models.SalaryBreakdown.anio.desc(), models.SalaryBreakdown.mes.desc())
            .first()
        )
        expected_neto = float(breakdown.neto if breakdown else 0)
        if expected_neto <= 0 and job.salario_bruto:
            expected_neto = float(job.salario_bruto) * 0.75

        for tx in positive:
            if tx.id in seen_tx:
                continue
            if expected_account_id and tx.account_id != int(expected_account_id):
                continue
            if expected_neto > 0 and not _within_tolerance(expected_neto, float(tx.amount)):
                continue
            desc = (tx.description_raw or "").lower()
            if expected_neto <= 0:
                if not any(k in desc for k in ("nomina", "nómina", "salario", empresa.lower())):
                    continue
            hints.append({
                "transaction_id": tx.id,
                "amount": float(tx.amount),
                "date": tx.date.isoformat() if tx.date else None,
                "description_raw": tx.description_raw,
                "account_id": tx.account_id,
                "empresa": empresa,
                "expected_neto": expected_neto,
                "kind": "payroll",
            })
            seen_tx.add(tx.id)
            break

    income_entries = db.query(models.RecurringEntry).filter(models.RecurringEntry.es_ingreso.is_(True)).all()
    for entry in income_entries:
        if (entry.categoria or "").strip().lower() == "nómina":
            continue
        expected = float(entry.monto_estimado or 0)
        nombre = (entry.nombre or "").lower()
        for tx in positive:
            if tx.id in seen_tx:
                continue
            if expected > 0 and not _within_tolerance(expected, float(tx.amount)):
                if nombre and nombre not in (tx.description_raw or "").lower():
                    continue
            if nombre and nombre not in (tx.description_raw or "").lower():
                continue
            hints.append({
                "transaction_id": tx.id,
                "amount": float(tx.amount),
                "date": tx.date.isoformat() if tx.date else None,
                "description_raw": tx.description_raw,
                "account_id": tx.account_id,
                "empresa": entry.empresa or entry.nombre,
                "expected_neto": expected,
                "kind": "recurring_income",
                "categoria": entry.categoria,
            })
            seen_tx.add(tx.id)
            break

    return hints
