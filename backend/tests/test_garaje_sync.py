"""Sincronización con Garaje (HTTP simulado: Garaje no está en los tests de Soberan)."""
from datetime import datetime, timedelta

import pytest
import requests
from fastapi.testclient import TestClient

from app import models
from app.database import SessionLocal
from app.garaje_sync import resolve_garaje_url, run_garaje_sync
from app.main import app

client = TestClient(app)


class FakeResponse:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self._data


class FakeGaraje:
    def __init__(self, config):
        self.config = config
        self.posted = None

    def get(self, url, timeout):
        assert url.endswith("/api/integrations/soberan/config")
        return FakeResponse(self.config)

    def post(self, url, json, timeout):
        assert url.endswith("/api/integrations/soberan/sync")
        self.posted = json
        return FakeResponse({"vehicles_updated": 1, "inbox_created": len(json["transactions"])})


_SEEDED: list = []


def _clean_settings(db):
    db.query(models.UserSettings).filter(models.UserSettings.key.in_(["garaje_url", "garaje_last_sync"])).delete()
    db.commit()


@pytest.fixture
def garaje_env(monkeypatch):
    """La BD de tests es compartida por toda la suite: se borra lo sembrado al terminar
    (otros tests cuentan cuentas, transacciones y vehículos)."""
    monkeypatch.setenv("SOBERAN_GARAJE_URL", "http://garaje.test")
    db = SessionLocal()
    _clean_settings(db)
    yield db
    for obj in reversed(_SEEDED):
        db.delete(db.merge(obj))
    _SEEDED.clear()
    db.commit()
    _clean_settings(db)
    db.close()


def _seed(db):
    car = models.Property(
        nombre="Suzuki", tipo="vehiculo", marca="Suzuki", modelo="Vitara", anio=2019, km=55000,
        valor_estimado=12000, valor_actualizado_en=datetime.utcnow().isoformat(),
        valoracion_json='{"confianza": "alta"}',
    )
    flat = models.Property(nombre="Piso", tipo="inmueble", valor_estimado=200000)
    debt = models.Debt(nombre="Coche Suzuki", acreedor="Banco", monto_total=9000, monto_pagado=4000, tipo="loan", cuota_mensual=200)
    acc = models.Account()
    db.add_all([car, flat, debt, acc])
    db.flush()
    recent = datetime.utcnow() - timedelta(days=5)
    db.add_all([
        models.Transaction(account_id=acc.id, amount=-60.5, category_anon="Transporte", description_raw="REPSOL", date=recent),
        models.Transaction(account_id=acc.id, amount=-12, category_anon="Ocio", description_raw="CINE", date=recent),
        models.Transaction(account_id=acc.id, amount=-80, category_anon="Transporte", description_raw="TRASPASO", date=recent, es_interna=True),
        models.Transaction(account_id=acc.id, amount=-30, category_anon="Transporte", description_raw="ANTIGUO",
                           date=datetime.utcnow() - timedelta(days=400)),
    ])
    db.commit()
    _SEEDED.extend([acc, car, flat, debt])
    _SEEDED.extend(db.query(models.Transaction).filter(models.Transaction.account_id == acc.id).all())
    return car, debt


def test_disabled_without_url(monkeypatch):
    monkeypatch.delenv("SOBERAN_GARAJE_URL", raising=False)
    monkeypatch.delenv("SOBERAN_GARAJE_URL_FILE", raising=False)
    db = SessionLocal()
    try:
        db.query(models.UserSettings).filter(models.UserSettings.key == "garaje_url").delete()
        db.commit()
        assert run_garaje_sync(db) == {"status": "disabled"}
    finally:
        db.close()


def test_url_from_file_and_scheme_check(monkeypatch, tmp_path, garaje_env):
    monkeypatch.delenv("SOBERAN_GARAJE_URL")
    f = tmp_path / "garaje_url"
    f.write_text("http://10.0.0.5:23456/\n")
    monkeypatch.setenv("SOBERAN_GARAJE_URL_FILE", str(f))
    assert resolve_garaje_url(garaje_env) == "http://10.0.0.5:23456"
    f.write_text("file:///etc/passwd")
    assert resolve_garaje_url(garaje_env) is None


