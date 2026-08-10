"""Money-owed CRUD routes."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..schemas import MoneyOwed, MoneyOwedCreate

router = APIRouter()

# Me deben
@router.get("/money-owed/", response_model=List[MoneyOwed])
def get_owed(db: Session = Depends(get_db)): return db.query(models.MoneyOwed).all()

@router.post("/money-owed/", response_model=MoneyOwed)
def create_owed(item: MoneyOwedCreate, db: Session = Depends(get_db)):
    db_item = models.MoneyOwed(**item.model_dump())
    db.add(db_item); db.commit(); db.refresh(db_item); return db_item

@router.put("/money-owed/{item_id}")
def update_owed(item_id: int, item: MoneyOwedCreate, db: Session = Depends(get_db)):
    db_item = db.query(models.MoneyOwed).filter(models.MoneyOwed.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Registro 'me deben' no encontrado")
    for k, v in item.model_dump().items(): setattr(db_item, k, v)
    db.commit(); return db_item

@router.delete("/money-owed/{item_id}")
def delete_owed(item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(models.MoneyOwed).filter(models.MoneyOwed.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Registro 'me deben' no encontrado")
    db.delete(db_item); db.commit(); return {"status": "ok"}
