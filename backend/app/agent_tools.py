"""Herramientas para asistentes (ágora): cuentas, movimientos, gasto del mes, presupuesto,
deudas, objetivos, suscripciones y patrimonio, y registrar movimientos. Ver dev/lib/agent-api;
token en SOBERAN_AGENT_TOKEN (distinto de SOBERAN_API_KEY, que protege el /agent antiguo).

Un solo usuario: quien tiene el token ve todas las finanzas. Por eso la API está apagada sin
token y ágora pide confirmación a Andrea antes de cualquier escritura."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from . import models
from .agent_api import AgentError, AgentRegistry
from .expense_categories import EXPENSE_CATEGORIES, INCOME_CATEGORIES
from .helpers import sanitize_string, validate_transaction_category
from .transaction_splits import budget_expense_amount

agent = AgentRegistry("soberan", "Soberan", "Finanzas personales: cuentas, movimientos, presupuesto, deudas, objetivos y patrimonio.",
                      token_env="SOBERAN_AGENT_TOKEN")


def _account(db: Session, name: str) -> models.Account:
    n = name.strip().lower()
    rows = [a for a in db.query(models.Account).filter(models.Account.archivada.isnot(True))]
    hits = [a for a in rows if n in ((a.alias_real or "").lower(), (a.alias_anonimo or "").lower(), (a.banco or "").lower())]
    hits = hits or [a for a in rows if n in (a.alias_real or "").lower() or n in (a.banco or "").lower()]
    if len(hits) != 1:
        raise AgentError("No sé qué cuenta es «{}». Hay: {}.".format(name, "; ".join(f"{a.alias_real} ({a.banco})" for a in rows)), 404)
    return hits[0]


def _tx(t: models.Transaction) -> dict:
    return {"id": t.id, "fecha": t.date.date() if t.date else None, "importe": t.amount, "categoria": t.category_anon,
            "concepto": t.description_raw, "cuenta": t.account.alias_real if getattr(t, "account", None) else t.account_id,
            **({"interna": True} if t.es_interna else {}), **({"pendiente": True} if t.es_pending else {})}


@agent.tool("cuentas", "Cuentas con banco y saldo actual")
def cuentas(db: Session):
    rows = db.query(models.Account).filter(models.Account.archivada.isnot(True)).all()
    return {"total": round(sum(a.balance_actual or 0 for a in rows), 2),
            "cuentas": [{"nombre": a.alias_real, "banco": a.banco, "tipo": a.tipo, "saldo": a.balance_actual,
                         "ultima_sincronizacion": a.last_sync_at} for a in rows]}


class Movs(BaseModel):
    dias: int = Field(30, ge=1, le=730, description="Hacia atrás desde hoy")
    categoria: Optional[str] = Field(None, max_length=60)
    texto: Optional[str] = Field(None, max_length=80, description="Busca en el concepto")
    cuenta: Optional[str] = Field(None, max_length=80)
    limite: int = Field(50, ge=1, le=200)


@agent.tool("movimientos", "Movimientos recientes, filtrables por categoría, texto o cuenta")
def movimientos(db: Session, p: Movs):
    q = db.query(models.Transaction).filter(models.Transaction.date >= datetime.utcnow() - timedelta(days=p.dias))
    if p.categoria:
        q = q.filter(models.Transaction.category_anon.ilike(p.categoria.strip()))
    if p.texto:
        q = q.filter(models.Transaction.description_raw.ilike(f"%{p.texto.strip()}%"))
    if p.cuenta:
        q = q.filter(models.Transaction.account_id == _account(db, p.cuenta).id)
    rows = q.order_by(models.Transaction.date.desc()).limit(p.limite).all()
    return {"movimientos": [_tx(t) for t in rows], "suma": round(sum(t.amount or 0 for t in rows), 2)}


class Mes(BaseModel):
    mes: Optional[int] = Field(None, ge=1, le=12, description="Por defecto, el actual")
    anio: Optional[int] = Field(None, ge=2000, le=2100)


def _month(p: Mes) -> tuple[int, int]:
    today = date.today()
    return p.mes or today.month, p.anio or today.year


@agent.tool("gasto_del_mes", "Gasto e ingresos de un mes por categoría (sin transferencias internas; con gastos compartidos, solo tu parte)")
def gasto_del_mes(db: Session, p: Mes):
    mes, anio = _month(p)
    start = datetime(anio, mes, 1)
    end = datetime(anio + (mes == 12), mes % 12 + 1, 1)
    txs = (db.query(models.Transaction).options(joinedload(models.Transaction.splits))
           .filter(models.Transaction.date >= start, models.Transaction.date < end).all())
    gastos: dict[str, float] = {}
    ingresos = 0.0
    for t in txs:
        spent = budget_expense_amount(t)
        if spent > 0:
            c = t.category_anon or "Sin categoría"
            gastos[c] = round(gastos.get(c, 0) + spent, 2)
        elif (t.amount or 0) > 0 and not t.es_interna and not t.excluida_presupuesto:
            ingresos += t.amount
    return {"mes": f"{mes:02d}/{anio}", "gastado": round(sum(gastos.values()), 2), "ingresos": round(ingresos, 2),
            "por_categoria": dict(sorted(gastos.items(), key=lambda kv: -kv[1]))}


@agent.tool("presupuesto", "Presupuesto del mes frente a lo real (partidas fijas y variables)")
def presupuesto(db: Session, p: Mes):
    from .routers.budget import budget_reconcile

    mes, anio = _month(p)
    try:
        return budget_reconcile(mes, anio, db)
    except HTTPException as e:
        raise AgentError(str(e.detail), e.status_code) from None


@agent.tool("deudas", "Deudas activas: pendiente, cuota y vencimiento")
def deudas(db: Session):
    rows = db.query(models.Debt).filter(models.Debt.archivada.isnot(True)).all()
    out = [{"nombre": d.nombre, "acreedor": d.acreedor, "total": d.monto_total, "pagado": d.monto_pagado,
            "pendiente": round((d.monto_total or 0) - (d.monto_pagado or 0), 2), "cuota_mensual": d.cuota_mensual,
            "tae": d.tasa_anual, "vence": d.fecha_vencimiento} for d in rows]
    return {"pendiente_total": round(sum(d["pendiente"] for d in out), 2), "deudas": out}


@agent.tool("objetivos", "Objetivos de ahorro y cuánto llevas")
def objetivos(db: Session):
    return [{"nombre": g.nombre, "objetivo": g.monto_objetivo, "llevas": g.monto_actual, "fecha_limite": g.fecha_limite,
             "progreso_pct": round(100 * (g.monto_actual or 0) / g.monto_objetivo, 1) if g.monto_objetivo else None}
            for g in db.query(models.Goal)]


@agent.tool("suscripciones", "Suscripciones y su coste")
def suscripciones(db: Session):
    rows = db.query(models.Subscription).all()
    mensual = sum((s.monto or 0) / (12 if (s.frecuencia or "").lower().startswith("anual") else 1) for s in rows)
    return {"coste_mensual_aprox": round(mensual, 2),
            "suscripciones": [{"nombre": s.nombre, "importe": s.monto, "frecuencia": s.frecuencia, "dia_cobro": s.fecha_pago} for s in rows]}


@agent.tool("patrimonio", "Patrimonio neto: cuentas + inversiones + bienes + lo que te deben − deudas")
def patrimonio(db: Session):
    cuentas_ = sum(a.balance_actual or 0 for a in db.query(models.Account).filter(models.Account.archivada.isnot(True)))
    inversiones = sum(i.valor_actual or 0 for i in db.query(models.Investment))
    bienes = sum(p.valor_estimado or 0 for p in db.query(models.Property))
    te_deben = sum(m.monto or 0 for m in db.query(models.MoneyOwed).filter(models.MoneyOwed.pagado.isnot(True)))
    debes = sum((d.monto_total or 0) - (d.monto_pagado or 0) for d in db.query(models.Debt).filter(models.Debt.archivada.isnot(True)))
    return {"cuentas": round(cuentas_, 2), "inversiones": round(inversiones, 2), "bienes": round(bienes, 2),
            "te_deben": round(te_deben, 2), "deudas": round(debes, 2),
            "neto": round(cuentas_ + inversiones + bienes + te_deben - debes, 2)}


@agent.tool("categorias", "Categorías válidas para registrar movimientos")
def categorias(db: Session):
    return {"gasto": list(EXPENSE_CATEGORIES), "ingreso": list(INCOME_CATEGORIES)}


class Movimiento(BaseModel):
    cuenta: str = Field(min_length=1, max_length=80, description="Nombre de la cuenta o banco")
    importe: float = Field(ge=-1_000_000, le=1_000_000, description="Negativo = gasto, positivo = ingreso")
    categoria: str = Field(min_length=1, max_length=60, description="Una de la herramienta categorias")
    concepto: str = Field(min_length=1, max_length=200)
    fecha: date = Field(default_factory=date.today)


@agent.tool("anadir_movimiento", "Registra un gasto o ingreso a mano (no cambia el saldo: lo lleva el banco)", write=True)
def anadir_movimiento(db: Session, p: Movimiento):
    if p.importe == 0:
        raise AgentError("El importe no puede ser 0.")
    acc = _account(db, p.cuenta)
    try:
        cat = validate_transaction_category(p.categoria)
    except HTTPException as e:
        raise AgentError(f"{e.detail} Usa la herramienta categorias.", 400) from None
    t = models.Transaction(account_id=acc.id, amount=p.importe, category_anon=cat, description_raw=sanitize_string(p.concepto),
                           date=datetime.combine(p.fecha, datetime.min.time()))
    db.add(t)
    db.commit()
    db.refresh(t)
    return _tx(t)

# ---------- Avisos (para el parte de la mañana y los avisos por umbral de ágora) ----------
# Formato común: {"nivel": "urgente" | "pronto", "clave": id estable (para no repetir), "texto", "ver"?}


@agent.tool("avisos", "Partidas del presupuesto del mes al 80 % o pasadas, cobros de suscripciones en 3 días y cuentas que no sincronizan")
def avisos(db: Session):
    from .routers.budget import budget_reconcile

    today, out = date.today(), []
    try:
        rec = budget_reconcile(today.month, today.year, db)
    except Exception:  # noqa: BLE001 — un fallo del presupuesto no debe tapar el resto de avisos
        rec = {}
    for row in rec.get("by_category", []):
        planned, spent = row.get("planned") or 0, row.get("spent") or 0
        if planned > 0 and spent >= 0.8 * planned:
            pct = round(100 * spent / planned)
            out.append({"nivel": "urgente" if spent > planned else "pronto", "clave": f"presu-{today:%Y-%m}-{row['categoria']}-{'pasado' if spent > planned else '80'}",
                        "texto": f"{row['categoria']}: llevas {spent:.0f} € de {planned:.0f} € este mes ({pct} %)", "ver": "/"})
    for s in db.query(models.Subscription):
        if s.fecha_pago and 0 <= s.fecha_pago - today.day <= 3 and (s.frecuencia or "mensual").lower().startswith("mens"):
            out.append({"nivel": "pronto", "clave": f"sub-{s.id}-{today:%Y-%m}", "texto": f"El día {s.fecha_pago} te cobran {s.nombre} ({s.monto:.2f} €)"})
    # Fallos de sincronización agrupados por banco y causa (con 20 cuentas de un banco, un aviso
    # por cuenta inundaría el chat).
    groups: dict[tuple[str, str], list[str]] = {}
    for a in db.query(models.Account).filter(models.Account.archivada.isnot(True), models.Account.last_sync_error.isnot(None), models.Account.last_sync_error != ""):
        err = a.last_sync_error.lower()
        cause = ("límite de peticiones de GoCardless" if "limitado" in err or "429" in err else
                 "conflicto en GoCardless (409: suele hacer falta reconectar el banco)" if "409" in err else
                 a.last_sync_error.split(":")[0][:80])
        groups.setdefault((a.banco or "?", cause), []).append(a.alias_real or a.alias_anonimo)
    for (bank, cause), names in sorted(groups.items()):
        out.append({"nivel": "pronto", "clave": f"sync-{bank}-{cause[:20]}-{today}",
                    "texto": f"{bank}: {len(names)} cuenta(s) sin sincronizar por {cause}" + (f" ({names[0]})" if len(names) == 1 else ""),
                    "ver": "/?menu=accounts"})
    return out
