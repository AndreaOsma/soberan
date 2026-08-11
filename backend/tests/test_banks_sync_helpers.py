"""Tests for bank sync helpers (balance pick, date window, pending merge)."""
from datetime import datetime, timedelta

from app import models
from app.routers.banks import (
    _find_pending_match,
    _import_gc_tx_list,
    _pick_gc_balance,
    _resolve_date_from,
)

# db_session fixture comes from tests/conftest.py (shared in-memory engine).
# Do NOT create_all/drop_all here: the engine is shared by the whole pytest
# session, so dropping tables in this file's teardown broke every test that
# ran afterwards ("no such table") — that used to be the single biggest
# source of red tests in the suite.


def test_pick_gc_balance_prefers_interim_available():
  balances = [
      {"balanceType": "closingBooked", "balanceAmount": {"amount": "100.00"}},
      {"balanceType": "interimAvailable", "balanceAmount": {"amount": "150.00"}},
  ]
  picked = _pick_gc_balance(balances)
  assert picked["balanceType"] == "interimAvailable"
  assert picked["balanceAmount"]["amount"] == "150.00"


def test_resolve_date_from_minimum_31_days(db_session):
    acc = models.Account(alias_real="A", alias_anonimo="T", tipo="gasto", balance_actual=0, banco="B")
    db_session.add(acc)
    db_session.flush()
    old = datetime.utcnow() - timedelta(days=3)
    db_session.add(
        models.Transaction(
            account_id=acc.id,
            amount=-10,
            category_anon="",
            description_raw="x",
            date=old,
            gocardless_tx_id="gc-old",
        )
    )
    db_session.commit()

    resolved = _resolve_date_from(db_session, acc.id, None)
    expected_min = (datetime.utcnow() - timedelta(days=31)).date().isoformat()
    assert resolved <= expected_min


def test_pending_to_booked_merge(db_session):
    acc = models.Account(alias_real="A", alias_anonimo="T2-banks-sync", tipo="gasto", balance_actual=0, banco="B")
    db_session.add(acc)
    db_session.flush()
    tx_date = datetime.utcnow()
    pending = models.Transaction(
        account_id=acc.id,
        amount=-25.5,
        category_anon="",
        description_raw="pending shop",
        date=tx_date,
        gocardless_tx_id="hash_pending",
        es_pending=True,
    )
    db_session.add(pending)
    db_session.commit()

    booked_tx = {
        "transactionId": "real-id-123",
        "transactionAmount": {"amount": "-25.50"},
        "bookingDate": tx_date.date().isoformat(),
        "creditorName": "SHOP",
    }
    created, updated = _import_gc_tx_list(
        db_session, acc, "gc-acc-1", [booked_tx], [], {}, es_pending=False,
    )
    db_session.commit()

    assert created == 0
    assert updated >= 1
    db_session.refresh(pending)
    assert pending.gocardless_tx_id == "real-id-123"
    assert not pending.es_pending


def test_import_refreshes_cryptic_description(db_session):
    acc = models.Account(alias_real="A", alias_anonimo="T3-banks-sync", tipo="gasto", balance_actual=0, banco="B")
    db_session.add(acc)
    db_session.flush()
    tx_date = datetime.utcnow()
    existing = models.Transaction(
        account_id=acc.id,
        amount=-9.99,
        category_anon="",
        description_raw="COMPRA",
        date=tx_date,
        gocardless_tx_id="gc-rich-1",
    )
    db_session.add(existing)
    db_session.commit()

    booked_tx = {
        "transactionId": "gc-rich-1",
        "transactionAmount": {"amount": "-9.99"},
        "bookingDate": tx_date.date().isoformat(),
        "creditorName": "MERCADONA SA",
        "remittanceInformationUnstructured": "COMPRA TARJETA 4455",
        "additionalInformation": "TPV CENTRO",
        "proprietaryBankTransactionCode": "COMPRA TPV",
    }
    created, updated = _import_gc_tx_list(
        db_session, acc, "gc-acc-2", [booked_tx], [], {}, es_pending=False,
    )
    db_session.commit()
    db_session.refresh(existing)

    assert created == 0
    assert updated >= 1
    # Sync may keep the rich bank dump or apply expense naming heuristics
    assert "mercadona" in existing.description_raw.lower()
