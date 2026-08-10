"""Subscription CRUD routes."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..schemas import Subscription, SubscriptionCreate

router = APIRouter()

# Subscriptions
@router.get("/subscriptions/", response_model=List[Subscription])
def get_subs(db: Session = Depends(get_db)): return db.query(models.Subscription).all()

@router.post("/subscriptions/", response_model=Subscription)
def create_sub(item: SubscriptionCreate, db: Session = Depends(get_db)):
    db_item = models.Subscription(**item.model_dump())
    db.add(db_item); db.commit(); db.refresh(db_item); return db_item

@router.put("/subscriptions/{item_id}")
def update_sub(item_id: int, item: SubscriptionCreate, db: Session = Depends(get_db)):
    db_item = db.query(models.Subscription).filter(models.Subscription.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Suscripción no encontrada")
    for k, v in item.model_dump().items(): setattr(db_item, k, v)
    db.commit(); return db_item

@router.delete("/subscriptions/{item_id}")
def delete_sub(item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(models.Subscription).filter(models.Subscription.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Suscripción no encontrada")
    db.delete(db_item); db.commit(); return {"status": "ok"}
