"""Transaction expense splits (shared costs)."""
from app.main import app
from app.transaction_splits import budget_expense_amount, validate_split_payload
from fastapi.testclient import TestClient

client = TestClient(app)


def _account():
    res = client.post("/accounts/", json={
        "alias_real": "Split Test",
        "tipo": "corriente",
        "balance_actual": 500.0,
        "banco": "Test",
    })
    assert res.status_code == 200
    return res.json()["id"]


def test_validate_split_payload_ok():
    rows = validate_split_payload(-90, [
        {"person_name": "Yo", "amount": 30, "is_me": True},
        {"person_name": "María", "amount": 30, "is_me": False},
        {"person_name": "Juan", "amount": 30, "is_me": False},
    ])
    assert len(rows) == 3
    assert sum(r["amount"] for r in rows) == 90


def test_validate_rejects_income_and_bad_sum():
    try:
        validate_split_payload(50, [{"person_name": "Yo", "amount": 50, "is_me": True}])
        assert False, "expected error"
    except ValueError:
        pass
    try:
        validate_split_payload(-50, [
            {"person_name": "Yo", "amount": 20, "is_me": True},
            {"person_name": "A", "amount": 20, "is_me": False},
        ])
        assert False, "expected sum error"
    except ValueError as err:
        assert "coincidir" in str(err).lower() or "suma" in str(err).lower()


def test_budget_expense_amount_uses_my_share():
    class Split:
        def __init__(self, amount, is_me):
            self.amount = amount
            self.is_me = is_me

    class Tx:
        amount = -90
        es_interna = False
        es_pending = False
        excluida_presupuesto = False
        splits = [Split(30, True), Split(60, False)]

    assert budget_expense_amount(Tx()) == 30


def test_put_splits_and_list_includes_them():
    acc_id = _account()
    tx = client.post("/transactions/", json={
        "account_id": acc_id,
        "amount": -90.0,
        "category_anon": "Ocio",
        "description_raw": "Cena",
    }).json()

    put = client.put(f"/transactions/{tx['id']}/splits", json={
        "splits": [
            {"person_name": "Yo", "amount": 30, "is_me": True},
            {"person_name": "María", "amount": 40, "is_me": False},
            {"person_name": "Juan", "amount": 20, "is_me": False},
        ],
    })
    assert put.status_code == 200, put.text
    assert len(put.json()) == 3

    listed = client.get("/transactions/").json()
    row = next(t for t in listed if t["id"] == tx["id"])
    assert len(row.get("splits") or []) == 3
    me = next(s for s in row["splits"] if s["is_me"])
    assert me["amount"] == 30

    bal = client.get("/transactions/split-balances").json()
    by = {p["person_name"]: p["amount"] for p in bal["by_person"]}
    assert by.get("María") == 40
    assert by.get("Juan") == 20
    assert bal["total"] == 60

    # Mark María settled
    put2 = client.put(f"/transactions/{tx['id']}/splits", json={
        "splits": [
            {"person_name": "Yo", "amount": 30, "is_me": True},
            {"person_name": "María", "amount": 40, "is_me": False, "settled": True},
            {"person_name": "Juan", "amount": 20, "is_me": False},
        ],
    })
    assert put2.status_code == 200
    bal2 = client.get("/transactions/split-balances").json()
    assert bal2["total"] == 20
