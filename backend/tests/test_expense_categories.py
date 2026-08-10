"""Tests for fixed expense/income taxonomy."""
from app.expense_categories import (
    SUBSCRIPTION_CATEGORY,
    canonicalize_for_amount,
    is_learnable_token,
    normalize_category,
)
from app.bank_categorization import infer_transaction_category


def test_normalize_aliases():
    assert normalize_category("Suscripciones y facturas") == SUBSCRIPTION_CATEGORY
    assert normalize_category("Vivienda") == "Hogar"
    assert normalize_category("General") == ""
    assert normalize_category("otros") == "Otros gastos"


def test_infer_uses_taxonomy_not_partida_name():
    hints = [{
        "categoria": SUBSCRIPTION_CATEGORY,
        "nombre": "netflix",
        "empresa": "",
        "monto": 15.0,
        "es_ingreso": False,
    }]
    cat = infer_transaction_category("NETFLIX.COM", -15.99, hints, {})
    assert cat == SUBSCRIPTION_CATEGORY


def test_infer_rules_canonicalize():
    cat = infer_transaction_category("compra mercadona", -40, [], {"mercadona": "Suscripciones y facturas"})
    assert cat == SUBSCRIPTION_CATEGORY


def test_learnable_token_denylist():
    assert not is_learnable_token("compra")
    assert not is_learnable_token("bizum")
    assert is_learnable_token("mercadona")


def test_canonicalize_for_amount():
    assert canonicalize_for_amount("Alimentación", -10) == "Alimentación"
    assert canonicalize_for_amount("Nómina", 2000) == "Nómina"
    assert canonicalize_for_amount("Inventada", -10) == ""
