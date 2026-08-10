"""Debt, payment, and installment routes."""
from __future__ import annotations

import calendar
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..helpers import sanitize_string
from ..schemas import (
    Debt,
    DebtCreate,
    DebtInstallmentBulk,
    DebtInstallmentCreate,
    DebtInstallmentOut,
    DebtPaymentCreate,
    DebtPaymentOut,
)

router = APIRouter()

def _debt_to_schema(db: Session, debt: models.Debt) -> Debt:
    from app.debt_sync import paid_total_from_payments

    data = Debt.model_validate(debt).model_dump()
    data["monto_pagado_registrado"] = paid_total_from_payments(db, debt.id)
    return Debt(**data)

# Deudas
@router.get("/debts/", response_model=List[Debt])
def get_debts(db: Session = Depends(get_db)):
    from app.debt_sync import reconcile_all_debts_monto_pagado

    reconcile_all_debts_monto_pagado(db)
    db.commit()
    debts = db.query(models.Debt).all()
    return [_debt_to_schema(db, debt) for debt in debts]

def _validate_installment_payload(item: DebtInstallmentCreate) -> dict:
    data = item.model_dump()
    if data["cuota_total"] <= 0:
        raise ValueError("La cuota total debe ser mayor que cero.")
    if data["numero_cuota"] < 1:
        raise ValueError("El número de cuota debe ser al menos 1.")
    fecha = (data.get("fecha_vencimiento") or "").strip()
    if len(fecha) < 10:
        raise ValueError("La fecha de vencimiento debe ser una fecha ISO válida (YYYY-MM-DD).")
    try:
        datetime.strptime(fecha[:10], "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("La fecha de vencimiento debe ser una fecha ISO válida (YYYY-MM-DD).") from exc
    data["fecha_vencimiento"] = fecha[:10]
    if data.get("notas"):
        data["notas"] = sanitize_string(str(data["notas"]))[:2000]
    return data

def _clamp_charge_day(day: int) -> int:
    return max(1, min(int(day), 31))


def _charge_datetime(year: int, month: int, day: int) -> datetime:
    last = calendar.monthrange(year, month)[1]
    return datetime(year, month, min(_clamp_charge_day(day), last))


def _get_debt_or_404(debt_id: int, db: Session) -> models.Debt:
    debt = db.query(models.Debt).filter(models.Debt.id == debt_id).first()
    if not debt:
        raise HTTPException(status_code=404, detail="Deuda no encontrada")
    return debt

@router.post("/debts/", response_model=Debt)
def create_debt(item: DebtCreate, db: Session = Depends(get_db)):
    item.acreedor = sanitize_string(item.acreedor)
    if item.notas:
        item.notas = sanitize_string(item.notas)[:2000]
    data = item.model_dump()
    data["monto_pagado"] = max(0.0, min(float(data["monto_pagado"]), float(data["monto_total"])))
    data["archivada"] = float(data["monto_total"]) - float(data["monto_pagado"]) <= 0.01
    if data.get("dia_cargo_mensual") is not None:
        data["dia_cargo_mensual"] = _clamp_charge_day(data["dia_cargo_mensual"])
    db_item = models.Debt(**data)
    db.add(db_item); db.commit(); db.refresh(db_item); return db_item

@router.put("/debts/{item_id}", response_model=Debt)
def update_debt(item_id: int, item: DebtCreate, db: Session = Depends(get_db)):
    from app.debt_sync import reconcile_debt_monto_pagado, sync_installment_pagada_from_payments

    db_item = db.query(models.Debt).filter(models.Debt.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Deuda no encontrada")
    item.acreedor = sanitize_string(item.acreedor)
    if item.notas:
        item.notas = sanitize_string(item.notas)[:2000]
    data = item.model_dump()
    data["monto_pagado"] = max(0.0, min(float(data["monto_pagado"]), float(data["monto_total"])))
    if data.get("dia_cargo_mensual") is not None:
        data["dia_cargo_mensual"] = _clamp_charge_day(data["dia_cargo_mensual"])
    for k, v in data.items():
        setattr(db_item, k, v)
    reconcile_debt_monto_pagado(db, item_id)
    sync_installment_pagada_from_payments(db, item_id)
    db.commit()
    db.refresh(db_item)
    return _debt_to_schema(db, db_item)

@router.delete("/debts/{item_id}")
def delete_debt(item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(models.Debt).filter(models.Debt.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Deuda no encontrada")
    db.query(models.DebtPayment).filter(models.DebtPayment.debt_id == item_id).delete()
    db.query(models.DebtInstallment).filter(models.DebtInstallment.debt_id == item_id).delete()
    db.delete(db_item); db.commit(); return {"status": "ok"}

# Debt payments
@router.get("/debts/{debt_id}/payments", response_model=List[DebtPaymentOut])
def get_debt_payments(debt_id: int, db: Session = Depends(get_db)):
    return db.query(models.DebtPayment).filter(models.DebtPayment.debt_id == debt_id).order_by(models.DebtPayment.fecha.desc()).all()

@router.post("/debts/{debt_id}/payments", response_model=DebtPaymentOut)
def create_debt_payment(debt_id: int, item: DebtPaymentCreate, db: Session = Depends(get_db)):
    from app.debt_sync import reconcile_debt_monto_pagado, sync_installment_pagada_from_payments

    debt = db.query(models.Debt).filter(models.Debt.id == debt_id).first()
    if not debt:
        raise HTTPException(status_code=404, detail="Deuda no encontrada")
    pay = models.DebtPayment(debt_id=debt_id, **item.model_dump())
    db.add(pay)
    db.flush()
    reconcile_debt_monto_pagado(db, debt_id)
    sync_installment_pagada_from_payments(db, debt_id)
    db.commit(); db.refresh(pay); return pay

@router.delete("/debts/{debt_id}/payments/{pay_id}")
def delete_debt_payment(debt_id: int, pay_id: int, db: Session = Depends(get_db)):
    from app.debt_sync import reconcile_debt_monto_pagado, sync_installment_pagada_from_payments

    pay = db.query(models.DebtPayment).filter(models.DebtPayment.id == pay_id, models.DebtPayment.debt_id == debt_id).first()
    if not pay:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    db.delete(pay)
    db.flush()
    reconcile_debt_monto_pagado(db, debt_id)
    sync_installment_pagada_from_payments(db, debt_id)
    db.commit(); return {"status": "ok"}

# Debt installments (creditor payment schedule / planilla)
@router.get("/debts/installments", response_model=List[DebtInstallmentOut])
def get_all_debt_installments(db: Session = Depends(get_db)):
    from app.debt_sync import sync_all_installment_pagada

    sync_all_installment_pagada(db)
    db.commit()
    return (
        db.query(models.DebtInstallment)
        .order_by(models.DebtInstallment.fecha_vencimiento, models.DebtInstallment.numero_cuota)
        .all()
    )

@router.get("/debts/{debt_id}/installments", response_model=List[DebtInstallmentOut])
def get_debt_installments(debt_id: int, db: Session = Depends(get_db)):
    from app.debt_sync import sync_installment_pagada_from_payments

    _get_debt_or_404(debt_id, db)
    sync_installment_pagada_from_payments(db, debt_id)
    db.commit()
    return (
        db.query(models.DebtInstallment)
        .filter(models.DebtInstallment.debt_id == debt_id)
        .order_by(models.DebtInstallment.fecha_vencimiento, models.DebtInstallment.numero_cuota)
        .all()
    )

@router.post("/debts/{debt_id}/installments", response_model=DebtInstallmentOut)
def create_debt_installment(debt_id: int, item: DebtInstallmentCreate, db: Session = Depends(get_db)):
    from app.debt_sync import enrich_installment_rows, sync_installment_pagada_from_payments

    debt = _get_debt_or_404(debt_id, db)
    try:
        data = _validate_installment_payload(item)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    dup = db.query(models.DebtInstallment).filter(
        models.DebtInstallment.debt_id == debt_id,
        models.DebtInstallment.numero_cuota == data["numero_cuota"],
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail=f"Ya existe la cuota nº {data['numero_cuota']} para esta deuda.")
    data.pop("pagada", None)
    enriched = enrich_installment_rows(debt, [data])[0]
    row = models.DebtInstallment(debt_id=debt_id, **enriched)
    db.add(row)
    db.flush()
    sync_installment_pagada_from_payments(db, debt_id)
    db.commit()
    db.refresh(row)
    return row

@router.put("/debts/{debt_id}/installments/bulk", response_model=List[DebtInstallmentOut])
def replace_debt_installments(debt_id: int, body: DebtInstallmentBulk, db: Session = Depends(get_db)):
    from app.debt_sync import enrich_installment_rows, sync_installment_pagada_from_payments

    debt = _get_debt_or_404(debt_id, db)
    validated: List[dict] = []
    seen_nums: set = set()
    for item in body.installments:
        try:
            data = _validate_installment_payload(item)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        if data["numero_cuota"] in seen_nums:
            raise HTTPException(status_code=400, detail=f"Cuota nº {data['numero_cuota']} duplicada en la planilla.")
        seen_nums.add(data["numero_cuota"])
        data.pop("pagada", None)
        validated.append(data)
    validated = enrich_installment_rows(debt, validated)
    db.query(models.DebtInstallment).filter(models.DebtInstallment.debt_id == debt_id).delete()
    rows = []
    for data in validated:
        row = models.DebtInstallment(debt_id=debt_id, **data)
        db.add(row)
        rows.append(row)
    db.flush()
    sync_installment_pagada_from_payments(db, debt_id)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows

@router.put("/debts/{debt_id}/installments/{inst_id}", response_model=DebtInstallmentOut)
def update_debt_installment(debt_id: int, inst_id: int, item: DebtInstallmentCreate, db: Session = Depends(get_db)):
    from app.debt_sync import enrich_installment_rows, sync_installment_pagada_from_payments

    debt = _get_debt_or_404(debt_id, db)
    row = db.query(models.DebtInstallment).filter(
        models.DebtInstallment.id == inst_id,
        models.DebtInstallment.debt_id == debt_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Cuota de planilla no encontrada")
    try:
        data = _validate_installment_payload(item)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    dup = db.query(models.DebtInstallment).filter(
        models.DebtInstallment.debt_id == debt_id,
        models.DebtInstallment.numero_cuota == data["numero_cuota"],
        models.DebtInstallment.id != inst_id,
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail=f"Ya existe la cuota nº {data['numero_cuota']} para esta deuda.")
    data.pop("pagada", None)
    enriched = enrich_installment_rows(debt, [data])[0]
    for k, v in enriched.items():
        setattr(row, k, v)
    db.flush()
    sync_installment_pagada_from_payments(db, debt_id)
    db.commit()
    db.refresh(row)
    return row

@router.delete("/debts/{debt_id}/installments/{inst_id}")
def delete_debt_installment(debt_id: int, inst_id: int, db: Session = Depends(get_db)):
    row = db.query(models.DebtInstallment).filter(
        models.DebtInstallment.id == inst_id,
        models.DebtInstallment.debt_id == debt_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Cuota de planilla no encontrada")
    db.delete(row)
    db.commit()
    return {"status": "ok"}
