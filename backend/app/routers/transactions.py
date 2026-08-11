"""Transaction CRUD routes."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models
from ..database import get_db
from ..helpers import validate_transaction_category
from ..internal_transfers import mark_internal_pair, unmark_internal
from ..schemas import (
    MarkInternalBody,
    Transaction,
    TransactionCreate,
    TransactionSplitBulk,
    TransactionSplitOut,
    TransactionUpdate,
)
from ..transaction_splits import unsettled_owed_by_person, validate_split_payload

router = APIRouter()


def _tx_query(db: Session):
    return db.query(models.Transaction).options(joinedload(models.Transaction.splits))


@router.get("/transactions/", response_model=List[Transaction])
def get_txs(db: Session = Depends(get_db)):
    return _tx_query(db).order_by(models.Transaction.date.desc()).all()


@router.get("/transactions/split-balances")
def get_split_balances(db: Session = Depends(get_db)):
    txs = _tx_query(db).filter(models.Transaction.amount < 0).all()
    by_person = unsettled_owed_by_person(txs)
    return {
        "by_person": [
            {"person_name": name, "amount": round(amount, 2)}
            for name, amount in sorted(by_person.items(), key=lambda kv: (-kv[1], kv[0]))
        ],
        "total": round(sum(by_person.values()), 2),
    }


@router.post("/transactions/", response_model=Transaction)
def create_tx(item: TransactionCreate, db: Session = Depends(get_db)):
    """Create a transaction. Does not change account balance (bank sync / manual edit owns it)."""
    item.category_anon = validate_transaction_category(item.category_anon)
    data = item.model_dump()
    tx_date = data.pop("date", None)
    db_item = models.Transaction(**data)
    if tx_date is not None:
        db_item.date = tx_date
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return _tx_query(db).filter(models.Transaction.id == db_item.id).one()


@router.put("/transactions/{item_id}", response_model=Transaction)
def update_tx(item_id: int, item: TransactionUpdate, db: Session = Depends(get_db)):
    # Allow empty category on update so imported/uncategorized rows remain editable.
    item.category_anon = validate_transaction_category(item.category_anon, required=False)
    db_item = _tx_query(db).filter(models.Transaction.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    old_abs = abs(float(db_item.amount or 0))
    data = item.model_dump()
    tx_date = data.pop("date", None)
    for k, v in data.items():
        setattr(db_item, k, v)
    if tx_date is not None:
        db_item.date = tx_date
    new_abs = abs(float(item.amount or 0))
    if db_item.splits and abs(old_abs - new_abs) > 0.02:
        db_item.splits.clear()
    elif db_item.splits and float(item.amount or 0) >= 0:
        db_item.splits.clear()
    db.commit()
    return _tx_query(db).filter(models.Transaction.id == item_id).one()


@router.put("/transactions/{item_id}/splits", response_model=List[TransactionSplitOut])
def put_tx_splits(item_id: int, body: TransactionSplitBulk, db: Session = Depends(get_db)):
    tx = _tx_query(db).filter(models.Transaction.id == item_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    try:
        rows = validate_split_payload(float(tx.amount or 0), [s.model_dump() for s in body.splits])
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    tx.splits.clear()
    for row in rows:
        tx.splits.append(models.TransactionSplit(**row))
    db.commit()
    tx = _tx_query(db).filter(models.Transaction.id == item_id).one()
    return tx.splits


@router.get("/transactions/{item_id}/splits", response_model=List[TransactionSplitOut])
def get_tx_splits(item_id: int, db: Session = Depends(get_db)):
    tx = _tx_query(db).filter(models.Transaction.id == item_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    return tx.splits


@router.delete("/transactions/{item_id}")
def delete_tx(item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(models.Transaction).filter(models.Transaction.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    db.delete(db_item)
    db.commit()
    return {"status": "ok"}


@router.post("/transactions/{item_id}/mark-internal")
def mark_tx_internal(item_id: int, body: MarkInternalBody, db: Session = Depends(get_db)):
    tx = db.query(models.Transaction).filter(models.Transaction.id == item_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    if body.other_transaction_id:
        other = db.query(models.Transaction).filter(models.Transaction.id == body.other_transaction_id).first()
        if not other:
            raise HTTPException(status_code=404, detail="Transacción pareja no encontrada")
        pair_id = mark_internal_pair(db, tx, other)
        db.commit()
        return {"status": "ok", "transfer_pair_id": pair_id}
    tx.es_interna = True
    tx.transfer_pair_id = tx.id
    tx.category_anon = "Transferencia interna"
    db.commit()
    return {"status": "ok", "transfer_pair_id": tx.id}


@router.post("/transactions/{item_id}/unmark-internal")
def unmark_tx_internal(item_id: int, db: Session = Depends(get_db)):
    unmark_internal(db, item_id)
    return {"status": "ok"}


@router.post("/transactions/{item_id}/exclude-from-budget")
def exclude_tx_from_budget(item_id: int, db: Session = Depends(get_db)):
    """Omit transaction from budget spent/income totals (keeps it in history and balance)."""
    tx = db.query(models.Transaction).filter(models.Transaction.id == item_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    tx.excluida_presupuesto = True
    db.commit()
    return {"status": "ok"}


@router.post("/transactions/{item_id}/include-in-budget")
def include_tx_in_budget(item_id: int, db: Session = Depends(get_db)):
    tx = db.query(models.Transaction).filter(models.Transaction.id == item_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    tx.excluida_presupuesto = False
    db.commit()
    return {"status": "ok"}
