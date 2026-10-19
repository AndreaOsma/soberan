"""GET /transactions/ optional desde/hasta/limit/offset — additive, backward compatible."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _make_account():
    return client.post("/accounts/", json={
        "alias_real": "Filter Test Acc",
        "tipo": "ahorro",
        "balance_actual": 0.0,
        "banco": "Test Bank",
    }).json()["id"]


def _make_tx(account_id: int, date: str, label: str):
    res = client.post("/transactions/", json={
        "account_id": account_id,
        "amount": -1.0,
        "category_anon": "Ocio",
        "description_raw": label,
        "date": date,
    })
    assert res.status_code == 200
    return res.json()["id"]


def test_no_params_returns_everything_like_before():
    acc = _make_account()
    _make_tx(acc, "2024-01-15T00:00:00", "no-filter-jan")
    _make_tx(acc, "2024-06-15T00:00:00", "no-filter-jun")

    labels = {tx["description_raw"] for tx in client.get("/transactions/").json()}
    assert {"no-filter-jan", "no-filter-jun"}.issubset(labels)


def test_desde_hasta_bound_the_range_inclusive():
    acc = _make_account()
    _make_tx(acc, "2023-01-01T00:00:00", "range-before")
    _make_tx(acc, "2023-05-10T12:00:00", "range-inside")
    _make_tx(acc, "2023-05-31T23:59:00", "range-inside-edge")
    _make_tx(acc, "2023-09-01T00:00:00", "range-after")

    res = client.get("/transactions/?desde=2023-05-01&hasta=2023-05-31")
    labels = {tx["description_raw"] for tx in res.json()}
    assert labels == {"range-inside", "range-inside-edge"}


def test_limit_and_offset_paginate():
    acc = _make_account()
    for day in range(1, 6):
        _make_tx(acc, f"2022-02-0{day}T00:00:00", f"page-{day}")

    page1 = client.get("/transactions/?desde=2022-02-01&hasta=2022-02-05&limit=2&offset=0").json()
    page2 = client.get("/transactions/?desde=2022-02-01&hasta=2022-02-05&limit=2&offset=2").json()
    assert len(page1) == 2
    assert len(page2) == 2
    assert {tx["id"] for tx in page1}.isdisjoint({tx["id"] for tx in page2})


def test_invalid_date_format_is_rejected():
    res = client.get("/transactions/?desde=not-a-date")
    assert res.status_code == 400
