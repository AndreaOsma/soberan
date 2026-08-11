"""Tests for SEPE renewal alert logic."""
from datetime import date

from app.sepe_alerts import (
    build_sepe_renewal_alert,
    is_unemployed,
    sepe_renewal_alert_state,
)
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def _set(key: str, value: str) -> None:
    client.post("/settings/", json={"key": key, "value": value})


def _create_prestacion_income():
    return client.post(
        "/recurring-entries/",
        json={
            "nombre": "Paro SEPE test",
            "monto_estimado": 1200,
            "es_ingreso": True,
            "es_fijo": True,
            "categoria": "Prestación",
        },
    )


def _create_ended_job(fecha_fin: str = "2026-01-15"):
    return client.post(
        "/work-history/",
        json={
            "empresa": "Empresa Test",
            "grupo_cotizacion": "1",
            "fecha_inicio": "2025-06-01T00:00:00",
            "fecha_fin": f"{fecha_fin}T00:00:00",
            "dias_alta": 200,
            "salario_bruto": 2000,
            "periodicidad": "M",
        },
    )


def test_is_unemployed_auto_detect():
    settings = {"sepe_status": "auto"}
    work = type("W", (), {"fecha_fin": date(2026, 1, 15)})()
    rec = type("R", (), {"es_ingreso": True, "categoria": "Prestación"})()
    assert is_unemployed(settings, [work], [rec]) is True

    active = type("W", (), {"fecha_fin": None})()
    assert is_unemployed(settings, [active], [rec]) is False


def test_sepe_renewal_overdue():
    settings = {
        "sepe_status": "paro",
        "sepe_ultima_renovacion": "2026-01-01",
        "sepe_intervalo_dias": "90",
    }
    state = sepe_renewal_alert_state(settings, [], [], date(2026, 4, 20))
    assert state == "overdue"


def test_build_sepe_alert_in_api():
    _set("sepe_status", "paro")
    _set("sepe_ultima_renovacion", "2026-01-01")
    _set("sepe_intervalo_dias", "90")

    alerts = client.get("/api/alertas").json()
    sepe = [a for a in alerts if a.get("tipo") == "sepe_renovacion"]
    assert len(sepe) >= 1
    assert sepe[0]["severidad"] == "alta"
    assert "SEPE" in sepe[0]["mensaje"]


def test_no_sepe_alert_when_employed_override():
    _set("sepe_status", "activo")
    _set("sepe_ultima_renovacion", "2026-01-01")

    alerts = client.get("/api/alertas").json()
    assert not any(a.get("tipo") == "sepe_renovacion" for a in alerts)


def test_needs_date_when_paro_without_last_renewal():
    _create_prestacion_income()
    _create_ended_job()
    _set("sepe_status", "auto")
    _set("sepe_ultima_renovacion", "")

    alerts = client.get("/api/alertas").json()
    sepe = [a for a in alerts if a.get("tipo") == "sepe_renovacion"]
    assert len(sepe) >= 1
    assert sepe[0]["severidad"] == "media"
