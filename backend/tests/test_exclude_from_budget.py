"""Tests for excluding transactions from budget totals."""
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def _account():
    res = client.post("/accounts/", json={
        "alias_real": "Omit Test",
        "tipo": "corriente",
        "balance_actual": 500.0,
        "banco": "Test",
    })
    assert res.status_code == 200
    return res.json()["id"]


def test_exclude_and_include_transaction_from_budget():
    acc_id = _account()
    tx = client.post("/transactions/", json={
        "account_id": acc_id,
        "amount": -42.0,
        "category_anon": "Ocio",
        "description_raw": "Cine",
    }).json()
    assert tx.get("excluida_presupuesto") is False

    ex = client.post(f"/transactions/{tx['id']}/exclude-from-budget")
    assert ex.status_code == 200

    listed = client.get("/transactions/").json()
    row = next(t for t in listed if t["id"] == tx["id"])
    assert row["excluida_presupuesto"] is True

    inc = client.post(f"/transactions/{tx['id']}/include-in-budget")
    assert inc.status_code == 200
    listed2 = client.get("/transactions/").json()
    row2 = next(t for t in listed2 if t["id"] == tx["id"])
    assert row2["excluida_presupuesto"] is False


def test_exclude_income_transaction_from_budget():
    acc_id = _account()
    tx = client.post("/transactions/", json={
        "account_id": acc_id,
        "amount": 1500.0,
        "category_anon": "Nómina",
        "description_raw": "Nómina julio",
    }).json()
    assert tx.get("excluida_presupuesto") is False

    ex = client.post(f"/transactions/{tx['id']}/exclude-from-budget")
    assert ex.status_code == 200
    listed = client.get("/transactions/").json()
    row = next(t for t in listed if t["id"] == tx["id"])
    assert row["excluida_presupuesto"] is True
    assert row["amount"] == 1500.0
