"""Solo cuenta como ingreso del presupuesto lo ganado: traspasos entre cuentas y Bizum no (2026-10-29)."""
from types import SimpleNamespace

from app.transaction_splits import counts_as_income


def tx(amount, cat, **kw):
    return SimpleNamespace(amount=amount, category_anon=cat, es_interna=kw.get("interna", False), es_pending=False, excluida_presupuesto=False)


def test_earned_income_counts():
    assert counts_as_income(tx(1800, "Nómina"))
    assert counts_as_income(tx(20, "otros ingresos"))


def test_transfers_bizum_and_refunds_do_not():
    assert not counts_as_income(tx(15, ""))
    assert not counts_as_income(tx(15, None))
    assert not counts_as_income(tx(500, "Transferencia recibida"))
    assert not counts_as_income(tx(30, "Devolución"))
    assert not counts_as_income(tx(1800, "Nómina", interna=True))
    assert not counts_as_income(tx(-50, "Nómina"))
