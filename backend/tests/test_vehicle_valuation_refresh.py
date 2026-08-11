"""API tests for monthly vehicle valuation refresh-due (mocked market)."""
from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.database import SessionLocal
from app import models
from app.vehicle_valuation import ValuationResult

client = TestClient(app)


def _fake_result(valor: float = 8000.0) -> ValuationResult:
    now = datetime.utcnow().isoformat()
    return ValuationResult(
        valor_estimado=valor,
        muestras=8,
        min=7000,
        max=12000,
        mediana=9000,
        asking_p10=7500,
        asking_p25=8000,
        asking_p50=9000,
        asking_ref=8200,
        haircut=0.12,
        valor_mercado_realizable=valor,
        precios_muestra=[7500, 8000, 9000],
        fuente="wallapop",
        percentil_usado=15.0,
        confianza="media",
        filtro_año=", año 2016 ±3",
        filtro_km=100000,
        precio_cap=16000,
        actualizado_en=now,
    )


def test_refresh_due_revalues_stale_and_skips_fresh():
    db = SessionLocal()
    try:
        stale = models.Property(
            nombre="Coche viejo",
            valor_estimado=10000,
            tipo="vehiculo",
            marca="Seat",
            modelo="Leon",
            anio=2016,
            km=120000,
            valor_actualizado_en=(datetime.utcnow() - timedelta(days=40)).isoformat(),
        )
        fresh = models.Property(
            nombre="Coche reciente",
            valor_estimado=9000,
            tipo="vehiculo",
            marca="Seat",
            modelo="Ibiza",
            anio=2018,
            km=80000,
            valor_actualizado_en=datetime.utcnow().isoformat(),
        )
        incomplete = models.Property(
            nombre="Sin modelo",
            valor_estimado=5000,
            tipo="vehiculo",
            marca="Ford",
            modelo=None,
        )
        house = models.Property(
            nombre="Piso",
            valor_estimado=200000,
            tipo="inmueble",
        )
        db.add_all([stale, fresh, incomplete, house])
        db.commit()
        stale_id = stale.id
        fresh_val = fresh.valor_estimado
    finally:
        db.close()

    with patch(
        "app.vehicle_valuation.estimate_vehicle_value",
        return_value=_fake_result(7777.0),
    ) as mocked:
        resp = client.post("/properties/vehicle-valuation/refresh-due")

    assert resp.status_code == 200
    body = resp.json()
    assert body["interval_days"] == 30
    assert len(body["refreshed"]) == 1
    assert body["refreshed"][0]["id"] == stale_id
    assert body["refreshed"][0]["valor_estimado"] == 7777.0
    assert body["skipped"] >= 2
    assert body["errors"] == []
    assert mocked.call_count == 1

    db = SessionLocal()
    try:
        updated = db.query(models.Property).filter(models.Property.id == stale_id).first()
        assert updated is not None
        assert updated.valor_estimado == 7777.0
        assert updated.valoracion_json is not None
        still_fresh = db.query(models.Property).filter(models.Property.nombre == "Coche reciente").first()
        assert still_fresh is not None
        assert still_fresh.valor_estimado == fresh_val
    finally:
        db.close()
