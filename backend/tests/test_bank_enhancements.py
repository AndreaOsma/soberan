from app.bank_categorization import infer_transaction_category, load_budget_category_hints
from app.internal_transfers import detect_internal_transfers, mark_internal_pair, unmark_internal
from app.internal_transfers import INTERNAL_TRANSFER_CATEGORY


def test_infer_category_from_rules():
    cat = infer_transaction_category("Compra MERCADONA centro", -42.5, [], {"mercadona": "Alimentación"})
    assert cat == "Alimentación"


def test_infer_payroll_keyword():
    cat = infer_transaction_category("Abono NOMINA JULIO", 2000, [], {})
    assert cat == "Nómina"


def test_detect_internal_transfer_pair(db_session):
    from app import models

    a1 = models.Account(alias_real="A", alias_anonimo="T1", tipo="gasto", balance_actual=0, banco="B")
    a2 = models.Account(alias_real="B", alias_anonimo="T2", tipo="gasto", balance_actual=0, banco="B")
    db_session.add_all([a1, a2])
    db_session.flush()
    out_tx = models.Transaction(account_id=a1.id, amount=-100, category_anon="", description_raw="traspaso", date=__import__("datetime").datetime.utcnow())
    in_tx = models.Transaction(account_id=a2.id, amount=100, category_anon="", description_raw="traspaso", date=__import__("datetime").datetime.utcnow())
    db_session.add_all([out_tx, in_tx])
    db_session.commit()

    pairs = detect_internal_transfers(db_session, days=1)
    assert pairs == 1
    db_session.refresh(out_tx)
    db_session.refresh(in_tx)
    assert out_tx.es_interna
    assert in_tx.es_interna
    assert out_tx.category_anon == INTERNAL_TRANSFER_CATEGORY


def test_unmark_internal(db_session):
    from app import models

    acc = models.Account(alias_real="A", alias_anonimo="T3", tipo="gasto", balance_actual=0, banco="B")
    db_session.add(acc)
    db_session.flush()
    tx = models.Transaction(account_id=acc.id, amount=-50, category_anon=INTERNAL_TRANSFER_CATEGORY, description_raw="x", date=__import__("datetime").datetime.utcnow(), es_interna=True, transfer_pair_id=1)
    db_session.add(tx)
    db_session.commit()
    unmark_internal(db_session, tx.id)
    db_session.refresh(tx)
    assert not tx.es_interna
    assert tx.category_anon == ""
