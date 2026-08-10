"""AI chat endpoints and Ollama helpers."""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime
from typing import List, Optional
from urllib.parse import urlsplit

import requests
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..desktop import is_desktop_mode

logger = logging.getLogger("soberan")
router = APIRouter()

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]

class ChatResponse(BaseModel):
    reply: str

def _chat_tool_call(name: str, input: dict, db: Session) -> str:
    now = datetime.utcnow()
    mes = input.get("mes", now.month)
    anio = input.get("anio", now.year)

    if name == "get_resumen":
        accs = db.query(models.Account).all()
        total_cash = round(sum(a.balance_actual for a in accs), 2)
        debts = db.query(models.Debt).all()
        debt_total = round(sum(max(0, d.monto_total - d.monto_pagado) for d in debts), 2)
        invs = db.query(models.Investment).all()
        inv_total = round(sum(i.valor_actual for i in invs), 2)
        props = db.query(models.Property).all()
        assets_total = round(sum(p.valor_estimado for p in props), 2)
        goals = db.query(models.Goal).all()
        return json.dumps({
            "liquidez_total": total_cash,
            "deuda_pendiente": debt_total,
            "inversiones": inv_total,
            "activos_fijos": assets_total,
            # Debe coincidir exactamente con totals.netWorth del frontend
            # (useSoberanData.ts): cash + activos fijos + inversiones - deuda.
            # Antes se omitían los activos fijos aquí, dando una cifra distinta
            # a la que ve el usuario en el dashboard.
            "patrimonio_neto": round(total_cash + assets_total + inv_total - debt_total, 2),
            "nota": (
                "patrimonio_neto YA tiene deuda_pendiente restada. No la restes de nuevo "
                "(p.ej. nunca digas 'tu balance real tras pagar deudas sería patrimonio_neto "
                "menos deuda_pendiente' — eso resta la deuda dos veces y es incorrecto)."
            ),
            "moneda": "EUR",
            "metas": [{"nombre": g.nombre, "actual": round(g.monto_actual, 2), "objetivo": round(g.monto_objetivo, 2)} for g in goals],
        }, ensure_ascii=False)

    if name == "get_transacciones":
        start = datetime(anio, mes, 1)
        end = datetime(anio + (1 if mes == 12 else 0), 1 if mes == 12 else mes + 1, 1)
        txs = db.query(models.Transaction).filter(
            models.Transaction.date >= start,
            models.Transaction.date < end,
        ).order_by(models.Transaction.date.desc()).all()
        acc_map = {a.id: a.alias_real for a in db.query(models.Account).all()}
        return json.dumps([{
            "fecha": t.date.strftime("%Y-%m-%d"),
            "descripcion": t.description_raw,
            "importe": t.amount,
            "categoria": t.category_anon,
            "cuenta": acc_map.get(t.account_id, "?"),
        } for t in txs], ensure_ascii=False)

    if name == "get_presupuesto":
        recurring = db.query(models.RecurringEntry).all()
        budgets = db.query(models.MonthlyBudget).filter(
            models.MonthlyBudget.mes == mes,
            models.MonthlyBudget.anio == anio,
        ).all()
        bmap = {b.recurring_entry_id: b.monto_real for b in budgets}
        return json.dumps([{
            "concepto": r.nombre,
            "categoria": r.categoria,
            "es_ingreso": r.es_ingreso,
            "presupuestado": round(bmap.get(r.id, r.monto_estimado), 2),
            "estimado_base": round(r.monto_estimado, 2),
        } for r in recurring], ensure_ascii=False)

    if name == "get_propiedades":
        props = db.query(models.Property).all()
        return json.dumps([{
            "nombre": p.nombre,
            "tipo": p.tipo,
            "valor_estimado": p.valor_estimado,
            "marca": p.marca,
            "modelo": p.modelo,
            "anio": p.anio,
            "km": p.km,
        } for p in props], ensure_ascii=False)

    if name == "get_inversiones":
        invs = db.query(models.Investment).all()
        return json.dumps([{
            "nombre": i.nombre,
            "tipo": i.tipo,
            "monto_invertido": i.monto_invertido,
            "valor_actual": i.valor_actual,
            "rendimiento_pct": round(((i.valor_actual - i.monto_invertido) / i.monto_invertido * 100) if i.monto_invertido else 0, 2),
        } for i in invs], ensure_ascii=False)

    if name == "get_vida_laboral":
        items = db.query(models.WorkHistory).all()
        today = datetime.utcnow()
        result = []
        for w in items:
            dias = (today - w.fecha_inicio).days if not w.fecha_fin else w.dias_alta
            entry = {
                "empresa": w.empresa,
                "fecha_inicio": w.fecha_inicio.strftime("%Y-%m-%d"),
                "fecha_fin": w.fecha_fin.strftime("%Y-%m-%d") if w.fecha_fin else "actualidad",
                "dias_alta": dias,
                # Suffixed _anual/_mensual on the field name itself, not a
                # shared sibling "periodicidad" field — confirmed live: the
                # model applied salario_bruto's periodicidad to
                # salario_neto_mensual too and divided an already-monthly
                # figure by 12 again (2112€/mes -> a nonsense "176€/mes").
                "salario_bruto_anual" if w.periodicidad == "A" else "salario_bruto_mensual": w.salario_bruto,
                "activa": w.fecha_fin is None,
            }
            # Pre-computed monthly net salary — same formula as the frontend
            # (useSoberanData.ts activeSalary). Given here explicitly so the
            # model reports it as-is instead of estimating/inventing its own
            # weekly or monthly figure (confirmed live: it fabricated a
            # "557.63€/semana" that came from nowhere when this field wasn't
            # available and the question required a monthly-income number).
            # salario_neto_mensual is ALWAYS monthly regardless of how the
            # gross is paid — the name says so, never divide it by 12.
            if w.salario_bruto is not None and w.fecha_fin is None:
                bruto_mensual = (w.salario_bruto / 12) if w.periodicidad == "A" else w.salario_bruto
                irpf = bruto_mensual * (w.irpf_pct or 0.0) / 100
                ss = bruto_mensual * (w.ss_pct or 0.0) / 100
                entry["salario_neto_mensual"] = round(bruto_mensual - irpf - ss, 2)
                entry["nota"] = "salario_neto_mensual ya está calculado por mes, no lo dividas entre 12."
            result.append(entry)
        return json.dumps(result, ensure_ascii=False)

    if name == "crear_transaccion":
        account = db.query(models.Account).filter(models.Account.id == input["cuenta_id"]).first()
        if not account:
            return json.dumps({"error": "Cuenta no encontrada"})
        tx = models.Transaction(
            date=datetime.strptime(input["fecha"], "%Y-%m-%d"),
            description_raw=input["descripcion"],
            amount=input["importe"],
            category_anon=input.get("categoria", "Otros gastos"),
            account_id=input["cuenta_id"],
        )
        db.add(tx); db.commit()
        return json.dumps({"ok": True, "id": tx.id}, ensure_ascii=False)

    if name == "get_cuentas":
        accounts = db.query(models.Account).all()
        return json.dumps([{"id": a.id, "nombre": a.alias_real, "saldo": round(a.balance_actual, 2), "tipo": a.tipo} for a in accounts], ensure_ascii=False)

    if name == "editar_transaccion":
        tx = db.query(models.Transaction).filter(models.Transaction.id == input["id"]).first()
        if not tx:
            return json.dumps({"error": "Transacción no encontrada"})
        if "fecha" in input:
            tx.date = datetime.strptime(input["fecha"], "%Y-%m-%d")
        if "descripcion" in input:
            tx.description_raw = input["descripcion"]
        if "categoria" in input:
            tx.category_anon = input["categoria"]
        if "importe" in input:
            tx.amount = input["importe"]
        if "cuenta_id" in input:
            tx.account_id = input["cuenta_id"]
        db.commit()
        return json.dumps({"ok": True, "id": tx.id}, ensure_ascii=False)

    if name == "eliminar_transaccion":
        tx = db.query(models.Transaction).filter(models.Transaction.id == input["id"]).first()
        if not tx:
            return json.dumps({"error": "Transacción no encontrada"})
        db.delete(tx)
        db.commit()
        return json.dumps({"ok": True}, ensure_ascii=False)

    if name == "crear_meta":
        goal = models.Goal(
            nombre=input["nombre"],
            monto_objetivo=input["monto_objetivo"],
            monto_actual=input.get("monto_actual", 0.0),
        )
        db.add(goal); db.commit()
        return json.dumps({"ok": True, "id": goal.id}, ensure_ascii=False)

    if name == "actualizar_meta":
        goal = db.query(models.Goal).filter(models.Goal.id == input["id"]).first()
        if not goal:
            return json.dumps({"error": "Meta no encontrada"})
        goal.monto_actual = input["monto_actual"]
        db.commit()
        return json.dumps({"ok": True}, ensure_ascii=False)

    if name == "registrar_pago_deuda":
        debt = db.query(models.Debt).filter(models.Debt.id == input["debt_id"]).first()
        if not debt:
            return json.dumps({"error": "Deuda no encontrada"})
        db.add(models.DebtPayment(
            debt_id=debt.id,
            monto=input["monto"],
            fecha=input["fecha"],
            notas=input.get("notas"),
        ))
        debt.monto_pagado = (debt.monto_pagado or 0.0) + input["monto"]
        db.commit()
        return json.dumps({"ok": True, "monto_pagado_total": round(debt.monto_pagado, 2)}, ensure_ascii=False)

    if name == "ajustar_presupuesto":
        b = db.query(models.MonthlyBudget).filter(
            models.MonthlyBudget.recurring_entry_id == input["recurring_entry_id"],
            models.MonthlyBudget.mes == input["mes"],
            models.MonthlyBudget.anio == input["anio"],
        ).first()
        if b:
            b.monto_real = input["monto_real"]
        else:
            b = models.MonthlyBudget(
                recurring_entry_id=input["recurring_entry_id"],
                mes=input["mes"],
                anio=input["anio"],
                monto_real=input["monto_real"],
            )
            db.add(b)
        db.commit()
        return json.dumps({"ok": True}, ensure_ascii=False)

    return json.dumps({"error": f"Tool desconocida: {name}"})


