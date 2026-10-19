"""Sincronización con Garaje (km reales del coche ↔ valoración, deuda y gastos)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..garaje_sync import run_garaje_sync

router = APIRouter()


@router.post("/integrations/garaje/sync")
def garaje_sync(force: bool = False, db: Session = Depends(get_db)):
    """Sin `force`, como mucho una vez cada 30 min (el frontend la lanza al cargar)."""
    return run_garaje_sync(db, force=force)
