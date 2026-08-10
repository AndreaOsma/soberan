from app.routers.banks import (
    _gocardless_tx_description,
    _is_placeholder_description,
    _should_refresh_description,
)


def test_gocardless_description_from_remittance_and_creditor():
    tx = {
        "transactionAmount": {"amount": "-42.50"},
        "creditorName": "MERCADONA SA",
        "remittanceInformationUnstructured": "COMPRA TARJETA 1234",
    }
    desc = _gocardless_tx_description(tx)
    assert "MERCADONA" in desc
    assert "COMPRA" in desc


def test_gocardless_description_creditor_only():
    tx = {
        "transactionAmount": {"amount": "-10"},
        "creditorName": "NETFLIX",
    }
    assert _gocardless_tx_description(tx) == "NETFLIX"


def test_gocardless_description_income_uses_debtor():
    tx = {
        "transactionAmount": {"amount": "1500"},
        "debtorName": "EMPRESA SL",
        "remittanceInformationUnstructured": "NOMINA JULIO",
    }
    desc = _gocardless_tx_description(tx)
    assert "EMPRESA SL" in desc
    assert "NOMINA" in desc


def test_gocardless_description_joins_all_useful_fields():
    tx = {
        "transactionAmount": {"amount": "-19.99", "currency": "EUR"},
        "creditorName": "SPOTIFY AB",
        "ultimateCreditor": "SPOTIFY",
        "creditorAccount": {"iban": "ES9121000418450200051332"},
        "remittanceInformationUnstructuredArray": [
            "SUSCRIPCION PREMIUM",
            "REF 998877",
        ],
        "additionalInformation": "PAGO RECURRENTE",
        "proprietaryBankTransactionCode": "RECIBO SEPA",
        "merchantCategoryCode": "5815",
        "endToEndId": "E2E-SPOT-01",
        "entryReference": "ENT-55",
    }
    desc = _gocardless_tx_description(tx)
    assert "SPOTIFY" in desc
    assert "SUSCRIPCION PREMIUM" in desc
    assert "REF 998877" in desc
    assert "PAGO RECURRENTE" in desc
    assert "RECIBO SEPA" in desc
    assert "MCC 5815" in desc
    assert "E2E-SPOT-01" in desc
    assert "…1332" in desc


def test_gocardless_description_includes_non_eur_currency():
    tx = {
        "transactionAmount": {"amount": "-12.00", "currency": "USD"},
        "creditorName": "AMAZON",
        "currencyExchange": {
            "instructedAmount": {"amount": "12.00", "currency": "USD"},
        },
    }
    desc = _gocardless_tx_description(tx)
    assert "AMAZON" in desc
    assert "USD" in desc


def test_placeholder_detection():
    assert _is_placeholder_description("Importado GoCardless")
    assert _is_placeholder_description("importado")
    assert not _is_placeholder_description("Mercadona compra")


def test_should_refresh_description_when_richer():
    assert _should_refresh_description("Movimiento bancario", "MERCADONA — COMPRA")
    assert _should_refresh_description("COMPRA", "MERCADONA SA — COMPRA TARJETA")
    assert not _should_refresh_description("Mercadona semanal", "X")
    assert not _should_refresh_description("MERCADONA — COMPRA", "MERCADONA — COMPRA")
