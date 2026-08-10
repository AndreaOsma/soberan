from datetime import datetime

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_calendario_pagos_includes_subscription():
    sub = client.post(
        "/recurring-entries/",
        json={
            "nombre": "Netflix test",
            "monto_estimado": 12.99,
            "es_ingreso": False,
            "es_fijo": True,
            "tipo_partida": "suscripcion",
            "categoria": "Suscripciones y facturas",
            "fecha_pago": 15,
            "frecuencia": "mensual",
        },
    )
    assert sub.status_code == 200
    sub_id = sub.json()["id"]

    response = client.get("/api/calendario/pagos/7/2026")
    assert response.status_code == 200
    events = response.json()
    match = [e for e in events if e.get("id") == sub_id and e.get("tipo") == "subscription"]
    assert len(match) == 1
    assert match[0]["titulo"] == "Netflix test"
    assert match[0]["monto"] == 12.99
    assert datetime.fromisoformat(match[0]["fecha"]).day == 15


def test_calendario_pagos_empty_month_returns_list():
    response = client.get("/api/calendario/pagos/1/2099")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_calendario_pagos_anio_returns_twelve_months_horizon():
    response = client.get("/api/calendario/pagos/anio/2099")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_calendario_pagos_subscription_ended_before_month():
    sub = client.post(
        "/recurring-entries/",
        json={
            "nombre": "Cancelada test",
            "monto_estimado": 9.99,
            "es_ingreso": False,
            "es_fijo": True,
            "tipo_partida": "suscripcion",
            "categoria": "Suscripciones y facturas",
            "fecha_pago": 10,
            "frecuencia": "mensual",
            "mes_inicio": 1,
            "anio_inicio": 2026,
            "mes_fin": 6,
            "anio_fin": 2026,
        },
    )
    assert sub.status_code == 200
    sub_id = sub.json()["id"]

    june = client.get("/api/calendario/pagos/6/2026")
    assert june.status_code == 200
    assert any(e.get("id") == sub_id for e in june.json())

    july = client.get("/api/calendario/pagos/7/2026")
    assert july.status_code == 200
    assert not any(e.get("id") == sub_id for e in july.json())


def test_calendario_pagos_subscription_price_history():
    sub = client.post(
        "/recurring-entries/",
        json={
            "nombre": "Precio tier test",
            "monto_estimado": 20,
            "es_ingreso": False,
            "es_fijo": True,
            "tipo_partida": "suscripcion",
            "categoria": "Suscripciones y facturas",
            "fecha_pago": 5,
            "frecuencia": "mensual",
            "mes_inicio": 1,
            "anio_inicio": 2026,
            "historial_precios": '[{"desde_mes":1,"desde_anio":2026,"monto":10},{"desde_mes":3,"desde_anio":2026,"monto":20}]',
        },
    )
    assert sub.status_code == 200
    sub_id = sub.json()["id"]

    feb = client.get("/api/calendario/pagos/2/2026")
    assert feb.status_code == 200
    match_feb = [e for e in feb.json() if e.get("id") == sub_id]
    assert len(match_feb) == 1
    assert match_feb[0]["monto"] == 10

    mar = client.get("/api/calendario/pagos/3/2026")
    assert mar.status_code == 200
    match_mar = [e for e in mar.json() if e.get("id") == sub_id]
    assert len(match_mar) == 1
    assert match_mar[0]["monto"] == 20


def test_calendario_excludes_expenses_fondos_ahorro():
    """Gastos, fondos y ahorro/inversión no aparecen en el calendario de pagos."""
    cases = [
        {
            "nombre": "Alquiler recurrente",
            "monto_estimado": 800,
            "es_ingreso": False,
            "es_fijo": True,
            "tipo_partida": "gasto",
            "categoria": "Vivienda",
        },
        {
            "nombre": "Fondo comida",
            "monto_estimado": 300,
            "es_ingreso": False,
            "es_fijo": True,
            "es_fondo": True,
            "tipo_partida": "gasto",
            "categoria": "Alimentación",
        },
        {
            "nombre": "ETF mensual",
            "monto_estimado": 200,
            "es_ingreso": False,
            "es_fijo": True,
            "tipo_partida": "ahorro_inversion",
            "categoria": "Inversión",
        },
    ]
    created_ids = []
    for payload in cases:
        r = client.post("/recurring-entries/", json=payload)
        assert r.status_code == 200
        created_ids.append(r.json()["id"])

    response = client.get("/api/calendario/pagos/7/2026")
    assert response.status_code == 200
    event_ids = {e.get("id") for e in response.json()}
    for entry_id in created_ids:
        assert entry_id not in event_ids

    ical = client.get("/api/calendar/payments.ics", params={"subs": 0, "rec_inc": 1, "debts": 0})
    assert ical.status_code == 200
    body = ical.text
    for name in ("Alquiler recurrente", "Fondo comida", "ETF mensual"):
        assert name not in body


def test_calendario_annual_subscription_only_in_billing_month():
    """Suscripción anual: un solo evento en mes/día de cobro, no todos los meses."""
    sub = client.post(
        "/recurring-entries/",
        json={
            "nombre": "Dominio anual",
            "monto_estimado": 24.0,
            "es_ingreso": False,
            "es_fijo": True,
            "tipo_partida": "suscripcion",
            "categoria": "Suscripciones y facturas",
            "fecha_pago": 20,
            "frecuencia": "anual",
            "mes_cobro": 7,
            "mes_inicio": 1,
            "anio_inicio": 2026,
        },
    )
    assert sub.status_code == 200
    sub_id = sub.json()["id"]

    for mes, expect in [(6, False), (7, True), (8, False)]:
        events = client.get(f"/api/calendario/pagos/{mes}/2026").json()
        hits = [e for e in events if e.get("id") == sub_id]
        assert bool(hits) == expect, f"month {mes}: expected {expect}, got {len(hits)}"
        if expect:
            assert hits[0]["monto"] == 24.0
            assert hits[0]["fecha"].startswith("2026-07-20")

    ical = client.get("/api/calendar/payments.ics", params={"subs": 1, "rec_inc": 0, "debts": 0})
    assert ical.status_code == 200
    body = ical.text
    july = [b for b in body.split("BEGIN:VEVENT") if "SUSCRIPCIÓN: Dominio anual" in b and "20260720" in b]
    august = [b for b in body.split("BEGIN:VEVENT") if "SUSCRIPCIÓN: Dominio anual" in b and "20260820" in b]
    assert len(july) == 1
    assert len(august) == 0
    assert "RRULE" not in body


def test_calendario_annual_subscription_legacy_english_frequency():
    """Frecuencia legacy 'annual' solo cobra en su mes."""
    sub = client.post(
        "/recurring-entries/",
        json={
            "nombre": "Legacy annual sub",
            "monto_estimado": 99.0,
            "es_ingreso": False,
            "es_fijo": True,
            "tipo_partida": "suscripcion",
            "categoria": "Suscripciones y facturas",
            "fecha_pago": 5,
            "frecuencia": "annual",
            "mes_cobro": 3,
        },
    )
    assert sub.status_code == 200
    sub_id = sub.json()["id"]

    feb = client.get("/api/calendario/pagos/2/2026").json()
    mar = client.get("/api/calendario/pagos/3/2026").json()
    assert not any(e.get("id") == sub_id for e in feb)
    assert any(e.get("id") == sub_id for e in mar)
