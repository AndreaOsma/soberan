"""Generación unificada de eventos del calendario de pagos (API + iCal)."""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from . import models


def _month_index(year: int, month: int) -> int:
    return year * 12 + month


def is_suscripcion_entry(entry: models.RecurringEntry) -> bool:
    return (entry.tipo_partida or "").strip().lower() == "suscripcion"


def is_calendar_recurring_income(entry: models.RecurringEntry) -> bool:
    """Solo ingresos recurrentes (no gastos, fondos ni ahorro/inversión)."""
    return bool(entry.es_ingreso)


def is_calendar_prestacion_income(entry: models.RecurringEntry) -> bool:
    from .helpers import is_prestacion_income_entry

    return bool(entry.es_ingreso) and is_prestacion_income_entry(entry)


def normalize_subscription_frequency(freq: Optional[str]) -> str:
    """Normaliza frecuencia (legacy EN/ES, abreviaturas)."""
    f = (freq or "mensual").strip().lower()
    if f in {"anual", "annual", "a", "yearly", "year"}:
        return "anual"
    if f in {"mensual", "monthly", "m", "month"}:
        return "mensual"
    return f


def is_annual_subscription(sub: models.RecurringEntry) -> bool:
    return normalize_subscription_frequency(sub.frecuencia) == "anual"


def subscription_billing_month(sub: models.RecurringEntry) -> int:
    """Mes de cobro en calendario (anual): mes_cobro o, si falta, mes_inicio."""
    if sub.mes_cobro is not None:
        try:
            m = int(sub.mes_cobro)
            if 1 <= m <= 12:
                return m
        except (TypeError, ValueError):
            pass
    if sub.mes_inicio is not None:
        try:
            m = int(sub.mes_inicio)
            if 1 <= m <= 12:
                return m
        except (TypeError, ValueError):
            pass
    return 1


def recurring_entry_applies_to_month(entry: models.RecurringEntry, mes: int, anio: int) -> bool:
    if entry.mes_fin and entry.anio_fin and _month_index(anio, mes) > _month_index(entry.anio_fin, entry.mes_fin):
        return False
    if not entry.mes_inicio or not entry.anio_inicio:
        return True
    start = _month_index(entry.anio_inicio, entry.mes_inicio)
    cur = _month_index(anio, mes)
    if entry.es_puntual:
        return start == cur
    return cur >= start


def subscription_applies_to_calendar_month(sub: models.RecurringEntry, mes: int, anio: int) -> bool:
    if sub.mes_inicio and sub.anio_inicio:
        if _month_index(anio, mes) < _month_index(sub.anio_inicio, sub.mes_inicio):
            return False
    if sub.mes_fin and sub.anio_fin:
        if _month_index(anio, mes) > _month_index(sub.anio_fin, sub.mes_fin):
            return False
    excluidos = json.loads(sub.meses_excluidos) if sub.meses_excluidos else []
    if mes in excluidos:
        return False
    if is_annual_subscription(sub):
        cobro = subscription_billing_month(sub)
        if mes != cobro:
            return False
        if sub.mes_inicio and sub.anio_inicio and anio == sub.anio_inicio and mes < sub.mes_inicio:
            return False
    return True


def subscription_amount_for_month(sub: models.RecurringEntry, mes: int, anio: int) -> float:
    default = float(sub.monto_estimado or 0.0)
    if not sub.historial_precios:
        return default
    try:
        tiers = json.loads(sub.historial_precios)
    except (json.JSONDecodeError, TypeError):
        return default
    if not isinstance(tiers, list) or not tiers:
        return default
    cur = _month_index(anio, mes)
    applicable = default
    for tier in sorted(tiers, key=lambda t: (int(t.get("desde_anio", 0)), int(t.get("desde_mes", 0)))):
        tidx = int(tier.get("desde_anio", 0)) * 12 + int(tier.get("desde_mes", 0))
        if tidx <= cur:
            applicable = float(tier.get("monto", applicable))
    return applicable


