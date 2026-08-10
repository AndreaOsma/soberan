"""Tests for Modelo 145 / AEAT 2026 withholding calculator."""
from app.irpf_retencion import calculate_retencion, Dependent


def test_example_30000_soltero_sin_hijos():
    # Reference case ~16.42% (30k, 35y, situación 3, indefinido, 12 pagas).
    r = calculate_retencion(
        annual_gross=30_000.0,
        age=35,
        family_situation="3",
        contract_type="indefinido",
        pagas=12,
    )
    assert abs(r["irpf_pct"] - 16.42) < 0.15
    assert r["neto_estimado"] > 0
    assert r["ss_pct"] == 6.5


def test_low_salary_zero_retention():
    r = calculate_retencion(
        annual_gross=12_000.0,
        age=30,
        family_situation="3",
        pagas=12,
    )
    assert r["irpf_pct"] == 0.0


def test_kids_lower_rate():
    solo = calculate_retencion(annual_gross=35_000.0, age=40, family_situation="3", pagas=14)
    with_kids = calculate_retencion(
        annual_gross=35_000.0,
        age=40,
        family_situation="3",
        pagas=14,
        dependents=[
            Dependent(kind="descendant", age=5),
            Dependent(kind="descendant", age=2),
        ],
    )
    assert with_kids["irpf_pct"] <= solo["irpf_pct"]
    assert with_kids["family_minimum"] > solo["family_minimum"]


def test_temporal_minimum_two_percent():
    r = calculate_retencion(
        annual_gross=28_000.0,
        age=28,
        family_situation="3",
        contract_type="temporal",
        pagas=12,
    )
    if r["irpf_pct"] > 0:
        assert r["irpf_pct"] >= 2.0


def test_especial_minimum_fifteen():
    r = calculate_retencion(
        annual_gross=40_000.0,
        age=30,
        family_situation="3",
        contract_type="especial",
        pagas=12,
    )
    assert r["irpf_pct"] >= 15.0
