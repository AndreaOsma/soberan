"""Sankey, patrimonio evolution, and payment calendar analytics."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from .. import models
from ..database import get_db
from ..transaction_splits import budget_expense_amount, counts_in_budget

router = APIRouter()

@router.get("/api/sankey/{mes}/{anio}")
@router.get("/sankey/{mes}/{anio}")
def get_sankey_data(mes: int, anio: int, db: Session = Depends(get_db)):
    """Return data formatted for the Sankey diagram."""
    # Transactions for the requested month/year
    start_date = datetime(anio, mes, 1)
    if mes == 12:
        end_date = datetime(anio + 1, 1, 1)
    else:
        end_date = datetime(anio, mes + 1, 1)
    
    txs = db.query(models.Transaction).options(
        joinedload(models.Transaction.splits)
    ).filter(
        models.Transaction.date >= start_date,
        models.Transaction.date < end_date
    ).all()

    # Build aggregates for Sankey (omit internals, pending, and user-excluded txs)
    ingresos = sum(t.amount for t in txs if counts_in_budget(t) and t.amount > 0)
    categorias = {}
    for t in txs:
        spent = budget_expense_amount(t)
        if spent <= 0:
            continue
        cat = t.category_anon or "Otros"
        categorias[cat] = categorias.get(cat, 0) + spent
    
    # Sankey format: nodes and links
    nodes = ["Ingresos", "Patrimonio"] + list(categorias.keys())
    source = [0]  # Income -> net worth (patrimonio)
    target = [1]
    value = [ingresos]
    
    # Links from net worth to expense categories
    for i, (cat, val) in enumerate(categorias.items()):
        source.append(1)
        target.append(i + 2)
        value.append(val)
    
    return {
        "nodes": nodes,
        "links": {
            "source": source,
            "target": target,
            "value": value
        }
    }

@router.get("/api/patrimonio/evolucion/{anio}")
@router.get("/patrimonio/evolucion/{anio}")
def get_patrimonio_evolucion(anio: int, db: Session = Depends(get_db)):
    """Return net-worth evolution over time, one point per calendar month."""
    now = datetime.utcnow()
    year_start = datetime(anio, 1, 1)
    year_end = datetime(anio + 1, 1, 1)
    query_end = min(now, year_end)
    if query_end <= year_start:
        return []

    txs = db.query(models.Transaction).filter(
        models.Transaction.date >= year_start,
        models.Transaction.date < query_end,
    ).order_by(models.Transaction.date).all()
    if not txs:
        return []

    # Running total per month, carried forward through months without transactions.
    acumulado_by_month: dict[int, float] = {}
    acumulado = 0.0
    for tx in txs:
        acumulado += tx.amount
        acumulado_by_month[tx.date.month] = acumulado

    last_month = query_end.month if query_end.year == anio else 12

    result = []
    running = 0.0
    for m in range(1, last_month + 1):
        if m in acumulado_by_month:
            running = acumulado_by_month[m]
        result.append({"fecha": f"{anio}-{m:02d}", "acumulado": round(running, 2)})

    return result

@router.get("/api/calendario/pagos/anio/{anio}")
@router.get("/calendario/pagos/anio/{anio}")
def get_calendario_pagos_anio(anio: int, db: Session = Depends(get_db)):
    """Return payment calendar events for a full calendar year."""
    from ..calendar_events import build_payment_calendar_horizon

    return build_payment_calendar_horizon(db, 1, anio, 12)

@router.get("/api/calendario/pagos/{mes}/{anio}")
@router.get("/calendario/pagos/{mes}/{anio}")
def get_calendario_pagos(mes: int, anio: int, db: Session = Depends(get_db)):
    """Return payment calendar events."""
    from ..calendar_events import build_payment_calendar_events

    return build_payment_calendar_events(db, mes, anio)