def ical_summary_for_event(event: Dict[str, Any]) -> str:
    tipo_labels = {
        "subscription": "SUSCRIPCIÓN",
        "recurring_income": "INGRESO",
        "prestacion": "PRESTACIÓN",
        "recurring_expense": "GASTO",
        "deuda": "DEUDA",
        "deuda_cuota": "DEUDA",
    }
    label = tipo_labels.get(str(event.get("tipo", "")), str(event.get("seccion", "PAGO")).upper())
    return f"{label}: {(event.get('titulo') or '').strip()}"


def build_payment_calendar_events(
    db: Session,
    mes: int,
    anio: int,
    *,
    include_subs: bool = True,
    include_income: bool = True,
    include_debts: bool = True,
) -> List[Dict[str, Any]]:
    from .helpers import format_prestacion_calendar_title
    from .main import (
        ENVELOPE_ACCOUNT_MAP_KEY,
        _charge_datetime,
        envelope_account_label,
        recurring_company_from_nombre,
        resolve_income_day_with_window,
        user_settings_json,
    )

    recs = db.query(models.RecurringEntry).all()
    sub_recs = [r for r in recs if is_suscripcion_entry(r)]
    deudas = db.query(models.Debt).all() if include_debts else []
    eventos: List[Dict[str, Any]] = []

    if include_subs:
        for sub in sub_recs:
            if not subscription_applies_to_calendar_month(sub, mes, anio):
                continue
            try:
                dia = sub.fecha_pago or 1
                fecha = datetime(anio, mes, dia)
                eventos.append({
                    "tipo": "subscription",
                    "seccion": "Suscripción",
                    "titulo": sub.nombre,
                    "monto": subscription_amount_for_month(sub, mes, anio),
                    "fecha": fecha.isoformat(),
                    "id": sub.id,
                    "uid": f"sub-{sub.id}-{anio}{mes:02d}@soberan.local",
                })
            except ValueError:
                pass

    envelope_map = user_settings_json(db, ENVELOPE_ACCOUNT_MAP_KEY, {})
    if not isinstance(envelope_map, dict):
        envelope_map = {}

    sub_names = {s.nombre for s in sub_recs}

    for r in recs:
        if not r.es_fijo:
            continue
        if is_suscripcion_entry(r):
            continue
        if r.nombre in sub_names:
            continue
        if not recurring_entry_applies_to_month(r, mes, anio):
            continue
        if not is_calendar_recurring_income(r):
            continue
        if not include_income:
            continue
        is_prestacion = is_calendar_prestacion_income(r)
        # Prestación/SEPE no usa config de día de cobro por empresa.
        comp = None if is_prestacion else recurring_company_from_nombre(r.nombre)
        income_day_expected, income_day_earliest = resolve_income_day_with_window(db, anio, mes, comp)
        day = income_day_expected
        try:
            fecha = datetime(anio, mes, day)
            extra_label = ""
            if (
                not is_prestacion
                and income_day_expected is not None
                and income_day_earliest is not None
                and income_day_earliest < income_day_expected
            ):
                extra_label = f" (puede entrar desde día {income_day_earliest})"
            acct_alias = envelope_account_label(db, r.id, envelope_map)
            if is_prestacion:
                base_title = format_prestacion_calendar_title(r.nombre)
                titulo = f"{base_title}{extra_label}"
                if acct_alias:
                    titulo = f"{base_title} → {acct_alias}{extra_label}"
                eventos.append({
                    "tipo": "prestacion",
                    "seccion": "Prestación",
                    "titulo": titulo,
                    "monto": abs(float(r.monto_estimado or 0.0)),
                    "fecha": fecha.isoformat(),
                    "ventana_inicio": income_day_earliest,
                    "cuenta_destino": acct_alias or None,
                    "id": r.id,
                    "uid": f"prest-{r.id}-{anio}{mes:02d}@soberan.local",
                })
            else:
                titulo = f"{r.nombre}{extra_label}"
                if acct_alias:
                    titulo = f"{r.nombre} → {acct_alias}{extra_label}"
                eventos.append({
                    "tipo": "recurring_income",
                    "seccion": "Ingreso",
                    "titulo": titulo,
                    "monto": abs(float(r.monto_estimado or 0.0)),
                    "fecha": fecha.isoformat(),
                    "ventana_inicio": income_day_earliest,
                    "cuenta_destino": acct_alias or None,
                    "id": r.id,
                    "uid": f"rec-{r.id}-{anio}{mes:02d}@soberan.local",
                })
        except ValueError:
            pass

    if not include_debts:
        return eventos

    all_installments = db.query(models.DebtInstallment).all()
    installments_by_debt: Dict[int, List[models.DebtInstallment]] = {}
    for inst in all_installments:
        installments_by_debt.setdefault(inst.debt_id, []).append(inst)

    for deuda in deudas:
        pend = float(deuda.monto_total or 0.0) - float(deuda.monto_pagado or 0.0)
        if deuda.fecha_vencimiento:
            fecha_venc = deuda.fecha_vencimiento
            if fecha_venc.year == anio and fecha_venc.month == mes:
                eventos.append({
                    "tipo": "deuda",
                    "seccion": "Deuda",
                    "titulo": f"Vencimiento: {deuda.acreedor}",
                    "monto": max(pend, 0.0),
                    "fecha": fecha_venc.isoformat(),
                    "id": deuda.id,
                    "uid": f"debt-{deuda.id}-venc-{anio}{mes:02d}@soberan.local",
                })
        planilla = installments_by_debt.get(deuda.id, [])
        if planilla:
            nombre = deuda.nombre or deuda.acreedor
            for inst in planilla:
                if inst.pagada:
                    continue
                try:
                    fv = datetime.strptime(inst.fecha_vencimiento[:10], "%Y-%m-%d")
                except ValueError:
                    continue
                if fv.year != anio or fv.month != mes:
                    continue
                eventos.append({
                    "tipo": "deuda_cuota",
                    "seccion": "Deuda",
                    "titulo": f"{nombre} (cuota {inst.numero_cuota})",
                    "monto": float(inst.cuota_total),
                    "fecha": fv.isoformat(),
                    "id": deuda.id,
                    "inst_id": inst.id,
                    "uid": f"debt-inst-{inst.id}@soberan.local",
                })
            continue
        if (
            pend > 0.01
            and deuda.cuota_mensual
            and float(deuda.cuota_mensual) > 0
            and deuda.dia_cargo_mensual
        ):
            try:
                fecha_cuota = _charge_datetime(anio, mes, int(deuda.dia_cargo_mensual))
                eventos.append({
                    "tipo": "deuda_cuota",
                    "seccion": "Deuda",
                    "titulo": deuda.nombre or deuda.acreedor,
                    "monto": float(deuda.cuota_mensual),
                    "fecha": fecha_cuota.isoformat(),
                    "id": deuda.id,
                    "uid": f"debt-{deuda.id}-cuota-{anio}{mes:02d}@soberan.local",
                })
            except ValueError:
                pass

    return eventos


def build_payment_calendar_horizon(
    db: Session,
    start_mes: int,
    start_anio: int,
    horizon_months: int,
    *,
    past_months: int = 0,
    include_subs: bool = True,
    include_income: bool = True,
    include_debts: bool = True,
) -> List[Dict[str, Any]]:
    month_num = start_mes
    year_num = start_anio
    for _ in range(past_months):
        month_num -= 1
        if month_num < 1:
            month_num = 12
            year_num -= 1

    eventos: List[Dict[str, Any]] = []
    total = past_months + horizon_months
    for _ in range(total):
        eventos.extend(
            build_payment_calendar_events(
                db,
                month_num,
                year_num,
                include_subs=include_subs,
                include_income=include_income,
                include_debts=include_debts,
            )
        )
        month_num += 1
        if month_num > 12:
            month_num = 1
            year_num += 1
    return eventos
