"""Card CRUD routes."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..schemas import Card, CardCreate

router = APIRouter()

# Tarjetas
@router.get("/cards/", response_model=List[Card])
def get_cards(db: Session = Depends(get_db)): return db.query(models.Card).all()

@router.post("/cards/", response_model=Card)
def create_card(item: CardCreate, db: Session = Depends(get_db)):
    db_item = models.Card(**item.model_dump())
    db.add(db_item); db.commit(); db.refresh(db_item); return db_item

@router.put("/cards/{item_id}")
def update_card(item_id: int, item: CardCreate, db: Session = Depends(get_db)):
    db_item = db.query(models.Card).filter(models.Card.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    for k, v in item.model_dump().items(): setattr(db_item, k, v)
    db.commit(); return db_item

@router.delete("/cards/{item_id}")
def delete_card(item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(models.Card).filter(models.Card.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    db.delete(db_item); db.commit(); return {"status": "ok"}