CHAT_TOOLS = [
    {"type": "function", "function": {"name": "get_resumen", "description": "Resumen financiero global: saldo total, deudas, metas.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_transacciones", "description": "Transacciones de un mes/año.", "parameters": {"type": "object", "properties": {"mes": {"type": "integer"}, "anio": {"type": "integer"}}}}},
    {"type": "function", "function": {"name": "get_presupuesto", "description": "Presupuesto vs real de un mes/año.", "parameters": {"type": "object", "properties": {"mes": {"type": "integer"}, "anio": {"type": "integer"}}}}},
    {"type": "function", "function": {"name": "get_propiedades", "description": "Propiedades: coche, inmuebles y su valor estimado.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_inversiones", "description": "Inversiones y su rendimiento.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_vida_laboral", "description": "Historial laboral, salario y nómina (bruto y neto mensual ya calculado). Usa esta herramienta para cualquier pregunta sobre sueldo, salario o nómina.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_cuentas", "description": "Lista de cuentas bancarias con saldo e ID.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "crear_transaccion", "description": "Crea una transacción. Usa importe negativo para gastos, positivo para ingresos.", "parameters": {
        "type": "object",
        "properties": {
            "cuenta_id": {"type": "integer", "description": "ID de la cuenta"},
            "fecha": {"type": "string", "description": "Fecha YYYY-MM-DD"},
            "descripcion": {"type": "string"},
            "importe": {"type": "number", "description": "Negativo para gastos"},
            "categoria": {"type": "string"},
        },
        "required": ["cuenta_id", "fecha", "descripcion", "importe"],
    }}},
    {"type": "function", "function": {"name": "editar_transaccion", "description": "Edita una transacción existente. Solo incluye los campos que cambian.", "parameters": {
        "type": "object",
        "properties": {
            "id": {"type": "integer", "description": "ID de la transacción a editar"},
            "cuenta_id": {"type": "integer"},
            "fecha": {"type": "string", "description": "Fecha YYYY-MM-DD"},
            "descripcion": {"type": "string"},
            "importe": {"type": "number"},
            "categoria": {"type": "string"},
        },
        "required": ["id"],
    }}},
    {"type": "function", "function": {"name": "eliminar_transaccion", "description": "Elimina una transacción por su ID.", "parameters": {
        "type": "object",
        "properties": {"id": {"type": "integer", "description": "ID de la transacción a eliminar"}},
        "required": ["id"],
    }}},
    {"type": "function", "function": {"name": "crear_meta", "description": "Crea una nueva meta de ahorro.", "parameters": {
        "type": "object",
        "properties": {
            "nombre": {"type": "string"},
            "monto_objetivo": {"type": "number"},
            "monto_actual": {"type": "number", "description": "Progreso inicial, por defecto 0"},
        },
        "required": ["nombre", "monto_objetivo"],
    }}},
    {"type": "function", "function": {"name": "actualizar_meta", "description": "Actualiza el progreso (monto actual) de una meta existente.", "parameters": {
        "type": "object",
        "properties": {
            "id": {"type": "integer", "description": "ID de la meta"},
            "monto_actual": {"type": "number"},
        },
        "required": ["id", "monto_actual"],
    }}},
    {"type": "function", "function": {"name": "registrar_pago_deuda", "description": "Registra un pago hecho a una deuda existente.", "parameters": {
        "type": "object",
        "properties": {
            "debt_id": {"type": "integer", "description": "ID de la deuda"},
            "monto": {"type": "number", "description": "Importe pagado, siempre positivo"},
            "fecha": {"type": "string", "description": "Fecha YYYY-MM-DD"},
            "notas": {"type": "string"},
        },
        "required": ["debt_id", "monto", "fecha"],
    }}},
    {"type": "function", "function": {"name": "ajustar_presupuesto", "description": "Fija el importe real presupuestado de una partida recurrente para un mes/año concretos.", "parameters": {
        "type": "object",
        "properties": {
            "recurring_entry_id": {"type": "integer", "description": "ID de la partida recurrente"},
            "mes": {"type": "integer"},
            "anio": {"type": "integer"},
            "monto_real": {"type": "number"},
        },
        "required": ["recurring_entry_id", "mes", "anio", "monto_real"],
    }}},
]

