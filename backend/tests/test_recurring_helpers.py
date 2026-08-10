"""Calendar / payroll helpers without database access."""
from app.main import recurring_company_from_nombre, norm_company_key


def test_recurring_company_from_nombre():
    assert recurring_company_from_nombre("Nómina Acme SL") == "Acme SL"
    assert recurring_company_from_nombre("nómina foo") == "foo"
    assert recurring_company_from_nombre("Alquiler") is None
    assert recurring_company_from_nombre("Nómina ") is None


def test_norm_company_key():
    assert norm_company_key("  Foo BAR ") == "foo bar"
    assert norm_company_key("") == ""
