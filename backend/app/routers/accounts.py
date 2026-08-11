"""Account CRUD routes."""
from __future__ import annotations

import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..helpers import sanitize_string
from ..schemas import Account, AccountCreate

router = APIRouter()

# Cuentas
@router.get("/accounts/", response_model=List[Account])
def get_accounts(db: Session = Depends(get_db)): return db.query(models.Account).all()

@router.post("/accounts/", response_model=Account)
def create_account(account: AccountCreate, db: Session = Depends(get_db)):
    account.alias_real = sanitize_string(account.alias_real)
    if not account.alias_anonimo: account.alias_anonimo = f"ACC_{uuid.uuid4().hex[:6].upper()}"
    db_item = models.Account(**account.model_dump())
    db.add(db_item); db.commit(); db.refresh(db_item); return db_item

@router.put("/accounts/{item_id}")
def update_account(item_id: int, item: AccountCreate, db: Session = Depends(get_db)):
    db_item = db.query(models.Account).filter(models.Account.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    for k, v in item.model_dump().items(): setattr(db_item, k, v)
    db.commit(); return db_item

@router.delete("/accounts/{item_id}")
def delete_account(item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(models.Account).filter(models.Account.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    db.delete(db_item); db.commit(); return {"status": "ok"}
