import pytest
from datetime import datetime
from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app import models

client = TestClient(app)

def test_delete_non_existent_account():
    response = client.delete("/accounts/999999")
    assert response.status_code == 404
    assert response.json()["detail"] == "Cuenta no encontrada"

def test_delete_non_existent_transaction():
    response = client.delete("/transactions/999999")
    assert response.status_code == 404
    assert response.json()["detail"] == "Transacción no encontrada"

def test_create_transaction_invalid_category():
    # First create an account to link the transaction
    acc_res = client.post("/accounts/", json={
        "alias_real": "Test Account",
        "tipo": "corriente",
        "balance_actual": 100.0,
        "banco": "Test Bank"
    })
    assert acc_res.status_code == 200
    acc_id = acc_res.json()["id"]

    # Try to create transaction with invalid (non-taxonomy) category
    tx_res = client.post("/transactions/", json={
        "account_id": acc_id,
        "amount": -10.0,
        "category_anon": "categoria_inventada_xyz",
        "description_raw": "Test Invalid Category"
    })
    assert tx_res.status_code == 400
    assert "taxonomía" in tx_res.json()["detail"].lower() or "categoría" in tx_res.json()["detail"].lower()


def test_create_transaction_acepta_otros_gastos_alias():
    acc_res = client.post("/accounts/", json={
        "alias_real": "Otros Alias Acc",
        "tipo": "corriente",
        "balance_actual": 100.0,
        "banco": "Test Bank"
    })
    acc_id = acc_res.json()["id"]
    tx_res = client.post("/transactions/", json={
        "account_id": acc_id,
        "amount": -10.0,
        "category_anon": "otros",
        "description_raw": "Alias otros",
    })
    assert tx_res.status_code == 200
    assert tx_res.json()["category_anon"] == "Otros gastos"

def test_update_transaction_allows_empty_category_and_edit():
    acc_res = client.post("/accounts/", json={
        "alias_real": "Edit Account",
        "tipo": "corriente",
        "balance_actual": 200.0,
        "banco": "Test Bank",
    })
    assert acc_res.status_code == 200
    acc_id = acc_res.json()["id"]

    create_res = client.post("/transactions/", json={
        "account_id": acc_id,
        "amount": -25.0,
        "category_anon": "Alimentación",
        "description_raw": "Compra editable",
        "date": "2026-07-01T00:00:00",
    })
    assert create_res.status_code == 200
    tx_id = create_res.json()["id"]

    update_res = client.put(f"/transactions/{tx_id}", json={
        "account_id": acc_id,
        "amount": -30.0,
        "category_anon": "",
        "description_raw": "Compra editada",
        "date": "2026-07-02T00:00:00",
    })
    assert update_res.status_code == 200
    body = update_res.json()
    assert body["amount"] == -30.0
    assert body["description_raw"] == "Compra editada"
    assert body["category_anon"] == ""

    del_res = client.delete(f"/transactions/{tx_id}")
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "ok"

def test_list_transactions_with_null_account_id():
    db = SessionLocal()
    try:
        db.add(models.Transaction(
            account_id=None,
            amount=-12.5,
            category_anon="Supermercado",
            description_raw="Transacción huérfana",
            date=datetime.utcnow(),
        ))
        db.commit()
        response = client.get("/transactions/")
        assert response.status_code == 200
        orphan = next(tx for tx in response.json() if tx["description_raw"] == "Transacción huérfana")
        assert orphan["account_id"] is None
    finally:
        db.close()
