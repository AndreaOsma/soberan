"""Sync debt payments (pagos reales) with installment planilla (cuotas)."""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app import models

_TOLERANCE = 0.01


def _cuota_amount(inst: "models.DebtInstallment") -> float:
    return float(inst.cuota_total or 0.0)


def paid_total_from_payments(db: "Session", debt_id: int) -> float:
    from app import models

    rows = db.query(models.DebtPayment).filter(models.DebtPayment.debt_id == debt_id).all()
    return round(sum(float(p.monto or 0.0) for p in rows), 2)


def effective_monto_pagado(db: "Session", debt: "models.Debt") -> float:
    """Pagos reales son la fuente de verdad cuando existen; si no, monto_pagado almacenado."""
    payment_sum = paid_total_from_payments(db, debt.id)
    stored = float(debt.monto_pagado or 0.0)
    effective = payment_sum if payment_sum > _TOLERANCE else stored
    return min(float(debt.monto_total or 0.0), max(0.0, effective))


def reconcile_debt_monto_pagado(db: "Session", debt_id: int) -> float:
    from app import models

    debt = db.query(models.Debt).filter(models.Debt.id == debt_id).first()
    if not debt:
        return 0.0
    effective = effective_monto_pagado(db, debt)
    if abs(float(debt.monto_pagado or 0.0) - effective) > _TOLERANCE:
        debt.monto_pagado = effective
    pending = float(debt.monto_total or 0.0) - effective
    # Auto-archive when fully paid; reopen if balance comes back (e.g. deleted payment)
    should_archive = pending <= _TOLERANCE
    if bool(getattr(debt, "archivada", False)) != should_archive:
        debt.archivada = should_archive
    return effective


def reconcile_all_debts_monto_pagado(db: "Session") -> None:
    from app import models

    for debt in db.query(models.Debt).all():
        reconcile_debt_monto_pagado(db, debt.id)


def enrich_installment_rows(
    debt: "models.Debt",
    rows: list[dict],
    paid_pool: float | None = None,
) -> list[dict]:
    """Recalculate capital, interes and saldo_pendiente. pagada siempre False aquí (sync aparte)."""
    del paid_pool
    sorted_rows = sorted(rows, key=lambda r: (r["fecha_vencimiento"], r["numero_cuota"]))
    remaining = max(0.0, float(debt.monto_total or 0) - float(debt.monto_pagado or 0))
    monthly_rate = (float(debt.tasa_anual or 0) / 100) / 12

    enriched: list[dict] = []
    for row in sorted_rows:
        cuota = float(row["cuota_total"])
        interest = round(remaining * monthly_rate, 2) if monthly_rate > 0 else 0.0
        capital = round(min(max(0.0, cuota - interest), remaining), 2)
        remaining = round(max(0.0, remaining - capital), 2)

        enriched.append({
            **row,
            "capital": capital,
            "interes": interest,
            "saldo_pendiente": remaining,
            "pagada": False,
        })
    return enriched


def sync_installment_pagada_from_payments(db: "Session", debt_id: int) -> None:
    """Mark installments paid FIFO according to pagos reales (sum of DebtPayment)."""
    from app import models

    debt = db.query(models.Debt).filter(models.Debt.id == debt_id).first()
    if not debt:
        return
    reconcile_debt_monto_pagado(db, debt_id)
    paid_pool = paid_total_from_payments(db, debt_id)
    insts = (
        db.query(models.DebtInstallment)
        .filter(models.DebtInstallment.debt_id == debt_id)
        .order_by(models.DebtInstallment.fecha_vencimiento, models.DebtInstallment.numero_cuota)
        .all()
    )
    for inst in insts:
        cuota = _cuota_amount(inst)
        if cuota <= _TOLERANCE:
            inst.pagada = False
            continue
        if paid_pool + _TOLERANCE >= cuota:
            inst.pagada = True
            paid_pool -= cuota
        else:
            inst.pagada = False


def sync_all_installment_pagada(db: "Session") -> None:
    """Reconcile pagada flags for every debt that has a planilla."""
    from app import models

    debt_ids = (
        db.query(models.DebtInstallment.debt_id)
        .distinct()
        .all()
    )
    for (debt_id,) in debt_ids:
        sync_installment_pagada_from_payments(db, debt_id)


def allocate_payment_to_installments(db: "Session", debt_id: int, amount: float) -> None:
    """Deprecated: use sync_installment_pagada_from_payments after updating monto_pagado."""
    del amount
    sync_installment_pagada_from_payments(db, debt_id)


def reverse_payment_from_installments(db: "Session", debt_id: int, amount: float) -> None:
    """Deprecated: use sync_installment_pagada_from_payments after updating monto_pagado."""
    del amount
    sync_installment_pagada_from_payments(db, debt_id)


def on_installment_paid_change(
    db: "Session",
    debt: "models.Debt",
    inst: "models.DebtInstallment",
    was_paid: bool,
    is_paid: bool,
) -> None:
    """No-op: pagada is derived from pagos reales via sync_installment_pagada_from_payments."""
    del db, debt, inst, was_paid, is_paid