# Tools that mutate data. The model may propose calling these, but they never
# execute inline — chat_endpoint pauses the stream and asks the user to
# confirm first (see _describe_write / /chat/confirm). Letting an LLM write
# to financial records without a human confirming first is the kind of
# mistake that's expensive to leave in a money-management app.
WRITE_TOOLS = {
    "crear_transaccion", "editar_transaccion", "eliminar_transaccion",
    "crear_meta", "actualizar_meta", "registrar_pago_deuda", "ajustar_presupuesto",
}


def _describe_write(name: str, args: dict, db: Session) -> str:
    """Human-readable summary of a pending write, shown to the user before executing."""
    if name == "crear_transaccion":
        acc = db.query(models.Account).filter(models.Account.id == args.get("cuenta_id")).first()
        acc_name = acc.alias_real if acc else f"cuenta #{args.get('cuenta_id')}"
        return f"Crear transacción: {args.get('importe')}€ · \"{args.get('descripcion')}\" · {args.get('fecha')} · {acc_name}"
    if name == "editar_transaccion":
        changes = ", ".join(f"{k}={v}" for k, v in args.items() if k != "id")
        return f"Editar transacción #{args.get('id')}: {changes}"
    if name == "eliminar_transaccion":
        return f"Eliminar transacción #{args.get('id')}"
    if name == "crear_meta":
        return f"Crear meta \"{args.get('nombre')}\" · objetivo {args.get('monto_objetivo')}€"
    if name == "actualizar_meta":
        return f"Actualizar progreso de meta #{args.get('id')} a {args.get('monto_actual')}€"
    if name == "registrar_pago_deuda":
        return f"Registrar pago de {args.get('monto')}€ a deuda #{args.get('debt_id')} ({args.get('fecha')})"
    if name == "ajustar_presupuesto":
        return f"Ajustar presupuesto de partida #{args.get('recurring_entry_id')} ({args.get('mes')}/{args.get('anio')}) a {args.get('monto_real')}€"
    return f"{name}({args})"

