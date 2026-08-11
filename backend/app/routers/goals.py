"""Goal CRUD routes."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..schemas import Goal, GoalCreate

router = APIRouter()

# Goals
def _validate_goal_destino(item: GoalCreate) -> None:
    has_account = item.account_id is not None
    has_cartera = bool((item.cartera_destino or "").strip())
    if has_account and has_cartera:
        raise HTTPException(status_code=400, detail="Un objetivo solo puede vincularse a una cuenta o a una cartera.")

@router.get("/goals/", response_model=List[Goal])
def get_goals(db: Session = Depends(get_db)): return db.query(models.Goal).all()

@router.post("/goals/", response_model=Goal)
def create_goal(item: GoalCreate, db: Session = Depends(get_db)):
    _validate_goal_destino(item)
    db_item = models.Goal(**item.model_dump())
    db.add(db_item); db.commit(); db.refresh(db_item); return db_item

@router.put("/goals/{item_id}")
def update_goal(item_id: int, item: GoalCreate, db: Session = Depends(get_db)):
    _validate_goal_destino(item)
    db_item = db.query(models.Goal).filter(models.Goal.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Meta no encontrada")
    for k, v in item.model_dump().items(): setattr(db_item, k, v)
    db.commit(); return db_item

@router.delete("/goals/{item_id}")
def delete_goal(item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(models.Goal).filter(models.Goal.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Meta no encontrada")
    db.delete(db_item); db.commit(); return {"status": "ok"}