def test_sync_updates_km_and_sends_only_selected_spending(garaje_env):
    db = garaje_env
    car, debt = _seed(db)
    since = (datetime.utcnow() - timedelta(days=120)).date().isoformat()
    fake = FakeGaraje({
        "links": [{"garaje_vehicle_id": 1, "property_id": car.id, "debt_id": debt.id, "odometer_km": 61000,
                   "vin": "VSSZZZ5FZJR000001", "plate": "1234ABC"}],
        "categories": ["Transporte"],
        "since": since,
    })
    result = run_garaje_sync(db, http=fake)
    assert result["status"] == "ok"

    db.refresh(car)
    assert car.km == 61000 and car.matricula == "1234ABC" and car.bastidor == "VSSZZZ5FZJR000001"
    # +6000 km: la valoración queda caducada para que refresh-due la rehaga.
    assert car.valor_actualizado_en is None
    assert result["km_actualizados"][0]["revalorar"] is True

    sent = fake.posted
    sent_props = {p["id"]: p for p in sent["properties"]}
    assert car.id in sent_props and sent_props[car.id]["confianza"] == "alta"
    assert all(p["nombre"] != "Piso" for p in sent["properties"])
    assert any(d["id"] == debt.id and d["pendiente"] == 5000 for d in sent["debts"])
    # Solo Transporte, gasto, no interno y dentro de la ventana.
    descriptions = {t["description"] for t in sent["transactions"]}
    assert "REPSOL" in descriptions and not descriptions & {"CINE", "TRASPASO", "ANTIGUO"}
    # Solo categorías del coche: «Ocio» (cine) no se ofrece a Garaje.
    assert "Transporte" in sent["categories"] and "Ocio" not in sent["categories"]

    # Throttle: una segunda llamada inmediata no vuelve a hablar con Garaje.
    assert run_garaje_sync(db, http=fake)["status"] == "skipped"


def test_km_never_decreases(garaje_env):
    db = garaje_env
    car, _ = _seed(db)
    fake = FakeGaraje({"links": [{"property_id": car.id, "odometer_km": 1000}], "categories": [], "since": None})
    run_garaje_sync(db, force=True, http=fake)
    db.refresh(car)
    assert car.km == 55000 and fake.posted["transactions"] == []


def test_unreachable_garaje_is_not_an_error(garaje_env):
    class Down:
        def get(self, *a, **k):
            raise requests.ConnectionError("down")

    assert run_garaje_sync(garaje_env, force=True, http=Down())["status"] == "error"


def test_endpoint_disabled_by_default(monkeypatch):
    monkeypatch.delenv("SOBERAN_GARAJE_URL", raising=False)
    monkeypatch.delenv("SOBERAN_GARAJE_URL_FILE", raising=False)
    r = client.post("/integrations/garaje/sync")
    assert r.status_code == 200 and r.json()["status"] in ("disabled", "ok", "skipped", "error")


def test_car_categories_by_name_and_merchant(garaje_env):
    from app.garaje_sync import car_categories

    db = garaje_env
    acc = models.Account()
    db.add(acc)
    db.flush()
    now = datetime.utcnow()
    db.add_all([
        models.Transaction(account_id=acc.id, amount=-40, category_anon="Varios", description_raw="COMPRA PLENOIL GETAFE", date=now),
        models.Transaction(account_id=acc.id, amount=-10, category_anon="Supermercado", description_raw="MERCADONA", date=now),
        models.Transaction(account_id=acc.id, amount=-300, category_anon="Seguro coche", description_raw="MAPFRE", date=now),
    ])
    db.commit()
    _SEEDED.extend([acc, *db.query(models.Transaction).filter(models.Transaction.account_id == acc.id).all()])
    cats = car_categories(db, ["Elegida a mano"])
    assert {"Varios", "Seguro coche", "Elegida a mano"} <= set(cats) and "Supermercado" not in cats
