"""Bank sync alert findings."""
from datetime import datetime, timedelta

from app.bank_sync_alerts import build_bank_sync_alert


def test_build_bank_sync_alert_none_without_linked(db_session):
    assert build_bank_sync_alert(db_session) is None


def test_build_bank_sync_alert_stale_and_error(db_session):
    from app import models

    now = datetime.utcnow()
    acc = models.Account(
        alias_real="Revolut Pocket",
        alias_anonimo="r1",
        tipo="corriente",
        balance_actual=10,
        banco="Revolut",
        gocardless_account_id="gc-acc-1",
        last_sync_at=now - timedelta(days=3),
        last_sync_error="Rate limit exceeded",
        archivada=False,
        oculta=False,
    )
    archived = models.Account(
        alias_real="Old pocket",
        alias_anonimo="r2",
        tipo="corriente",
        balance_actual=0,
        banco="Revolut",
        gocardless_account_id="gc-acc-2",
        last_sync_error="ignored",
        archivada=True,
        oculta=False,
    )
    db_session.add(acc)
    db_session.add(archived)
    db_session.commit()

    finding = build_bank_sync_alert(db_session, now=now)
    assert finding is not None
    assert finding["tipo"] == "sync_bancaria"
    assert finding["severidad"] == "media"
    assert "sin sync" in finding["mensaje"]
    assert "fallaron" in finding["mensaje"]
    assert "Rate limit" in finding["mensaje"]
