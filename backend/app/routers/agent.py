"""OpenClaw agent context, commands, and transaction hooks."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models
from ..anonymizer import DataAnonymizer
from ..config import get_config
from ..database import get_db
from ..helpers import sanitize_string, validate_transaction_category
from ..schemas import AgentCommandRequest, AgentCommandResponse, AgentTransactionCreate
from ..transaction_splits import budget_expense_amount

router = APIRouter()

@router.get("/api/agent/context")
@router.get("/agent/context")
def agent_ctx(db: Session = Depends(get_db)):
    return DataAnonymizer(db, sensitive_words=get_config()["sensitive_words"]).get_anonymized_context()

@router.get("/api/agent/commands")
@router.get("/agent/commands")
def agent_commands():
    """Catalog of commands supported for OpenClaw."""
    return {
        "commands": [
            {
                "command": "get_context",
                "description": "Obtiene contexto anonimizado de finanzas para prompting del agente.",
                "payload": {}
            },
            {
                "command": "add_transaction",
                "description": "Registra un movimiento (ingreso/gasto) por alias de cuenta.",
                "payload": {
                    "cuenta_alias": "ACC_XXXXXX",
                    "monto": -45.90,
                    "categoria": "Supermercado",
                    "descripcion": "Compra Mercadona"
                }
            },
            {
                "command": "get_audit",
                "description": "Devuelve auditoría de gasto del mes en curso por categoría.",
                "payload": {}
            },
            {
                "command": "resolve_account_alias",
                "description": "Resuelve alias de cuenta a id interno.",
                "payload": {"cuenta_alias": "ACC_XXXXXX"}
            }
        ]
    }

@router.get("/agent/accounts")
def agent_accounts(db: Session = Depends(get_db)):
    """Account listing suitable for agents (alias + bank + balance)."""
    rows = db.query(models.Account).all()
    return {
        "accounts": [
            {
                "id": a.id,
                "alias_anonimo": a.alias_anonimo,
                "banco": a.banco,
                "balance_actual": a.balance_actual
            }
            for a in rows
        ]
    }

@router.post("/agent/transaction")
def agent_tx(tx: AgentTransactionCreate, db: Session = Depends(get_db)):
    rid = DataAnonymizer(db, sensitive_words=get_config()["sensitive_words"]).resolve_account_id_by_alias(tx.cuenta_alias)
    if not rid:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada para el alias indicado")
    cat = validate_transaction_category(tx.categoria)
    db_tx = models.Transaction(account_id=rid, amount=tx.monto, category_anon=cat, description_raw=tx.descripcion, date=datetime.utcnow())
    db.add(db_tx)
    db.commit(); return {"status": "ok", "transaction": {"account_id": rid, "amount": tx.monto, "categoria": cat, "descripcion": tx.descripcion}}

@router.get("/agent/audit")
def agent_audit(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    this_m = datetime(now.year, now.month, 1)
    txs = db.query(models.Transaction).options(joinedload(models.Transaction.splits)).filter(
        models.Transaction.date >= this_m
    ).all()
    exp = {}
    for t in txs:
        spent = budget_expense_amount(t)
        if spent <= 0:
            continue
        c = t.category_anon or "Varios"
        exp[c] = exp.get(c, 0) + spent
    top_categories = sorted(exp.items(), key=lambda kv: kv[1], reverse=True)[:5]
    return {"period": now.strftime("%B %Y"), "spent": sum(exp.values()), "breakdown": exp, "top_categories": top_categories}

@router.post("/agent/command", response_model=AgentCommandResponse)
def agent_command(req: AgentCommandRequest, db: Session = Depends(get_db)):
    """Single endpoint for OpenClaw: runs typed commands."""
    cmd = (req.command or "").strip().lower()
    payload = req.payload or {}

    if cmd == "get_context":
        return AgentCommandResponse(ok=True, command=cmd, result={"context": DataAnonymizer(db, sensitive_words=get_config()["sensitive_words"]).get_anonymized_context()})

    if cmd == "get_audit":
        now = datetime.utcnow()
        this_m = datetime(now.year, now.month, 1)
        txs = db.query(models.Transaction).options(joinedload(models.Transaction.splits)).filter(
            models.Transaction.date >= this_m
        ).all()
        exp = {}
        for t in txs:
            spent = budget_expense_amount(t)
            if spent <= 0:
                continue
            c = t.category_anon or "Varios"
            exp[c] = exp.get(c, 0) + spent
        top_categories = sorted(exp.items(), key=lambda kv: kv[1], reverse=True)[:5]
        return AgentCommandResponse(
            ok=True,
            command=cmd,
            result={"period": now.strftime("%B %Y"), "spent": sum(exp.values()), "breakdown": exp, "top_categories": top_categories}
        )

    if cmd == "resolve_account_alias":
        alias = payload.get("cuenta_alias")
        if not alias:
            raise HTTPException(status_code=400, detail="payload.cuenta_alias es obligatorio")
        rid = DataAnonymizer(db, sensitive_words=get_config()["sensitive_words"]).resolve_account_id_by_alias(alias)
        if not rid:
            raise HTTPException(status_code=404, detail="Alias no encontrado")
        return AgentCommandResponse(ok=True, command=cmd, result={"account_id": rid, "cuenta_alias": alias})

    if cmd == "add_transaction":
        required = ["cuenta_alias", "monto", "categoria", "descripcion"]
        missing = [k for k in required if k not in payload]
        if missing:
            raise HTTPException(status_code=400, detail=f"Faltan campos en payload: {', '.join(missing)}")
        rid = DataAnonymizer(db, sensitive_words=get_config()["sensitive_words"]).resolve_account_id_by_alias(str(payload["cuenta_alias"]))
        if not rid:
            raise HTTPException(status_code=404, detail="Alias no encontrado")
        cat = validate_transaction_category(str(payload["categoria"]))
        amount = float(payload["monto"])
        desc = sanitize_string(str(payload["descripcion"]))
        db_tx = models.Transaction(account_id=rid, amount=amount, category_anon=cat, description_raw=desc, date=datetime.utcnow())
        db.add(db_tx)
        db.commit()
        return AgentCommandResponse(ok=True, command=cmd, result={"status": "ok", "account_id": rid, "amount": amount, "categoria": cat})

    raise HTTPException(status_code=400, detail=f"Comando no soportado: {req.command}")
