from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_account_hide_without_archive():
    res = client.post("/accounts/", json={
        "alias_real": "Cuenta oculta test",
        "alias_anonimo": None,
        "tipo": "gasto",
        "balance_actual": 50,
        "banco": "Test",
        "oculta": True,
    })
    assert res.status_code == 200
    body = res.json()
    assert body["oculta"] is True
    assert body["archivada"] is False

    listed = client.get("/accounts/").json()
    found = next(a for a in listed if a["id"] == body["id"])
    assert found["oculta"] is True
    assert found["archivada"] is False

    tx = client.post("/transactions/", json={
        "account_id": body["id"],
        "amount": -10,
        "category_anon": "Ocio",
        "description_raw": "movimiento en cuenta oculta",
    })
    assert tx.status_code == 200

    txs = client.get("/transactions/").json()
    assert any(t["account_id"] == body["id"] for t in txs)
