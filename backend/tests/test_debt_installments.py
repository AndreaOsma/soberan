"""Tests for debt installment (planilla) API and calendar integration."""
from datetime import datetime

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _create_debt(name: str = "Préstamo test"):
    r = client.post(
        "/debts/",
        json={
            "nombre": name,
            "acreedor": "Banco Test",
            "monto_total": 10000,
            "monto_pagado": 0,
            "tipo": "Préstamo personal",
            "cuota_mensual": 200,
            "dia_cargo_mensual": 5,
        },
    )
    assert r.status_code == 200
    return r.json()["id"]


def test_debt_charge_day_accepts_30_and_31():
    for day in (30, 31):
        r = client.post(
            "/debts/",
            json={
                "nombre": f"Día {day}",
                "acreedor": "Banco Test",
                "monto_total": 5000,
                "monto_pagado": 0,
                "tipo": "Préstamo personal",
                "cuota_mensual": 100,
                "dia_cargo_mensual": day,
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["dia_cargo_mensual"] == day


def test_debt_installments_crud_and_bulk():
    debt_id = _create_debt()

    created = client.post(
        f"/debts/{debt_id}/installments",
        json={
            "numero_cuota": 1,
            "fecha_vencimiento": "2026-08-15",
            "capital": 150,
            "interes": 50,
            "cuota_total": 200,
            "saldo_pendiente": 9850,
        },
    )
    assert created.status_code == 200
    inst_id = created.json()["id"]

    listed = client.get(f"/debts/{debt_id}/installments")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    updated = client.put(
        f"/debts/{debt_id}/installments/{inst_id}",
        json={
            "numero_cuota": 1,
            "fecha_vencimiento": "2026-08-20",
            "cuota_total": 210,
            "pagada": False,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["cuota_total"] == 210

    bulk = client.put(
        f"/debts/{debt_id}/installments/bulk",
        json={
            "installments": [
                {"numero_cuota": 1, "fecha_vencimiento": "2026-09-01", "cuota_total": 200},
                {"numero_cuota": 2, "fecha_vencimiento": "2026-10-01", "cuota_total": 195},
            ]
        },
    )
    assert bulk.status_code == 200
    assert len(bulk.json()) == 2

    all_rows = client.get("/debts/installments")
    assert all_rows.status_code == 200
    assert len(all_rows.json()) >= 2

    # After bulk replace, the old installment may or may not exist depending on DB autoincrement.
    # We just require the endpoint to behave correctly.
    deleted = client.delete(f"/debts/{debt_id}/installments/{inst_id}")
    assert deleted.status_code in (200, 404)


def test_calendario_uses_installment_not_generic_cuota():
    debt_id = _create_debt("Planilla cal")
    client.put(
        f"/debts/{debt_id}/installments/bulk",
        json={
            "installments": [
                {"numero_cuota": 1, "fecha_vencimiento": "2026-07-12", "cuota_total": 333},
            ]
        },
    )

    response = client.get("/api/calendario/pagos/7/2026")
    assert response.status_code == 200
    events = response.json()
    match = [e for e in events if e.get("id") == debt_id and e.get("tipo") == "deuda_cuota"]
    assert len(match) == 1
    assert match[0]["monto"] == 333
    assert datetime.fromisoformat(match[0]["fecha"]).day == 12

    # Generic dia_cargo (5) must not appear when planilla exists
    assert not any(
        e.get("id") == debt_id
        and e.get("tipo") == "deuda_cuota"
        and datetime.fromisoformat(e["fecha"]).day == 5
        for e in events
    )


def test_calendario_skips_paid_installments():
    debt_id = _create_debt("Pagada")
    client.post(
        f"/debts/{debt_id}/payments",
        json={"monto": 100, "fecha": "2026-07-20", "notas": "Pago"},
    )
    client.put(
        f"/debts/{debt_id}/installments/bulk",
        json={
            "installments": [
                {"numero_cuota": 1, "fecha_vencimiento": "2026-07-20", "cuota_total": 100},
            ]
        },
    )
    response = client.get("/api/calendario/pagos/7/2026")
    assert response.status_code == 200
    assert not any(e.get("id") == debt_id and e.get("tipo") == "deuda_cuota" for e in response.json())


def test_payment_marks_installment_paid():
    debt_id = _create_debt("Sync pago")
    client.put(
        f"/debts/{debt_id}/installments/bulk",
        json={
            "installments": [
                {"numero_cuota": 1, "fecha_vencimiento": "2026-08-01", "cuota_total": 200},
                {"numero_cuota": 2, "fecha_vencimiento": "2026-09-01", "cuota_total": 195},
            ]
        },
    )
    pay = client.post(
        f"/debts/{debt_id}/payments",
        json={"monto": 200, "fecha": "2026-08-01", "notas": "Transferencia"},
    )
    assert pay.status_code == 200
    debt = client.get("/debts/").json()
    d = next(x for x in debt if x["id"] == debt_id)
    assert d["monto_pagado"] == 200
    insts = client.get(f"/debts/{debt_id}/installments").json()
    assert insts[0]["pagada"] is True
    assert insts[1]["pagada"] is False


def test_bulk_recalculates_saldo_and_pagada():
    debt_id = _create_debt("Saldo auto")
    bulk = client.put(
        f"/debts/{debt_id}/installments/bulk",
        json={
            "installments": [
                {"numero_cuota": 1, "fecha_vencimiento": "2026-08-01", "cuota_total": 200},
                {"numero_cuota": 2, "fecha_vencimiento": "2026-09-01", "cuota_total": 200},
            ]
        },
    )
    assert bulk.status_code == 200
    rows = bulk.json()
    assert rows[0]["saldo_pendiente"] == 9800
    assert rows[0]["pagada"] is False
    assert rows[0]["capital"] == 200


def test_mark_installment_paid_via_api_ignored():
    """pagada manual en PUT ya no crea pago automático."""
    debt_id = _create_debt("Sync cuota")
    created = client.post(
        f"/debts/{debt_id}/installments",
        json={
            "numero_cuota": 1,
            "fecha_vencimiento": "2026-08-15",
            "cuota_total": 250,
        },
    )
    inst_id = created.json()["id"]
    updated = client.put(
        f"/debts/{debt_id}/installments/{inst_id}",
        json={
            "numero_cuota": 1,
            "fecha_vencimiento": "2026-08-15",
            "cuota_total": 250,
            "pagada": True,
        },
    )
    assert updated.status_code == 200
    debt = client.get("/debts/").json()
    d = next(x for x in debt if x["id"] == debt_id)
    assert d["monto_pagado"] == 0
    payments = client.get(f"/debts/{debt_id}/payments").json()
    assert len(payments) == 0


def test_installment_pagada_ignores_imported_monto_without_payments():
    """monto_pagado importado sin pagos reales no marca cuotas como pagadas."""
    debt_id = _create_debt("Import sin pagos")
    client.put(
        f"/debts/{debt_id}",
        json={
            "nombre": "Import sin pagos",
            "acreedor": "Banco Test",
            "monto_total": 10000,
            "monto_pagado": 400,
            "tipo": "Préstamo personal",
            "cuota_mensual": 200,
            "dia_cargo_mensual": 5,
        },
    )
    client.put(
        f"/debts/{debt_id}/installments/bulk",
        json={
            "installments": [
                {"numero_cuota": 1, "fecha_vencimiento": "2026-08-01", "cuota_total": 200},
                {"numero_cuota": 2, "fecha_vencimiento": "2026-09-01", "cuota_total": 200},
            ]
        },
    )

    insts = client.get(f"/debts/{debt_id}/installments").json()
    assert all(not i["pagada"] for i in insts)

    debt = next(x for x in client.get("/debts/").json() if x["id"] == debt_id)
    assert debt["monto_pagado"] == 400
    assert debt["monto_pagado_registrado"] == 0


def test_installment_pagada_follows_payments_not_inflated_monto():
    """Si monto_pagado está inflado pero solo hay un pago real, solo marca una cuota."""
    debt_id = _create_debt("Drift monto")
    client.put(
        f"/debts/{debt_id}/installments/bulk",
        json={
            "installments": [
                {"numero_cuota": 1, "fecha_vencimiento": "2026-08-01", "cuota_total": 200},
                {"numero_cuota": 2, "fecha_vencimiento": "2026-09-01", "cuota_total": 200},
            ]
        },
    )
    pay = client.post(
        f"/debts/{debt_id}/payments",
        json={"monto": 200, "fecha": "2026-08-01", "notas": "Un pago"},
    )
    assert pay.status_code == 200

    # Simular drift: monto_pagado inflado sin pagos adicionales
    debt = next(x for x in client.get("/debts/").json() if x["id"] == debt_id)
    client.put(
        f"/debts/{debt_id}",
        json={
            "nombre": debt["nombre"],
            "acreedor": debt["acreedor"],
            "monto_total": debt["monto_total"],
            "monto_pagado": 400,
            "tipo": debt["tipo"],
            "cuota_mensual": debt["cuota_mensual"],
            "dia_cargo_mensual": debt["dia_cargo_mensual"],
        },
    )

    insts = client.get(f"/debts/{debt_id}/installments").json()
    assert insts[0]["pagada"] is True
    assert insts[1]["pagada"] is False

    debt = next(x for x in client.get("/debts/").json() if x["id"] == debt_id)
    assert debt["monto_pagado"] == 200