SYSTEM_PROMPT = """Eres el asistente financiero personal integrado en Soberan.
Tienes acceso a los datos financieros reales del usuario mediante herramientas.
Responde en español, de forma concisa. Usa las herramientas para obtener datos reales antes de contestar.
No inventes cifras. Todas las cantidades están en euros (€) — nunca uses el símbolo $ ni menciones dólares.

Cuidado con la aritmética derivada, no solo con copiar cifras: patrimonio_neto de
get_resumen ya tiene la deuda restada (es liquidez + activos + inversiones - deuda).
No la vuelvas a restar en tu explicación — pagar una deuda con tu propio dinero no
reduce el patrimonio neto, solo cambia su composición (menos liquidez, menos deuda,
el neto casi no cambia). Antes de dar recomendaciones o analizar algo (presupuesto,
deudas, inversiones, metas), llama primero a la herramienta correspondiente y cita
cifras concretas del usuario — nunca des consejos genéricos de plantilla ("revisa tu
presupuesto", "diversifica tus inversiones") sin haber consultado antes los datos
reales que los justifiquen.

No hagas tú los cálculos financieros — usa exclusivamente las cifras que ya vienen
calculadas en el resultado de las herramientas (p.ej. salario_neto_mensual de
get_vida_laboral). Si necesitas una cifra derivada que no está en ningún resultado
de herramienta, dilo explícitamente ("no tengo ese dato") en vez de estimarla o
inventar un cálculo — nunca inventes periodicidades (semanal, diaria) que no te
haya dado ninguna herramienta. Preguntas sobre nómina, sueldo o salario van con
get_vida_laboral, no con get_resumen. Nunca menciones nombres de herramientas o
funciones al usuario (p.ej. no digas "usa get_presupuesto") — son para ti, no para
él; si el usuario debe hacer algo, dile la acción en español normal.

Responde directamente a lo que se te pregunta, con la herramienta que de verdad
corresponde a esa pregunta. No cambies de tema ni metas datos no pedidos (p.ej. si
preguntan por la nómina, no te pongas a hablar del fondo de emergencia salvo que
el usuario lo pida) — eso diluye la respuesta y no contesta lo que se preguntó."""

