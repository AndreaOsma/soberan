"""Monthly budget and subscription sync routes."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models
from ..database import get_db
from ..expense_categories import SUBSCRIPTION_CATEGORY, normalize_category
from ..transaction_splits import budget_expense_amount
from ..schemas import BudgetCopyRequest, MonthlyBudget, MonthlyBudgetCreate

router = APIRouter()

@router.get("/monthly-budget/{mes}/{anio}", response_model=List[MonthlyBudget])
def get_budget(mes: int, anio: int, db: Session = Depends(get_db)):
    return db.query(models.MonthlyBudget).filter(models.MonthlyBudget.mes == mes, models.MonthlyBudget.anio == anio).all()

@router.post("/monthly-budget/", response_model=MonthlyBudget)
def update_budget(item: MonthlyBudgetCreate, db: Session = Depends(get_db)):
    db_item = db.query(models.MonthlyBudget).filter(models.MonthlyBudget.recurring_entry_id == item.recurring_entry_id, models.MonthlyBudget.mes == item.mes, models.MonthlyBudget.anio == item.anio).first()
    if db_item:
        db_item.monto_real = item.monto_real
        db_item.excluido = bool(item.excluido)
        db_item.cuenta_gestion_id = item.cuenta_gestion_id
        db_item.movido_a_cuenta = bool(item.movido_a_cuenta)
        db_item.movido_checked_at = item.movido_checked_at
    else:
        db_item = models.MonthlyBudget(**item.model_dump())
        db.add(db_item)
    db.commit(); db.refresh(db_item); return db_item

@router.post("/monthly-budget/copy")
def copy_budget(req: BudgetCopyRequest, db: Session = Depends(get_db)):
    source = db.query(models.MonthlyBudget).filter(
        models.MonthlyBudget.mes == req.from_mes,
        models.MonthlyBudget.anio == req.from_anio
    ).all()
    if not source:
        raise HTTPException(status_code=404, detail="No hay overrides en el mes de origen")
    copied = 0
    for src in source:
        existing = db.query(models.MonthlyBudget).filter(
            models.MonthlyBudget.recurring_entry_id == src.recurring_entry_id,
            models.MonthlyBudget.mes == req.to_mes,
            models.MonthlyBudget.anio == req.to_anio
        ).first()
        if not existing:
            db.add(models.MonthlyBudget(
                recurring_entry_id=src.recurring_entry_id,
                mes=req.to_mes,
                anio=req.to_anio,
                monto_real=src.monto_real,
                excluido=bool(getattr(src, "excluido", False)),
                cuenta_gestion_id=getattr(src, "cuenta_gestion_id", None),
                movido_a_cuenta=bool(getattr(src, "movido_a_cuenta", False)),
                movido_checked_at=None,
            ))
            copied += 1
    db.commit()
    return {"copied": copied, "total": len(source)}

@router.post("/budget/sync-subs")
def sync_subs_to_recurring(db: Session = Depends(get_db)):
    """Create a RecurringEntry for each Subscription not already tracked in the budget."""
    subs = db.query(models.Subscription).all()
    existing_names = {r.nombre for r in db.query(models.RecurringEntry).all()}
    created = []
    for sub in subs:
        if sub.nombre not in existing_names:
            entry = models.RecurringEntry(
                nombre=sub.nombre,
                monto_estimado=sub.monto,
                es_ingreso=False,
                es_fijo=True,
                categoria="Suscripciones",
                empresa=None,
            )
            db.add(entry)
            created.append(sub.nombre)
    db.commit()
    return {"created": created, "total": len(created)}


@router.get("/budget/reconcile/{mes}/{anio}")
def budget_reconcile(mes: int, anio: int, db: Session = Depends(get_db)):
    """Compare budget expense entries with bank transactions for a month."""
    from datetime import datetime

    start = datetime(anio, mes, 1)
    end = datetime(anio + 1, 1, 1) if mes == 12 else datetime(anio, mes + 1, 1)

    txs = (
        db.query(models.Transaction)
        .options(joinedload(models.Transaction.splits))
        .filter(models.Transaction.date >= start, models.Transaction.date < end)
        .all()
    )
    entries = db.query(models.RecurringEntry).filter(models.RecurringEntry.es_ingreso.is_(False)).all()
    excluded_ids = {
        row.recurring_entry_id
        for row in db.query(models.MonthlyBudget).filter(
            models.MonthlyBudget.mes == mes,
            models.MonthlyBudget.anio == anio,
            models.MonthlyBudget.excluido.is_(True),
        ).all()
    }

    spent_by_cat: dict[str, float] = {}
    for tx in txs:
        spent = budget_expense_amount(tx)
        if spent <= 0:
            continue
        cat = (normalize_category(tx.category_anon) or "Sin categoría")
        spent_by_cat[cat] = spent_by_cat.get(cat, 0) + spent

    planned_by_cat: dict[str, float] = {}
    entry_rows = []
    for entry in entries:
        if entry.id in excluded_ids:
            continue
        cat = normalize_category(entry.categoria) or (entry.categoria or "General").strip()
        if entry.tipo_partida == "suscripcion":
            cat = SUBSCRIPTION_CATEGORY
        planned_by_cat[cat] = planned_by_cat.get(cat, 0) + float(entry.monto_estimado or 0)
        entry_rows.append({
            "entry_id": entry.id,
            "nombre": entry.nombre,
            "categoria": cat,
            "planned": float(entry.monto_estimado or 0),
        })

    categories = sorted(set(planned_by_cat.keys()) | set(spent_by_cat.keys()))
    by_category = []
    for cat in categories:
        planned = planned_by_cat.get(cat, 0)
        spent = spent_by_cat.get(cat, 0)
        by_category.append({
            "categoria": cat,
            "planned": planned,
            "spent": spent,
            "delta": spent - planned,
            "status": "conciliado" if planned > 0 and abs(spent - planned) <= max(5, planned * 0.1)
            else "parcial" if spent > 0 and planned > 0
            else "sin_movimiento" if spent == 0 and planned > 0
            else "extra_en_banco",
        })

    unmatched_expenses = [
        {
            "id": tx.id,
            "amount": float(tx.amount),
            "category_anon": tx.category_anon,
            "description_raw": tx.description_raw,
            "date": tx.date.isoformat() if tx.date else None,
            "account_id": tx.account_id,
        }
        for tx in txs
        if not tx.es_interna and not tx.es_pending and not getattr(tx, "excluida_presupuesto", False)
        and float(tx.amount or 0) < 0
        and not (tx.category_anon or "").strip()
    ]

    return {
        "mes": mes,
        "anio": anio,
        "by_category": by_category,
        "entries": entry_rows,
        "unmatched_expenses": unmatched_expenses[:50],
        "internal_transfer_count": sum(1 for tx in txs if tx.es_interna),
        "excluded_from_budget_count": sum(1 for tx in txs if getattr(tx, "excluida_presupuesto", False)),
    }
