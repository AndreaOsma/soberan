"""SEPE unemployment renewal reminders (renovar/sellar demanda ~ cada 3 meses)."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app import models

DEFAULT_INTERVAL_DAYS = 90
UPCOMING_DAYS = 7


def _user_setting_str(db: "Session", key: str, default: str = "") -> str:
    from app import models

    row = db.query(models.UserSettings).filter(models.UserSettings.key == key).first()
    if not row or not row.value:
        return default
    return str(row.value).strip()


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _has_prestacion_income(recurring_entries: list["models.RecurringEntry"]) -> bool:
    from app.helpers import is_prestacion_income_entry

    for entry in recurring_entries:
        if not entry.es_ingreso:
            continue
        if is_prestacion_income_entry(entry):
            return True
    return False


def _has_active_job(work_history: list["models.WorkHistory"]) -> bool:
    return any(not wh.fecha_fin for wh in work_history)


def _last_job_end_date(work_history: list["models.WorkHistory"]) -> Optional[date]:
    dates: list[date] = []
    for wh in work_history:
        if not wh.fecha_fin:
            continue
        parsed = wh.fecha_fin.date() if hasattr(wh.fecha_fin, "date") else _parse_date(str(wh.fecha_fin))
        if parsed:
            dates.append(parsed)
    if not dates:
        return None
    return max(dates)


def _sepe_interval_days(settings: dict[str, str]) -> int:
    try:
        n = int(settings.get("sepe_intervalo_dias") or DEFAULT_INTERVAL_DAYS)
        return n if n > 0 else DEFAULT_INTERVAL_DAYS
    except (TypeError, ValueError):
        return DEFAULT_INTERVAL_DAYS


def is_unemployed(
    settings: dict[str, str],
    work_history: list["models.WorkHistory"],
    recurring_entries: list["models.RecurringEntry"],
) -> bool:
    status = (settings.get("sepe_status") or "auto").strip().lower()
    if status == "activo":
        return False
    if status == "paro":
        return True
    if _has_active_job(work_history):
        return False
    return _has_prestacion_income(recurring_entries)


def next_sepe_renewal_date(
    settings: dict[str, str],
    work_history: list["models.WorkHistory"],
) -> Optional[date]:
    interval = _sepe_interval_days(settings)
    last_renewal = _parse_date(settings.get("sepe_ultima_renovacion"))
    base = last_renewal or _last_job_end_date(work_history)
    if not base:
        return None
    return base + timedelta(days=interval)


def sepe_renewal_alert_state(
    settings: dict[str, str],
    work_history: list["models.WorkHistory"],
    recurring_entries: list["models.RecurringEntry"],
    ref_date: Optional[date] = None,
) -> str:
    ref = ref_date or date.today()
    if not is_unemployed(settings, work_history, recurring_entries):
        return "ok"

    if not _parse_date(settings.get("sepe_ultima_renovacion")):
        return "needs_date"

    nxt = next_sepe_renewal_date(settings, work_history)
    if not nxt:
        return "needs_date"

    days_until = (nxt - ref).days
    if days_until < 0:
        return "overdue"
    if days_until <= UPCOMING_DAYS:
        return "upcoming"
    return "ok"


def _format_date_es(d: date) -> str:
    months = (
        "enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
    )
    return f"{d.day} de {months[d.month - 1]} de {d.year}"


def format_sepe_alert_message(
    state: str,
    settings: dict[str, str],
    work_history: list["models.WorkHistory"],
    ref_date: Optional[date] = None,
) -> str:
    ref = ref_date or date.today()
    nxt = next_sepe_renewal_date(settings, work_history)
    if state == "needs_date":
        job_end = _last_job_end_date(work_history)
        if job_end and nxt:
            return (
                "Estás en paro: confirma la fecha de tu última renovación SEPE "
                f"(estimación ~{_format_date_es(nxt)} según fin de contrato). "
                "Indícala en Ajustes o pulsa «Renovado hoy» en Historial laboral."
            )
        return (
            "Estás en paro: indica la fecha de tu última renovación SEPE en Ajustes "
            "o pulsa «Renovado hoy» en Historial laboral."
        )
    if state == "overdue" and nxt:
        return (
            f"Renovación SEPE vencida: debías renovar/sellar la demanda antes del {_format_date_es(nxt)}. "
            "Hazlo cuanto antes."
        )
    if state == "upcoming" and nxt:
        days = (nxt - ref).days
        day_word = "día" if days == 1 else "días"
        return (
            f"Próxima renovación SEPE en {days} {day_word} ({_format_date_es(nxt)}). "
            "Renueva/sella la demanda a tiempo."
        )
    return ""


def build_sepe_renewal_alert(db: "Session", ref_date: Optional[date] = None) -> Optional[dict[str, Any]]:
    from app import models

    ref = ref_date or date.today()
    settings = {
        "sepe_status": _user_setting_str(db, "sepe_status", "auto"),
        "sepe_ultima_renovacion": _user_setting_str(db, "sepe_ultima_renovacion"),
        "sepe_intervalo_dias": _user_setting_str(db, "sepe_intervalo_dias", str(DEFAULT_INTERVAL_DAYS)),
    }
    work_history = db.query(models.WorkHistory).all()
    recurring_entries = db.query(models.RecurringEntry).filter(
        models.RecurringEntry.es_ingreso == True  # noqa: E712
    ).all()

    state = sepe_renewal_alert_state(settings, work_history, recurring_entries, ref)
    if state == "ok":
        return None

    severity = "alta" if state == "overdue" else "media"
    mensaje = format_sepe_alert_message(state, settings, work_history, ref)
    if not mensaje:
        return None

    return {
        "tipo": "sepe_renovacion",
        "severidad": severity,
        "mensaje": mensaje,
        "id": None,
    }
