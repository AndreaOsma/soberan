"""Investment CRUD routes."""
from __future__ import annotations

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..schemas import Investment, InvestmentCreate

router = APIRouter()

# Investments
@router.get("/investments/", response_model=List[Investment])
def get_invs(db: Session = Depends(get_db)): return db.query(models.Investment).all()

@router.post("/investments/", response_model=Investment)
def create_inv(item: InvestmentCreate, db: Session = Depends(get_db)):
    data = item.model_dump()
    fi = data.pop("fecha_inicio", None)
    db_item = models.Investment(**data)
    if fi:
        try: db_item.fecha_inicio = datetime.fromisoformat(fi)
        except Exception: pass
    db.add(db_item); db.commit(); db.refresh(db_item); return db_item

@router.put("/investments/{item_id}")
def update_inv(item_id: int, item: InvestmentCreate, db: Session = Depends(get_db)):
    db_item = db.query(models.Investment).filter(models.Investment.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Inversión no encontrada")
    data = item.model_dump()
    fi = data.pop("fecha_inicio", None)
    for k, v in data.items(): setattr(db_item, k, v)
    if fi:
        try: db_item.fecha_inicio = datetime.fromisoformat(fi)
        except Exception: pass
    db.commit(); return db_item

@router.delete("/investments/{item_id}")
def delete_inv(item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(models.Investment).filter(models.Investment.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Inversión no encontrada")
    db.delete(db_item); db.commit(); return {"status": "ok"}
