"""Property CRUD and vehicle valuation routes."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..schemas import Property, PropertyCreate

router = APIRouter()

# Propiedades
@router.get("/properties/", response_model=List[Property])
def get_props(db: Session = Depends(get_db)): return db.query(models.Property).all()

@router.post("/properties/", response_model=Property)
def create_prop(item: PropertyCreate, db: Session = Depends(get_db)):
    db_item = models.Property(**item.model_dump())
    db.add(db_item); db.commit(); db.refresh(db_item); return db_item

@router.put("/properties/{item_id}")
def update_prop(item_id: int, item: PropertyCreate, db: Session = Depends(get_db)):
    db_item = db.query(models.Property).filter(models.Property.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    for k, v in item.model_dump().items(): setattr(db_item, k, v)
    db.commit(); return db_item

@router.delete("/properties/{item_id}")
def delete_prop(item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(models.Property).filter(models.Property.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    db.delete(db_item); db.commit(); return {"status": "ok"}

@router.post("/properties/vehicle-valuation/refresh-due")
def vehicle_valuation_refresh_due(db: Session = Depends(get_db)):
    """Revalue vehicles with no date or last valuation older than ~30 days (public market only)."""
    from ..vehicle_valuation import (
        VEHICLE_VALUATION_INTERVAL_DAYS,
        estimate_vehicle_value,
        valuation_is_due,
    )

    vehicles = (
        db.query(models.Property)
        .filter(models.Property.tipo == "vehiculo")
        .all()
    )
    refreshed: list[dict] = []
    errors: list[dict] = []
    skipped = 0

    for prop in vehicles:
        if not prop.marca or not prop.modelo:
            skipped += 1
            continue
        if not valuation_is_due(
            prop.valor_actualizado_en,
            interval_days=VEHICLE_VALUATION_INTERVAL_DAYS,
        ):
            skipped += 1
            continue

        try:
            anio = prop.anio
            if isinstance(anio, str) and anio.strip().isdigit():
                anio = int(anio.strip())
            elif not isinstance(anio, int):
                anio = None

            result = estimate_vehicle_value(
                marca=prop.marca,
                modelo=prop.modelo,
                anio=anio,
                km=prop.km if isinstance(prop.km, int) else None,
            )
            prop.valor_estimado = result.valor_estimado
            prop.valor_actualizado_en = result.actualizado_en
            prop.valoracion_json = result.snapshot_json()
            refreshed.append(
                {
                    "id": prop.id,
                    "nombre": prop.nombre,
                    "valor_estimado": result.valor_estimado,
                    "confianza": result.confianza,
                }
            )
        except Exception as exc:
            errors.append({"id": prop.id, "detail": str(exc)})

    if refreshed:
        db.commit()
    return {
        "refreshed": refreshed,
        "skipped": skipped,
        "errors": errors,
        "interval_days": VEHICLE_VALUATION_INTERVAL_DAYS,
    }


@router.post("/properties/vehicle-valuation/{item_id}")
def vehicle_valuation(item_id: int, db: Session = Depends(get_db)):
    """Estimate realizable vehicle value from public market listings (asking → sale haircut)."""
    from ..vehicle_valuation import estimate_vehicle_value

    prop = db.query(models.Property).filter(models.Property.id == item_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Propiedad no encontrada")
    if prop.tipo != "vehiculo":
        raise HTTPException(status_code=400, detail="Solo disponible para tipo vehiculo")
    if not prop.marca or not prop.modelo:
        raise HTTPException(status_code=400, detail="Se requieren marca y modelo para la valoración")

    try:
        anio = prop.anio
        if isinstance(anio, str) and anio.strip().isdigit():
            anio = int(anio.strip())
        elif not isinstance(anio, int):
            anio = None

        result = estimate_vehicle_value(
            marca=prop.marca,
            modelo=prop.modelo,
            anio=anio,
            km=prop.km if isinstance(prop.km, int) else None,
            bastidor=prop.bastidor,
        )
        prop.valor_estimado = result.valor_estimado
        prop.valor_actualizado_en = result.actualizado_en
        prop.valoracion_json = result.snapshot_json()
        db.commit()
        return result.as_dict()
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error al obtener valoración: {str(e)}")