TOOL_LABELS = {
    "get_resumen": "Consultando tu resumen financiero…",
    "get_transacciones": "Consultando transacciones…",
    "get_presupuesto": "Consultando presupuesto…",
    "get_propiedades": "Consultando propiedades…",
    "get_inversiones": "Consultando inversiones…",
    "get_vida_laboral": "Consultando historial laboral…",
    "get_cuentas": "Consultando cuentas…",
    "crear_transaccion": "Preparando transacción…",
    "editar_transaccion": "Preparando edición…",
    "eliminar_transaccion": "Preparando eliminación…",
    "crear_meta": "Preparando meta…",
    "actualizar_meta": "Preparando actualización de meta…",
    "registrar_pago_deuda": "Preparando pago de deuda…",
    "ajustar_presupuesto": "Preparando ajuste de presupuesto…",
}

_TOOL_NAME_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(name) for name in TOOL_LABELS) + r")(\(\))?\b"
)
_TRAILING_CODE_PATTERN = re.compile(r"\n*[A-Za-z][\w.]*\([^)\n]*\)\.?\s*$")


def _sanitize_reply(text: str) -> str:
    """Best-effort cleanup of internal tool/function names and stray
    pseudo-code the model sometimes leaks into user-facing text instead of
    a real tool_call. Confirmed live twice: a trailing
    "CallChecka.get_resumen()" appended to an otherwise normal reply, and
    "...compartir ese detalle a través de get_vida_laboral" asking the user
    to do something only the model itself can do. This hides the ugliest
    visible symptom — it doesn't fix the underlying unreliability, and the
    resulting sentence can read a little awkward once the name is gone.
    """
    if not text:
        return text
    text = _TRAILING_CODE_PATTERN.sub("", text)
    text = _TOOL_NAME_PATTERN.sub("", text)
    # Cleanup for what's left once the name is gone: empty ``code`` marks,
    # and the common "según/con/mediante la herramienta <nothing>" phrasing
    # (confirmed live: "Según la herramienta ``, trabajas en..." — the name
    # removed cleanly, but the surrounding phrase and backticks didn't).
    text = re.sub(r"`+\s*`+", "", text)
    text = re.sub(
        r"\b(según|con|mediante|usando|a través de)\s+la\s+herramienta\s*,?",
        "Según los datos,",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\bla\s+herramienta\s*,?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bfunción\s*,?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+,", ",", text)
    text = re.sub(r",\s*,", ",", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _user_setting_str(db: Session, key: str, default: str = "") -> str:
    row = db.query(models.UserSettings).filter(models.UserSettings.key == key).first()
    if not row or row.value is None:
        return default
    return str(row.value).strip()


def _chat_enabled(db: Session) -> bool:
    return _user_setting_str(db, "chat_enabled", "1").lower() not in {"0", "false", "off", "no"}


def _is_loopback_ollama_url(url: str) -> bool:
    """True if url points at 127.0.0.1/localhost/::1 — only meaningful when
    THIS process is the one dialing it. In desktop mode the backend really
    does run on the user's own machine, so that's correct. In web/hosted
    mode the backend is soberan-api's own Docker container: 127.0.0.1 there
    is the container's own loopback, not the user's PC, and nothing listens
    on 11434 inside it — the request just fails, and without this check it
    silently looks like generic "offline" with no clue why.
    """
    try:
        host = urlsplit(url).hostname or ""
    except ValueError:
        return False
    return host in {"127.0.0.1", "localhost", "::1"}


def _resolve_ollama_base_url(db: Session, override: Optional[str] = None) -> str:
    if override and override.strip():
        return override.strip().rstrip("/")
    from_settings = _user_setting_str(db, "ollama_base_url")
    if from_settings:
        return from_settings.rstrip("/")
    env = (os.environ.get("OLLAMA_BASE_URL") or "").strip()
    if env:
        return env.rstrip("/")
    return "http://127.0.0.1:11434"


def _resolve_ollama_model(db: Session) -> str:
    return _user_setting_str(db, "ollama_model") or (os.environ.get("OLLAMA_MODEL") or "llama3:8b").strip() or "llama3:8b"


def _probe_ollama(base_url: str) -> str:
    if not base_url:
        return "offline"
    if not is_desktop_mode() and _is_loopback_ollama_url(base_url):
        return "local_only"
    try:
        r = requests.get(f"{base_url.rstrip('/')}/api/tags", timeout=4)
        return "ok" if r.ok else "error"
    except Exception:
        return "offline"


class ChatTestRequest(BaseModel):
    url: Optional[str] = None


@router.get("/api/chat/status")
@router.get("/chat/status")
def chat_status(db: Session = Depends(get_db)):
    enabled = _chat_enabled(db)
    ollama_url = _resolve_ollama_base_url(db)
    status = _probe_ollama(ollama_url) if enabled else "disabled"
    return {
        "ollama": status,
        "enabled": enabled,
        "url": ollama_url or None,
        "model": _resolve_ollama_model(db),
        "desktop": is_desktop_mode(),
    }


@router.post("/api/chat/test")
@router.post("/chat/test")
def chat_test(req: ChatTestRequest, db: Session = Depends(get_db)):
    ollama_url = _resolve_ollama_base_url(db, req.url)
    status = _probe_ollama(ollama_url)
    return {
        "ollama": status,
        "url": ollama_url or None,
        "ok": status == "ok",
        "desktop": is_desktop_mode(),
    }


@router.post("/api/chat")
@router.post("/chat")
def chat_endpoint(req: ChatRequest, db: Session = Depends(get_db)):
    if not _chat_enabled(db):
        raise HTTPException(status_code=403, detail="El asistente está desactivado en Ajustes.")
    ollama_url = _resolve_ollama_base_url(db)
    if not ollama_url:
        raise HTTPException(
            status_code=503,
            detail="Configura la URL de Ollama en Ajustes → Asistente.",
        )
    if not is_desktop_mode() and _is_loopback_ollama_url(ollama_url):
        raise HTTPException(
            status_code=503,
            detail=(
                f"La URL de Ollama ({ollama_url}) apunta al propio servidor, no a tu "
                "ordenador — en la versión web, quien hace la petición es el contenedor "
                "de Soberan, no tu navegador. Usa una URL accesible desde el servidor "
                "(p.ej. https://ollama.tudominio.com), o instala la app de escritorio "
                "si quieres usar un Ollama local."
            ),
        )
    model = _resolve_ollama_model(db)
    endpoint = f"{ollama_url}/v1/chat/completions"

    messages: list = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages += [{"role": m.role, "content": m.content} for m in req.messages]

    def stream():
        # Status lines reflect real backend state (each yield happens right
        # before/after the work it describes) — not a fake animated timer.
        # ndjson: one JSON object per line, either {"status": ...} or a
        # terminal {"reply": ...} / {"error": ...}.
        yield json.dumps({"status": "Pensando…"}) + "\n"
        for _ in range(6):  # max tool-use turns
            try:
                resp = requests.post(endpoint, json={
                    "model": model,
                    "messages": messages,
                    "tools": CHAT_TOOLS,
                    "stream": False,
                }, timeout=60)
                resp.raise_for_status()
            except Exception as exc:
                yield json.dumps({"error": f"Ollama no disponible: {exc}"}) + "\n"
                return

            data = resp.json()
            choice = data["choices"][0]
            msg = choice["message"]
            finish = choice.get("finish_reason")

            if finish == "tool_calls" and msg.get("tool_calls"):
                messages.append(msg)
                pending_writes = []
                for tc in msg["tool_calls"]:
                    fn = tc["function"]
                    try:
                        args = json.loads(fn["arguments"]) if fn["arguments"] else {}
                    except Exception as exc:
                        logger.warning("Tool args parse error for %s: %s", fn["name"], exc)
                        args = {}

                    if fn["name"] in WRITE_TOOLS:
                        # Never execute a write inline — surface it for the
                        # user to confirm and stop the model loop here. The
                        # actual mutation only happens via /chat/confirm.
                        pending_writes.append({
                            "call_id": tc.get("id", fn["name"]),
                            "tool": fn["name"],
                            "args": args,
                            "summary": _describe_write(fn["name"], args, db),
                        })
                        continue

                    label = TOOL_LABELS.get(fn["name"], f"Consultando {fn['name']}…")
                    yield json.dumps({"status": label}) + "\n"
                    result = _chat_tool_call(fn["name"], args, db)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.get("id", fn["name"]),
                        "content": result,
                    })

                if pending_writes:
                    yield json.dumps({"confirm": pending_writes}) + "\n"
                    return

                yield json.dumps({"status": "Generando respuesta…"}) + "\n"
                continue

            yield json.dumps({"reply": _sanitize_reply(msg.get("content")) or "Sin respuesta."}) + "\n"
            return

        yield json.dumps({"reply": "No he podido procesar la consulta. Inténtalo de nuevo."}) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


class ConfirmWrite(BaseModel):
    tool: str
    args: dict


class ChatConfirmRequest(BaseModel):
    writes: List[ConfirmWrite]


@router.post("/api/chat/confirm")
@router.post("/chat/confirm")
def chat_confirm(req: ChatConfirmRequest, db: Session = Depends(get_db)):
    if not _chat_enabled(db):
        raise HTTPException(status_code=403, detail="El asistente está desactivado en Ajustes.")
    lines = []
    for w in req.writes:
        if w.tool not in WRITE_TOOLS:
            lines.append(f"⚠️ Acción no permitida: {w.tool}")
            continue
        summary = _describe_write(w.tool, w.args, db)
        raw = _chat_tool_call(w.tool, w.args, db)
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {}
        if isinstance(parsed, dict) and parsed.get("error"):
            lines.append(f"❌ {summary} — {parsed['error']}")
        else:
            lines.append(f"✅ {summary}")
    return {"reply": "\n".join(lines)}
