"""Recurring entry CRUD, materialize, and fondo balances."""
from __future__ import annotations

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models
from ..database import get_db
from ..helpers import sanitize_string
from ..schemas import RecurringEntry, RecurringEntryCreate
from ..transaction_splits import budget_expense_amount

router = APIRouter()

@router.get("/recurring-entries/", response_model=List[RecurringEntry])
def get_recurrents(db: Session = Depends(get_db)): return db.query(models.RecurringEntry).all()

@router.post("/recurring-entries/", response_model=RecurringEntry)
def create_recurrent(item: RecurringEntryCreate, db: Session = Depends(get_db)):
    db_item = models.RecurringEntry(**item.model_dump())
    db.add(db_item); db.commit(); db.refresh(db_item); return db_item

@router.put("/recurring-entries/{item_id}", response_model=RecurringEntry)
def update_recurrent(item_id: int, item: RecurringEntryCreate, db: Session = Depends(get_db)):
    db_item = db.query(models.RecurringEntry).filter(models.RecurringEntry.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Entrada recurrente no encontrada")
    for k, v in item.model_dump().items(): setattr(db_item, k, v)
    db.commit(); db.refresh(db_item); return db_item

@router.delete("/recurring-entries/{item_id}")
def delete_recurrent(item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(models.RecurringEntry).filter(models.RecurringEntry.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Entrada recurrente no encontrada")
    db.delete(db_item); db.commit(); return {"status": "ok"}

@router.post("/recurring-entries/materialize")
def materialize_recurring(mes: int, anio: int, db: Session = Depends(get_db)):
    """Create transactions for recurring entries that have no matching transaction this month."""
    inicio_mes = datetime(anio, mes, 1)
    if mes == 12:
        fin_mes = datetime(anio + 1, 1, 1)
    else:
        fin_mes = datetime(anio, mes + 1, 1)

    entries = db.query(models.RecurringEntry).all()
    created = []
    skipped = []

    for entry in entries:
        # Check if a transaction with the same description already exists this month
        exists = db.query(models.Transaction).filter(
            models.Transaction.description_raw == entry.nombre,
            models.Transaction.date >= inicio_mes,
            models.Transaction.date < fin_mes
        ).first()
        if exists:
            skipped.append(entry.nombre)
            continue

        # Find a default account (first available)
        account = db.query(models.Account).first()
        if not account:
            skipped.append(entry.nombre)
            continue

        amount = entry.monto_estimado if entry.es_ingreso else -entry.monto_estimado
        tx = models.Transaction(
            account_id=account.id,
            amount=amount,
            category_anon=sanitize_string(entry.categoria or "General"),
            description_raw=sanitize_string(entry.nombre),
            date=inicio_mes,
        )
        db.add(tx)
        created.append(entry.nombre)

    db.commit()
    return {"created": created, "skipped": skipped, "total_created": len(created)}

@router.get("/recurring-entries/fondos/balances")
def get_fondo_balances(db: Session = Depends(get_db)):
    """Return accumulated balance for each es_fondo=True entry.
    If linked to an account, returns that account's balance.
    Otherwise computes: sum of monthly contributions since mes_inicio/anio_inicio minus
    sum of all transactions in that category."""
    fondos = db.query(models.RecurringEntry).filter(models.RecurringEntry.es_fondo == True).all()  # noqa: E712
    result = []
    for f in fondos:
        if f.cuenta_destino_id:
            acc = db.query(models.Account).filter(models.Account.id == f.cuenta_destino_id).first()
            balance = float(acc.balance_actual) if acc else 0.0
            source = "account"
        else:
            now = datetime.utcnow()
            start_year = f.anio_inicio or now.year
            start_month = f.mes_inicio or 1
            start_date = datetime(start_year, start_month, 1)
            months_elapsed = (now.year - start_year) * 12 + (now.month - start_month) + 1
            contributions = max(0, months_elapsed) * float(f.monto_estimado or 0)
            spent = sum(
                budget_expense_amount(tx)
                for tx in db.query(models.Transaction).options(
                    joinedload(models.Transaction.splits)
                ).filter(
                    models.Transaction.category_anon == f.categoria,
                    models.Transaction.amount < 0,
                    models.Transaction.date >= start_date,
                ).all()
            )
            balance = contributions - spent
            source = "computed"
        result.append({"id": f.id, "nombre": f.nombre, "balance": round(balance, 2), "source": source})
    return result
