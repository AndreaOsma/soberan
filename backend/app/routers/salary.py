"""Salary breakdown, reconcile, and payroll estimate routes."""
from __future__ import annotations

import json
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..helpers import (
    SALARY_RECONCILIATION_KEY,
    estimate_payroll,
    get_payroll_account_config,
    norm_company_key,
    payroll_company_entry,
    set_payroll_account,
    user_settings_json,
)
from ..schemas import (
    IrpfModelo145Request,
    PayrollAccountConfigResponse,
    PayrollAccountConfigSet,
    PayrollEstimateRequest,
    SalaryBreakdown,
    SalaryBreakdownCreate,
    SalaryReconcileMark,
)
from ..irpf_retencion import calculate_retencion, dependents_from_payload

router = APIRouter()

@router.get("/payroll/account-config", response_model=PayrollAccountConfigResponse)
def payroll_account_config(empresa: str, db: Session = Depends(get_db)):
    return get_payroll_account_config(db, empresa)


@router.post("/payroll/account-config", response_model=PayrollAccountConfigResponse)
def payroll_account_config_set(item: PayrollAccountConfigSet, db: Session = Depends(get_db)):
    return set_payroll_account(
        db,
        item.empresa,
        item.account_id,
        archive_previous_account=item.archive_previous_account,
    )


@router.get("/salary-breakdown/year/{anio}", response_model=List[SalaryBreakdown])
def get_salaries_year(anio: int, db: Session = Depends(get_db)):
    return db.query(models.SalaryBreakdown).filter(models.SalaryBreakdown.anio == anio).order_by(models.SalaryBreakdown.mes).all()

@router.get("/salary-breakdown/{mes}/{anio}", response_model=List[SalaryBreakdown])
def get_salaries(mes: int, anio: int, db: Session = Depends(get_db)):
    return db.query(models.SalaryBreakdown).filter(models.SalaryBreakdown.mes == mes, models.SalaryBreakdown.anio == anio).all()

@router.post("/salary-breakdown/", response_model=SalaryBreakdown)
def update_salary(item: SalaryBreakdownCreate, db: Session = Depends(get_db)):
    db_item = db.query(models.SalaryBreakdown).filter(models.SalaryBreakdown.mes == item.mes, models.SalaryBreakdown.anio == item.anio, models.SalaryBreakdown.empresa == item.empresa).first()
    if db_item:
        for k, v in item.model_dump().items(): setattr(db_item, k, v)
    else:
        db_item = models.SalaryBreakdown(**item.model_dump())
        db.add(db_item)
    
    # Cross-link: create a transaction when an account is set
    if item.account_id:
        acc = db.query(models.Account).filter(models.Account.id == item.account_id).first()
        if acc:
            desc = f"Nómina {item.empresa} {item.mes}/{item.anio}"
            exist = db.query(models.Transaction).filter(models.Transaction.description_raw == desc).first()
            if not exist:
                new_tx = models.Transaction(account_id=item.account_id, amount=item.neto, category_anon="Nómina", description_raw=desc, date=datetime.utcnow())
                db.add(new_tx)
    
    db.commit(); db.refresh(db_item); return db_item

def _salary_reconcile_storage_key(anio: int, mes: int, empresa: str) -> str:
    return f"{int(anio)}|{int(mes)}|{norm_company_key(empresa)}"

