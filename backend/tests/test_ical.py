"""Tests for iCal feed generation."""
from icalendar import Event

from app.calendar_events import ical_summary_for_event
from app.main import _add_ical_all_day


def test_ical_all_day_uses_date_values():
    event = Event()
    _add_ical_all_day(event, 2026, 7, 15)
    raw = event.to_ical().decode()
    assert "DTSTART;VALUE=DATE:20260715" in raw
    assert "DTEND;VALUE=DATE:20260716" in raw
    assert "T100000" not in raw


def test_ical_summary_format():
    assert ical_summary_for_event({"tipo": "subscription", "titulo": "Songsterr"}) == "SUSCRIPCIÓN: Songsterr"
    assert ical_summary_for_event({"tipo": "recurring_income", "titulo": " Nómina "}) == "INGRESO: Nómina"
