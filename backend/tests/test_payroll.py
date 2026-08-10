"""Unit tests for payroll / income tax (IRPF) without a database."""
import pytest

from app.main import annual_irpf_quota_2026, estimate_payroll


def test_irpf_zero_base():
    assert annual_irpf_quota_2026(0.0) == 0.0


def test_irpf_first_bracket():
    # 12_450 * 0.19 = 2_365.50
    assert abs(annual_irpf_quota_2026(12450.0) - 2365.50) < 0.02


def test_irpf_crosses_second_bracket():
    # 20_000: first 12_450 @ 19%, next 7_550 @ 24%
    expected = 12450 * 0.19 + (20000 - 12450) * 0.24
    assert abs(annual_irpf_quota_2026(20000.0) - expected) < 0.02


def test_estimate_payroll_net_order():
    r = estimate_payroll(
        bruto_mensual=3000.0,
        pagas=12,
        ss_pct=6.5,
        contract_type="indefinido",
        personal_minimum=5550.0,
        work_expense=2000.0,
    )
    assert r["neto_estimado"] >= 0
    assert r["bruto_mensual"] == 3000.0
    assert r["pagas"] == 12
    assert r["ss_amount"] > 0
    assert r["irpf_amount"] >= 0


def test_estimate_payroll_manual_irpf():
    r = estimate_payroll(
        bruto_mensual=2000.0,
        pagas=14,
        irpf_pct_override=15.0,
    )
    assert abs(r["irpf_pct"] - 15.0) < 0.01
    assert r["neto_estimado"] <= 2000.0