@router.get("/api/salary/reconcile")
@router.get("/salary/reconcile")
def get_salary_reconcile(mes: int, anio: int, empresa: str, db: Session = Depends(get_db)):

    rows = db.query(models.SalaryBreakdown).filter(
        models.SalaryBreakdown.mes == mes,
        models.SalaryBreakdown.anio == anio,
    ).all()
    match = next((s for s in rows if norm_company_key(s.empresa) == norm_company_key(empresa)), None)
    reconciliation = user_settings_json(db, SALARY_RECONCILIATION_KEY, {})
    if not isinstance(reconciliation, dict):
        reconciliation = {}
    rkey = _salary_reconcile_storage_key(anio, mes, empresa)
    matched = reconciliation.get(rkey)

    if not match:
        return {
            "expected_neto": None,
            "candidates": [],
            "matched": matched,
            "reconcile_key": rkey,
            "message": "Sin nómina guardada para ese mes y empresa.",
        }

    expected = float(match.neto or 0.0)
    start = datetime(anio, mes, 1)
    end = datetime(anio + (1 if mes == 12 else 0), 1 if mes == 12 else mes + 1, 1)

    txs = db.query(models.Transaction).filter(
        models.Transaction.date >= start,
        models.Transaction.date < end,
        models.Transaction.amount > 0,
    ).order_by(models.Transaction.date.desc()).all()

    tolerance = max(50.0, abs(expected) * 0.02)
    empresa_l = norm_company_key(empresa)
    candidates = []
    for tx in txs:
        diff = abs(float(tx.amount) - expected)
        if diff > tolerance:
            continue
        desc = (tx.description_raw or "").lower()
        cat = (tx.category_anon or "").lower()
        bonus = 0.0
        if "nomina" in cat or "nómina" in cat or "nomina" in desc:
            bonus += 10.0
        if empresa_l and empresa_l in desc:
            bonus += 15.0
        if getattr(match, "account_id", None) and tx.account_id == match.account_id:
            bonus += 5.0
        pcfg_r = payroll_company_entry(db, empresa)
        if isinstance(pcfg_r, dict) and pcfg_r.get("account_id"):
            try:
                if int(tx.account_id) == int(pcfg_r["account_id"]):
                    bonus += 5.0
            except (TypeError, ValueError):
                pass
        score = bonus + max(0.0, 20.0 - diff / max(tolerance, 1.0))
        candidates.append({
            "id": tx.id,
            "amount": round(float(tx.amount), 2),
            "date": tx.date.isoformat() if tx.date else None,
            "description_raw": tx.description_raw,
            "category_anon": tx.category_anon,
            "account_id": tx.account_id,
            "score": round(score, 2),
        })
    candidates.sort(key=lambda x: -x["score"])
    return {
        "expected_neto": round(expected, 2),
        "candidates": candidates[:12],
        "matched": matched,
        "reconcile_key": rkey,
    }

@router.post("/api/salary/reconcile/mark")
@router.post("/salary/reconcile/mark")
def salary_reconcile_mark(item: SalaryReconcileMark, db: Session = Depends(get_db)):
    reconciliation = user_settings_json(db, SALARY_RECONCILIATION_KEY, {})
    if not isinstance(reconciliation, dict):
        reconciliation = {}
    rkey = _salary_reconcile_storage_key(item.anio, item.mes, item.empresa)
    tx = db.query(models.Transaction).filter(models.Transaction.id == item.transaction_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")
    reconciliation[rkey] = {
        "transaction_id": item.transaction_id,
        "amount": float(tx.amount),
        "marked_at": datetime.utcnow().isoformat() + "Z",
    }
    payload = json.dumps(reconciliation, ensure_ascii=False)
    row = db.query(models.UserSettings).filter(models.UserSettings.key == SALARY_RECONCILIATION_KEY).first()
    if row:
        row.value = payload
    else:
        db.add(models.UserSettings(key=SALARY_RECONCILIATION_KEY, value=payload))
    db.commit()
    return {"status": "ok", "reconcile_key": rkey}

@router.post("/api/payroll/estimate")
@router.post("/payroll/estimate")
def payroll_estimate(req: PayrollEstimateRequest):
    """Estimate Spanish payroll net from gross (orientative)."""
    return estimate_payroll(
        bruto_mensual=req.bruto_mensual,
        pagas=req.pagas or 14,
        ss_pct=req.ss_pct,
        contract_type=req.contract_type or "indefinido",
        personal_minimum=req.personal_minimum if req.personal_minimum is not None else 5550.0,
        work_expense=req.work_expense if req.work_expense is not None else 2000.0,
        irpf_pct_override=req.irpf_pct_override,
    )


@router.post("/api/payroll/retencion-modelo145")
@router.post("/payroll/retencion-modelo145")
def payroll_retencion_modelo145(req: IrpfModelo145Request):
    """AEAT-style withholding rate from Modelo 145 personal/family inputs."""
    situation = req.family_situation if req.family_situation in ("1", "2", "3") else "3"
    disability = req.disability if req.disability in ("none", "33_64", "65_plus") else "none"
    contract = req.contract_type if req.contract_type in ("indefinido", "temporal", "especial") else "indefinido"
    deps = dependents_from_payload([d.model_dump() for d in (req.dependents or [])])
    return calculate_retencion(
        annual_gross=req.annual_gross,
        age=req.age,
        family_situation=situation,  # type: ignore[arg-type]
        disability=disability,  # type: ignore[arg-type]
        mobility_reduced=bool(req.mobility_reduced),
        geographic_mobility=bool(req.geographic_mobility),
        dependents=deps,
        contract_type=contract,  # type: ignore[arg-type]
        pagas=req.pagas or 14,
        ss_pct=req.ss_pct,
    )
