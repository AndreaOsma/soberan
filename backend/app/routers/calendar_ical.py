"""iCal payment calendar feed, feed-url, and subscribe helpers."""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from typing import Any, Dict, Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, Response
from icalendar import Calendar, Event
from sqlalchemy.orm import Session

from ..database import get_db

router = APIRouter()

def _ical_all_day_bounds(year: int, month: int, day: int) -> tuple[date, date]:
    """Rango [inicio, fin) para un evento de día completo (fin exclusivo en iCal)."""
    start = date(year, month, day)
    return start, start + timedelta(days=1)


def _add_ical_all_day(event: Event, year: int, month: int, day: int) -> None:
    start, end = _ical_all_day_bounds(year, month, day)
    event.add("dtstart", start)
    event.add("dtend", end)


def _ical_event_from_dict(event: Dict[str, Any], stamp: datetime) -> Event:
    from ..calendar_events import ical_summary_for_event

    fecha = datetime.fromisoformat(str(event["fecha"])[:19])
    e = Event()
    e.add("summary", ical_summary_for_event(event))
    e.add("uid", event.get("uid") or f"ev-{event.get('tipo')}-{fecha.date().isoformat()}@soberan.local")
    e.add("dtstamp", stamp)
    _add_ical_all_day(e, fecha.year, fecha.month, fecha.day)
    return e


@router.get("/api/calendar/payments.ics")
@router.get("/calendar/payments.ics")
def get_ical(
    db: Session = Depends(get_db),
    token: Optional[str] = Query(None, description="API key como query param (para clientes de calendario que no pueden enviar cabeceras)."),
    v: Optional[str] = Query(None, description="Versión arbitraria para invalidar caché del cliente (ej. iOS)."),
    subs: int = Query(1, ge=0, le=1),
    rec_inc: int = Query(1, ge=0, le=1),
    debts: int = Query(1, ge=0, le=1),
):
    from ..calendar_events import build_payment_calendar_horizon

    expected_key = os.environ.get("SOBERAN_API_KEY", "").strip()
    if expected_key and (not token or token.strip() != expected_key):
        raise HTTPException(status_code=401, detail="Token inválido. Usa ?token=TU_API_KEY")
    cal = Calendar()
    cal.add('prodid', '-//Soberan//Finanzas//ES')
    cal.add('version', '2.0')
    name = 'Soberan: Pagos'
    if v:
        name = f"{name} ({v})"
    cal.add('x-wr-calname', name)
    if v:
        cal.add('x-soberan-feed-version', v)

    now = datetime.utcnow()
    horizon_months = 18
    events = build_payment_calendar_horizon(
        db,
        now.month,
        now.year,
        horizon_months,
        past_months=12,
        include_subs=bool(subs),
        include_income=bool(rec_inc),
        include_debts=bool(debts),
    )
    for ev in events:
        cal.add_component(_ical_event_from_dict(ev, now))

    return Response(
        content=cal.to_ical(),
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": "inline; filename=payments.ics",
            "Cache-Control": "no-cache, no-store, must-revalidate",
        }
    )


def _public_request_origin(request: Request) -> str:
    """Origin público respetando reverse proxy (X-Forwarded-*) para enlaces iCal."""
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "https").split(",")[0].strip()
    host = request.headers.get("host") or request.url.hostname or ""
    return f"{proto}://{host}"


def _calendar_feed_query(
    *,
    v: Optional[str] = None,
    subs: int = 1,
    rec_inc: int = 1,
    debts: int = 1,
) -> Dict[str, Any]:
    qs: Dict[str, Any] = {
        "subs": subs,
        "rec_inc": rec_inc,
        "debts": debts,
    }
    if v:
        qs["v"] = v
    expected_key = os.environ.get("SOBERAN_API_KEY", "").strip()
    if expected_key:
        qs["token"] = expected_key
    return qs


def _calendar_feed_urls(request: Request, qs: Dict[str, Any]) -> Dict[str, str]:
    origin = _public_request_origin(request)
    url = f"{origin}/api/calendar/payments.ics?{urlencode(qs)}"
    webcal_url = url.replace("https://", "webcal://") if url.startswith("https://") else url
    return {"url": url, "webcal_url": webcal_url}


@router.get("/api/calendar/feed-url")
@router.get("/calendar/feed-url")
def calendar_feed_url(
    request: Request,
    v: Optional[str] = Query(None, description="Versión arbitraria para invalidar caché del cliente (ej. iOS)."),
    subs: int = Query(1, ge=0, le=1),
    rec_inc: int = Query(1, ge=0, le=1),
    debts: int = Query(1, ge=0, le=1),
):
    """URL lista para suscribirse (con token si aplica). Pensada para UI autenticada."""
    qs = _calendar_feed_query(v=v, subs=subs, rec_inc=rec_inc, debts=debts)
    return _calendar_feed_urls(request, qs)


# iCal subscription helper (legacy redirect):
# - Los clientes de calendario suelen no poder enviar cabeceras Authorization.
# - Si SOBERAN_API_KEY está configurado, el feed `.ics` exige ?token=...
# - Preferir /calendar/feed-url desde la UI autenticada.
@router.get("/api/calendar/subscribe")
@router.get("/calendar/subscribe")
def subscribe_ical(
    request: Request,
    v: Optional[str] = Query(None, description="Versión arbitraria para invalidar caché del cliente (ej. iOS)."),
    subs: int = Query(1, ge=0, le=1),
    rec_inc: int = Query(1, ge=0, le=1),
    debts: int = Query(1, ge=0, le=1),
):
    qs = _calendar_feed_query(v=v, subs=subs, rec_inc=rec_inc, debts=debts)
    return RedirectResponse(url=_calendar_feed_urls(request, qs)["url"], status_code=302)
