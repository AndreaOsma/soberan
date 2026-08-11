from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_riesgo_liquidez_muestra_magnitud_sin_signo():
    # Arrange: create a negative account
    acc = client.post(
        "/accounts/",
        json={
            "alias_real": "Cuenta liquidez test",
            "alias_anonimo": "ACC_LIQ_TEST",
            "tipo": "fondos",
            "balance_actual": -4159.99,
            "banco": "Banco Test",
            "iban": None,
        },
    )
    assert acc.status_code == 200

    # Act: fetch alerts
    res = client.get("/api/alertas")
    assert res.status_code == 200
    alertas = res.json()

    # Assert: liquidity alert should show positive discovered amount
    msg = next((a.get("mensaje", "") for a in alertas if a.get("tipo") == "riesgo_liquidez"), "")
    assert "descubierto de 4159.99€" in msg
    assert "-4159.99" not in msg

