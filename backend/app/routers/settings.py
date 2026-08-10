"""User settings get/set routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..schemas import SettingBase

router = APIRouter()


@router.get("/settings/")
def list_settings(
    keys: str | None = Query(None, description="Comma-separated keys; omit for all"),
    db: Session = Depends(get_db),
):
    """Return settings as { key: value }. Missing keys are omitted (client fills "")."""
    q = db.query(models.UserSettings)
    if keys:
        wanted = [k.strip() for k in keys.split(",") if k.strip()]
        if wanted:
            q = q.filter(models.UserSettings.key.in_(wanted))
    rows = q.all()
    return {row.key: (row.value if row.value is not None else "") for row in rows}


@router.get("/settings/{key}")
def get_set(key: str, db: Session = Depends(get_db)):
    db_set = db.query(models.UserSettings).filter(models.UserSettings.key == key).first()
    return {"value": db_set.value if db_set else None}


@router.post("/settings/")
def post_set(setting: SettingBase, db: Session = Depends(get_db)):
    db_set = db.query(models.UserSettings).filter(models.UserSettings.key == setting.key).first()
    if db_set:
        db_set.value = setting.value
    else:
        db_set = models.UserSettings(**setting.model_dump())
        db.add(db_set)
    db.commit()
    return {"status": "ok"}
