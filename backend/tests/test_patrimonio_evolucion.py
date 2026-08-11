from datetime import datetime

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _make_account():
    res = client.post("/accounts/", json={
        "alias_real": "Patrimonio Test Acc",
        "tipo": "ahorro",
        "balance_actual": 0.0,
        "banco": "Test Bank",
    })
    assert res.status_code == 200
    return res.json()["id"]


def _make_tx(account_id: int, amount: float, iso_date: str):
    res = client.post("/transactions/", json={
        "account_id": account_id,
        "amount": amount,
        "category_anon": "Otros",
        "description_raw": "Patrimonio evolucion test",
        "date": iso_date,
    })
    assert res.status_code == 200
    return res.json()["id"]


def test_evolucion_agrega_por_mes_y_arrastra_meses_sin_movimientos():
    acc = _make_account()
    _make_tx(acc, 100.0, "2020-01-15T00:00:00")
    _make_tx(acc, 50.0, "2020-01-20T00:00:00")
    # Febrero sin movimientos: debe arrastrar el acumulado de enero.
    _make_tx(acc, -30.0, "2020-03-10T00:00:00")

    response = client.get("/api/patrimonio/evolucion/2020")
    assert response.status_code == 200
    rows = response.json()

    assert [r["fecha"] for r in rows] == [f"2020-{m:02d}" for m in range(1, 13)]
    by_month = {r["fecha"]: r["acumulado"] for r in rows}
    assert by_month["2020-01"] == 150.0
    assert by_month["2020-02"] == 150.0  # arrastrado, sin movimientos propios
    assert by_month["2020-03"] == 120.0
    assert by_month["2020-12"] == 120.0  # se mantiene hasta fin de año


def test_evolucion_no_incluye_transacciones_de_otros_anios():
    acc = _make_account()
    _make_tx(acc, 1000.0, "2021-06-01T00:00:00")
    _make_tx(acc, 999.0, "2022-01-01T00:00:00")

    rows_2021 = client.get("/api/patrimonio/evolucion/2021").json()
    by_month_2021 = {r["fecha"]: r["acumulado"] for r in rows_2021}
    assert by_month_2021["2021-06"] == 1000.0
    assert by_month_2021["2021-12"] == 1000.0  # no se cuela el ingreso de 2022


def test_evolucion_anio_actual_nunca_devuelve_meses_futuros():
    current_year = datetime.utcnow().year
    response = client.get(f"/api/patrimonio/evolucion/{current_year}")
    assert response.status_code == 200
    rows = response.json()
    months = [int(r["fecha"].split("-")[1]) for r in rows]
    assert max(months, default=0) <= datetime.utcnow().month
    assert months == sorted(months)


def test_evolucion_anio_sin_movimientos_devuelve_lista_vacia():
    response = client.get("/api/patrimonio/evolucion/2019")
    assert response.status_code == 200
    assert response.json() == []
