from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _create_account(alias: str, banco: str) -> dict:
    res = client.post("/accounts/", json={
        "alias_real": alias,
        "alias_anonimo": None,
        "tipo": "gasto",
        "balance_actual": 100,
        "banco": banco,
    })
    assert res.status_code == 200
    return res.json()


def test_payroll_account_config_history_and_archive():
    ing = _create_account("ING Nómina", "ING")
    myi = _create_account("MyInvestor", "MyInvestor")

    first = client.post("/payroll/account-config", json={
        "empresa": "Acme SL",
        "account_id": ing["id"],
        "archive_previous_account": False,
    })
    assert first.status_code == 200
    assert first.json()["account_id"] == ing["id"]
    assert len(first.json()["history"]) == 1

    second = client.post("/payroll/account-config", json={
        "empresa": "Acme SL",
        "account_id": myi["id"],
        "archive_previous_account": True,
    })
    assert second.status_code == 200
    body = second.json()
    assert body["account_id"] == myi["id"]
    assert len(body["history"]) == 2
    assert body["history"][-1]["to_date"] is None
    assert body["history"][-2]["to_date"] is not None

    accounts = client.get("/accounts/").json()
    old = next(a for a in accounts if a["id"] == ing["id"])
    assert old["archivada"] is True

    fetched = client.get("/payroll/account-config", params={"empresa": "Acme SL"})
    assert fetched.status_code == 200
    assert fetched.json()["account_alias"] == "MyInvestor"
