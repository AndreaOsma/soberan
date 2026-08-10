"""Work history CRUD routes."""
from __future__ import annotations

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..schemas import WorkHistory, WorkHistoryCreate

router = APIRouter()

# Vida Laboral
@router.get("/work-history/", response_model=List[WorkHistory])
def get_work(db: Session = Depends(get_db)):
    items = db.query(models.WorkHistory).all()
    today = datetime.utcnow()
    for item in items:
        if item.fecha_inicio:
            end = item.fecha_fin if item.fecha_fin else today
            item.dias_alta = (end - item.fecha_inicio).days
    return items

@router.post("/work-history/", response_model=WorkHistory)
def create_work(item: WorkHistoryCreate, db: Session = Depends(get_db)):
    db_item = models.WorkHistory(**item.model_dump())
    db.add(db_item); db.commit(); db.refresh(db_item); return db_item

@router.put("/work-history/{item_id}")
def update_work(item_id: int, item: WorkHistoryCreate, db: Session = Depends(get_db)):
    db_item = db.query(models.WorkHistory).filter(models.WorkHistory.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Registro de vida laboral no encontrado")
    for k, v in item.model_dump().items(): setattr(db_item, k, v)
    db.commit(); return db_item

@router.delete("/work-history/{item_id}")
def delete_work(item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(models.WorkHistory).filter(models.WorkHistory.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Registro de vida laboral no encontrado")
    db.delete(db_item); db.commit(); return {"status": "ok"}
