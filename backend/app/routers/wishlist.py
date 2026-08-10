"""Wishlist CRUD and purchase/promote routes."""
from __future__ import annotations

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..helpers import validate_transaction_category
from ..schemas import WishlistItemCreate, WishlistItemOut, WishlistPurchaseBody

router = APIRouter()

# Wishlist
@router.get("/wishlist/", response_model=List[WishlistItemOut])
def get_wishlist(db: Session = Depends(get_db)):
    return db.query(models.WishlistItem).order_by(models.WishlistItem.prioridad.desc(), models.WishlistItem.id).all()

@router.post("/wishlist/", response_model=WishlistItemOut)
def create_wishlist_item(item: WishlistItemCreate, db: Session = Depends(get_db)):
    db_item = models.WishlistItem(**item.model_dump())
    db.add(db_item); db.commit(); db.refresh(db_item); return db_item

@router.put("/wishlist/{item_id}", response_model=WishlistItemOut)
def update_wishlist_item(item_id: int, item: WishlistItemCreate, db: Session = Depends(get_db)):
    db_item = db.query(models.WishlistItem).filter(models.WishlistItem.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Item no encontrado")
    for k, v in item.model_dump().items():
        setattr(db_item, k, v)
    db.commit(); db.refresh(db_item); return db_item

@router.delete("/wishlist/{item_id}")
def delete_wishlist_item(item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(models.WishlistItem).filter(models.WishlistItem.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Item no encontrado")
    db.delete(db_item); db.commit(); return {"status": "ok"}

@router.post("/wishlist/{item_id}/promote")
def promote_wishlist_item(item_id: int, mes: int, anio: int, db: Session = Depends(get_db)):
    wish = db.query(models.WishlistItem).filter(models.WishlistItem.id == item_id).first()
    if not wish:
        raise HTTPException(status_code=404, detail="Item no encontrado")
    entry = models.RecurringEntry(
        nombre=wish.nombre,
        monto_estimado=wish.monto_estimado or 0.0,
        es_ingreso=False,
        es_fijo=True,
        categoria="Gastos planificados",
        es_puntual=True,
        mes_inicio=mes,
        anio_inicio=anio,
        bloque="deseos",
    )
    db.add(entry)
    db.flush()
    wish.recurring_entry_id = entry.id
    db.commit()
    db.refresh(entry)
    return {"status": "promoted", "recurring_entry_id": entry.id, "wishlist_item_id": wish.id}

@router.post("/wishlist/{item_id}/purchase", response_model=WishlistItemOut)
def purchase_wishlist_item(item_id: int, body: WishlistPurchaseBody, db: Session = Depends(get_db)):
    wish = db.query(models.WishlistItem).filter(models.WishlistItem.id == item_id).first()
    if not wish:
        raise HTTPException(status_code=404, detail="Item no encontrado")
    if wish.archivado or wish.comprado:
        raise HTTPException(status_code=400, detail="Este deseo ya está archivado")

    acc = db.query(models.Account).filter(models.Account.id == body.account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")

    amount = round(-abs(body.monto_real), 2)
    if amount >= -0.005:
        raise HTTPException(status_code=400, detail="El importe debe ser mayor que cero")

    tx_date = body.fecha or datetime.utcnow()
    category = validate_transaction_category("Gastos planificados")
    db_tx = models.Transaction(
        account_id=body.account_id,
        amount=amount,
        category_anon=category,
        description_raw=wish.nombre,
        date=tx_date,
    )
    db.add(db_tx)

    wish.comprado = True
    wish.archivado = True
    wish.monto_real = abs(body.monto_real)
    wish.fecha_compra = tx_date
    db.flush()
    wish.transaction_id = db_tx.id

    db.commit()
    db.refresh(wish)
    db.refresh(db_tx)
    return wish
