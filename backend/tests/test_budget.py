from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_monthly_budget_crud_roundtrip():
    entry = client.post(
        "/recurring-entries/",
        json={
            "nombre": "Alquiler test",
            "monto_estimado": 850.0,
            "es_ingreso": False,
            "es_fijo": True,
            "categoria": "Vivienda",
        },
    )
    assert entry.status_code == 200
    entry_id = entry.json()["id"]

    create = client.post(
        "/monthly-budget/",
        json={
            "mes": 7,
            "anio": 2026,
            "recurring_entry_id": entry_id,
            "monto_real": 820.0,
            "excluido": False,
            "cuenta_gestion_id": None,
            "movido_a_cuenta": False,
            "movido_checked_at": None,
        },
    )
    assert create.status_code == 200
    assert create.json()["monto_real"] == 820.0
    assert create.json()["movido_a_cuenta"] is False
    assert create.json()["cuenta_gestion_id"] is None

    listed = client.get("/monthly-budget/7/2026")
    assert listed.status_code == 200
    items = listed.json()
    assert any(i["recurring_entry_id"] == entry_id for i in items)

    update = client.post(
        "/monthly-budget/",
        json={
            "mes": 7,
            "anio": 2026,
            "recurring_entry_id": entry_id,
            "monto_real": 820.0,
            "excluido": False,
            "cuenta_gestion_id": 123,
            "movido_a_cuenta": True,
            "movido_checked_at": "2026-07-30T09:00:00",
        },
    )
    assert update.status_code == 200
    assert update.json()["cuenta_gestion_id"] == 123
    assert update.json()["movido_a_cuenta"] is True


def test_monthly_budget_list_empty_month():
    response = client.get("/monthly-budget/1/2099")
    assert response.status_code == 200
    assert response.json() == []


def test_recurring_entry_rentabilidad_anual_pct_roundtrip():
    created = client.post(
        "/recurring-entries/",
        json={
            "nombre": "ETF indexado",
            "monto_estimado": 200.0,
            "es_ingreso": False,
            "es_fijo": True,
            "categoria": "Ahorro",
            "tipo_partida": "ahorro_inversion",
            "rentabilidad_anual_pct": 6.5,
        },
    )
    assert created.status_code == 200
    assert created.json()["rentabilidad_anual_pct"] == 6.5
    entry_id = created.json()["id"]

    listed = client.get("/recurring-entries/")
    assert listed.status_code == 200
    assert any(e["id"] == entry_id and e["rentabilidad_anual_pct"] == 6.5 for e in listed.json())

    updated = client.put(
        f"/recurring-entries/{entry_id}",
        json={
            "nombre": "ETF indexado",
            "monto_estimado": 200.0,
            "es_ingreso": False,
            "es_fijo": True,
            "categoria": "Ahorro",
            "tipo_partida": "ahorro_inversion",
            "rentabilidad_anual_pct": 7.0,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["rentabilidad_anual_pct"] == 7.0


def test_recurring_entry_rentabilidad_anual_pct_defaults_to_none():
    created = client.post(
        "/recurring-entries/",
        json={
            "nombre": "Sin tasa",
            "monto_estimado": 100.0,
            "es_ingreso": False,
            "es_fijo": True,
            "categoria": "Ahorro",
        },
    )
    assert created.status_code == 200
    assert created.json()["rentabilidad_anual_pct"] is None
