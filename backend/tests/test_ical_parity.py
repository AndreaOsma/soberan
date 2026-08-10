"""Paridad calendario API ↔ iCal."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_ical_excludes_subscription_after_end_month():
    sub = client.post(
        "/recurring-entries/",
        json={
            "nombre": "iCal cancel test",
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
    name = sub.json()["nombre"]

    june = client.get("/api/calendario/pagos/6/2026")
    assert any(e.get("titulo") == name for e in june.json())

    july = client.get("/api/calendario/pagos/7/2026")
    assert not any(e.get("titulo") == name for e in july.json())

    ical = client.get("/api/calendar/payments.ics", params={"subs": 1, "rec_inc": 0, "debts": 0})
    assert ical.status_code == 200
    body = ical.text
    assert "RRULE" not in body
    june_blocks = [b for b in body.split("BEGIN:VEVENT") if "SUSCRIPCIÓN: iCal cancel test" in b and "20260610" in b]
    assert len(june_blocks) == 1
    july_blocks = [b for b in body.split("BEGIN:VEVENT") if "SUSCRIPCIÓN: iCal cancel test" in b and "20260710" in b]
    assert len(july_blocks) == 0
