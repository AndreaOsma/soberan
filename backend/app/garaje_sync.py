"""Sincronización con Garaje (mantenimiento y diagnóstico OBD del coche).

Soberan inicia siempre la conversación — Garaje no tiene credenciales de Soberan:
1. GET  {garaje}/api/integrations/soberan/config → qué Property va con qué vehículo de
   Garaje, sus km reales (OBD/repostajes/taller) y qué categorías de gasto quiere ver.
2. Actualiza Property.km (solo hacia arriba) y, si el salto es grande, marca la
   valoración de mercado como caducada para que refresh-due la rehaga con los km nuevos.
3. POST {garaje}/api/integrations/soberan/sync con los vehículos (valoración), las
   deudas activas y los gastos de esas categorías — nada más sale de Soberan.

La URL de Garaje sale (por orden) del ajuste `garaje_url`, de SOBERAN_GARAJE_URL o del
fichero que indique SOBERAN_GARAJE_URL_FILE (en Nomad lo renderiza un template con la
dirección interna del servicio, para no reiniciar Soberan cada vez que Garaje se mueve).
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timedelta
from typing import Any, Optional
from urllib.parse import urlsplit

import requests
from sqlalchemy.orm import Session

from . import models

logger = logging.getLogger("soberan.garaje_sync")

SETTING_URL = "garaje_url"
SETTING_LAST_SYNC = "garaje_last_sync"
MIN_INTERVAL = timedelta(minutes=30)
# Salto de km a partir del cual la valoración de mercado deja de ser fiable.
KM_REVALUE_DELTA = 3000
MAX_TRANSACTIONS = 5000
TIMEOUT = 10


def _get_setting(db: Session, key: str) -> str:
    row = db.query(models.UserSettings).filter(models.UserSettings.key == key).first()
    return (row.value or "").strip() if row else ""


def _set_setting(db: Session, key: str, value: str) -> None:
    row = db.query(models.UserSettings).filter(models.UserSettings.key == key).first()
    if row:
        row.value = value
    else:
        db.add(models.UserSettings(key=key, value=value))


def resolve_garaje_url(db: Session) -> Optional[str]:
    url = _get_setting(db, SETTING_URL) or os.getenv("SOBERAN_GARAJE_URL", "").strip()
    path = os.getenv("SOBERAN_GARAJE_URL_FILE", "").strip()
    if not url and path:
        try:
            with open(path, encoding="utf-8") as fh:
                url = fh.read().strip()
        except OSError:
            url = ""
    if not url:
        return None
    if urlsplit(url).scheme not in ("http", "https"):
        logger.warning("garaje_url ignorada: debe ser http(s)")
        return None
    return url.rstrip("/")


def _confidence(prop: models.Property) -> Optional[str]:
    try:
        return json.loads(prop.valoracion_json or "{}").get("confianza")
    except (ValueError, TypeError):
        return None


def _apply_links(db: Session, links: list[dict]) -> list[dict]:
    """Km de Garaje → Property. Nunca baja los km (un error de tecleo en Garaje no debe
    abaratar el coche en el patrimonio) y rellena matrícula/bastidor si faltan."""
    changes = []
    for link in links:
        prop = db.query(models.Property).filter(models.Property.id == link.get("property_id")).first()
        if prop is None or prop.tipo != "vehiculo":
            continue
        km = link.get("odometer_km")
        if isinstance(km, int) and km > (prop.km or 0):
            old = prop.km
            prop.km = km
            revalue = old is None or km - old >= KM_REVALUE_DELTA
            if revalue:
                prop.valor_actualizado_en = None
            changes.append({"id": prop.id, "nombre": prop.nombre, "km_antes": old, "km": km, "revalorar": revalue})
        if not prop.matricula and link.get("plate"):
            prop.matricula = str(link["plate"])[:20]
        if not prop.bastidor and link.get("vin"):
            prop.bastidor = str(link["vin"])[:20]
    db.commit()
    return changes


# Solo se ofrecen a Garaje las categorías que tienen pinta de ser del coche: por su
# nombre o porque contienen cargos de gasolineras, talleres, ITV, peajes… (más las ya
# elegidas). Enviar las ~100 categorías de gasto no aporta nada y expone de más.
_CAR_CATEGORY_RE = re.compile(
    r"coche|veh[ií]culo|auto(m[oó]vil)?|moto|transporte|gasolin|gas[oó]leo|carburante|combustible|"
    r"repostaj|recarga|taller|mec[aá]nic|neum[aá]tic|itv|parking|aparcamiento|peaje|seguro.*(coche|auto|veh)|multa",
    re.I,
)
_CAR_MERCHANT_RE = re.compile(
    r"\b(repsol|cepsa|moeve|bp|galp|shell|plenoil|ballenoil|petronor|petroprix|esso|avia|gasolinera|"
    r"estaci[oó]n de servicio|norauto|feu vert|midas|euromaster|confortauto|carglass|aurgi|taller|"
    r"itv|applus|empark|telpark|easypark|peaje|autopista|via ?t|ionity|zunder|wenea)\b",
    re.I,
)


def car_categories(db: Session, selected: list[str]) -> list[str]:
    found = set(selected)
    rows = (
        db.query(models.Transaction.category_anon, models.Transaction.description_raw)
        .filter(models.Transaction.category_anon.isnot(None))
        .filter(models.Transaction.amount < 0)
        .order_by(models.Transaction.date.desc())
        .limit(20000)
    )
    for category, description in rows:
        if category and category not in found and (
            _CAR_CATEGORY_RE.search(category) or _CAR_MERCHANT_RE.search(description or "")
        ):
            found.add(category)
    return sorted(found)[:40]


def build_payload(db: Session, categories: list[str], since: Optional[str]) -> dict[str, Any]:
    vehicles = db.query(models.Property).filter(models.Property.tipo == "vehiculo").all()
    debts = db.query(models.Debt).filter(models.Debt.archivada.is_(False)).all()
    used_categories = car_categories(db, categories)
    txs: list[models.Transaction] = []
    if categories:
        q = (
            db.query(models.Transaction)
            .filter(models.Transaction.category_anon.in_(categories))
            .filter(models.Transaction.amount < 0)
            .filter(models.Transaction.es_interna.is_(False))
            .filter(models.Transaction.es_pending.is_(False))
        )
        if since:
            try:
                q = q.filter(models.Transaction.date >= datetime.fromisoformat(since))
            except ValueError:
                pass
        txs = q.order_by(models.Transaction.date.desc()).limit(MAX_TRANSACTIONS).all()

    return {
        "properties": [
            {
                "id": p.id,
                "nombre": p.nombre or "",
                "marca": p.marca,
                "modelo": p.modelo,
                "anio": p.anio if isinstance(p.anio, int) else None,
                "matricula": p.matricula,
                "bastidor": p.bastidor,
                "km": p.km,
                "valor_estimado": p.valor_estimado,
                "valor_actualizado_en": p.valor_actualizado_en or None,
                "confianza": _confidence(p),
            }
            for p in vehicles
        ],
        "debts": [
            {
                "id": d.id,
                "nombre": d.nombre or "",
                "acreedor": d.acreedor or "",
                "pendiente": round(max(0.0, float(d.monto_total or 0) - float(d.monto_pagado or 0)), 2),
                "cuota_mensual": d.cuota_mensual,
            }
            for d in debts
        ],
        "categories": used_categories,
        "transactions": [
            {
                "id": t.id,
                "date": (t.date or datetime.utcnow()).date().isoformat(),
                "amount": float(t.amount or 0),
                "description": (t.description_raw or "")[:500],
                "category": (t.category_anon or "")[:80],
            }
            for t in txs
        ],
    }


def run_garaje_sync(db: Session, *, force: bool = False, http=requests) -> dict[str, Any]:
    url = resolve_garaje_url(db)
    if not url:
        return {"status": "disabled"}

    last = _get_setting(db, SETTING_LAST_SYNC)
    if not force and last:
        try:
            if datetime.utcnow() - datetime.fromisoformat(last) < MIN_INTERVAL:
                return {"status": "skipped"}
        except ValueError:
            pass

    try:
        resp = http.get(f"{url}/api/integrations/soberan/config", timeout=TIMEOUT)
        resp.raise_for_status()
        config = resp.json()
        km_changes = _apply_links(db, config.get("links") or [])
        payload = build_payload(db, config.get("categories") or [], config.get("since"))
        resp = http.post(f"{url}/api/integrations/soberan/sync", json=payload, timeout=TIMEOUT * 3)
        resp.raise_for_status()
        result = resp.json()
    except (requests.RequestException, ValueError) as exc:
        # Garaje caído o inalcanzable (p.ej. app de escritorio sin red): no es un error de Soberan.
        logger.info("Sincronización con Garaje fallida: %s", exc)
        return {"status": "error", "detail": "No se pudo conectar con Garaje"}

    _set_setting(db, SETTING_LAST_SYNC, datetime.utcnow().isoformat())
    db.commit()
    return {
        "status": "ok",
        "km_actualizados": km_changes,
        "movimientos_enviados": len(payload["transactions"]),
        "garaje": result,
    }
