"""Transactions do not mutate account balance (bank sync / manual edit owns it)."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_transaction_crud_does_not_change_balance():
    acc_res = client.post("/accounts/", json={
        "alias_real": "Balance Test Acc",
        "tipo": "ahorro",
        "balance_actual": 1000.0,
        "banco": "Test Bank"
    })
    acc_id = acc_res.json()["id"]
    assert acc_res.json()["balance_actual"] == 1000.0

    tx_res = client.post("/transactions/", json={
        "account_id": acc_id,
        "amount": -200.0,
        "category_anon": "Ocio",
        "description_raw": "Compra semanal"
    })
    assert tx_res.status_code == 200
    tx_id = tx_res.json()["id"]

    acc = next(a for a in client.get("/accounts/").json() if a["id"] == acc_id)
    assert acc["balance_actual"] == 1000.0

    client.put(f"/transactions/{tx_id}", json={
        "account_id": acc_id,
        "amount": -150.0,
        "category_anon": "Ocio",
        "description_raw": "Compra semanal ajustada"
    })

    acc = next(a for a in client.get("/accounts/").json() if a["id"] == acc_id)
    assert acc["balance_actual"] == 1000.0

    client.delete(f"/transactions/{tx_id}")

    acc = next(a for a in client.get("/accounts/").json() if a["id"] == acc_id)
    assert acc["balance_actual"] == 1000.0


def test_transaction_move_between_accounts_keeps_balances():
    acc1 = client.post("/accounts/", json={"alias_real": "Acc 1", "tipo": "c", "balance_actual": 500.0, "banco": "B1"}).json()
    acc2 = client.post("/accounts/", json={"alias_real": "Acc 2", "tipo": "c", "balance_actual": 500.0, "banco": "B2"}).json()

    tx = client.post("/transactions/", json={
        "account_id": acc1["id"],
        "amount": -100.0,
        "category_anon": "Ocio",
        "description_raw": "Cena"
    }).json()

    client.put(f"/transactions/{tx['id']}", json={
        "account_id": acc2["id"],
        "amount": -100.0,
        "category_anon": "Ocio",
        "description_raw": "Cena movida"
    })

    acc1_after = next(a for a in client.get("/accounts/").json() if a["id"] == acc1["id"])
    acc2_after = next(a for a in client.get("/accounts/").json() if a["id"] == acc2["id"])

    assert acc1_after["balance_actual"] == 500.0
    assert acc2_after["balance_actual"] == 500.0
