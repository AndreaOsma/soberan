"""Unit tests for vehicle valuation (no network)."""
from datetime import datetime, timedelta

from app.vehicle_valuation import (
    ListingSample,
    VEHICLE_VALUATION_INTERVAL_DAYS,
    adaptive_ask_percentile,
    apply_haircut,
    ask_haircut,
    compute_market_valuation,
    confidence_for_samples,
    filter_iqr_outliers,
    km_price_cap,
    percentile_index,
    sanity_ceiling,
    soft_price_cap,
    title_matches_vehicle,
    url_slug,
    valuation_is_due,
)


def test_km_price_cap_bands():
    assert km_price_cap(None) == 60_000
    assert km_price_cap(50_000) == 60_000
    assert km_price_cap(80_000) == 25_000
    assert km_price_cap(120_000) == 16_000
    assert km_price_cap(160_000) == 9_000
    assert km_price_cap(220_000) == 6_000


def test_percentile_index_bounds():
    assert percentile_index(1, 0.5) == 0
    assert percentile_index(10, 0.0) == 0
    assert percentile_index(10, 1.0) == 9
    assert percentile_index(5, 0.5) == 2


def test_filter_iqr_removes_extreme_outliers():
    prices = [8000, 8200, 8300, 8400, 8500, 8600, 8700, 50_000]
    cleaned = filter_iqr_outliers(prices)
    assert 50_000 not in cleaned
    assert min(cleaned) >= 8000
    assert max(cleaned) <= 8700


def test_filter_iqr_keeps_small_samples():
    prices = [1000, 2000, 9000]
    assert filter_iqr_outliers(prices) == sorted(prices)


def test_soft_price_cap_uses_median_when_enough_samples():
    prices = [10_000] * 10
    assert soft_price_cap(60_000, prices) == 14_500  # 10000 * 1.45
    assert soft_price_cap(60_000, [10_000] * 3) == 60_000


def test_adaptive_ask_percentile_by_sample_km_ratio():
    assert adaptive_ask_percentile(150_000, [100_000] * 5, 2015) == 0.12
    assert adaptive_ask_percentile(100_000, [100_000] * 5, 2015) == 0.15
    assert adaptive_ask_percentile(70_000, [100_000] * 5, 2015) == 0.18


def test_adaptive_ask_percentile_falls_back_to_age_expected_km():
    assert adaptive_ask_percentile(220_000, [], 2016) == 0.12


def test_confidence_bands():
    assert confidence_for_samples(3) == "baja"
    assert confidence_for_samples(4) == "media"
    assert confidence_for_samples(8) == "alta"
    assert confidence_for_samples(15) == "alta"
    # Relaxed match: never alta, but large samples stay media (not forced baja)
    assert confidence_for_samples(20, strict_failed=True) == "media"
    assert confidence_for_samples(5, strict_failed=True) == "media"
    assert confidence_for_samples(2, strict_failed=True) == "baja"


def test_ask_haircut_env_clamped(monkeypatch):
    monkeypatch.delenv("VEHICLE_ASK_HAIRCUT", raising=False)
    assert ask_haircut() == 0.12
    monkeypatch.setenv("VEHICLE_ASK_HAIRCUT", "0.05")
    assert ask_haircut() == 0.08
    monkeypatch.setenv("VEHICLE_ASK_HAIRCUT", "0.50")
    assert ask_haircut() == 0.18
    monkeypatch.setenv("VEHICLE_ASK_HAIRCUT", "0.10")
    assert ask_haircut() == 0.10


def test_apply_haircut():
    assert apply_haircut(10_000, 0.12) == 8800.0
    assert apply_haircut(100, 0.12) == 500.0  # floor


def test_url_slug():
    assert url_slug("Peugeot") == "peugeot"
    assert url_slug("Citroën") == "citroen"
    assert url_slug("208") == "208"


def test_title_matches_strict_and_relaxed():
    assert title_matches_vehicle(
        "Seat León 1.6 TDI Style 2016", "SEAT", "Leon", strict=True
    )
    assert not title_matches_vehicle(
        "Volkswagen Golf GTI", "SEAT", "Leon", strict=True
    )
    assert title_matches_vehicle(
        "Seat Leon Style", "SEAT", "Leon FR", strict=False
    )
    assert not title_matches_vehicle("Leon TDI", "SEAT", "Leon", strict=True)


def test_sanity_ceiling_clamps_old_high_km():
    techo = sanity_ceiling(2010, 250_000)
    assert techo is not None
    assert techo < 15_000


def test_valuation_is_due_interval():
    now = datetime(2026, 7, 22, 12, 0, 0)
    assert valuation_is_due(None, now=now) is True
    assert valuation_is_due("", now=now) is True
    assert valuation_is_due("not-a-date", now=now) is True
    fresh = (now - timedelta(days=5)).isoformat()
    assert valuation_is_due(fresh, now=now) is False
    stale = (now - timedelta(days=VEHICLE_VALUATION_INTERVAL_DAYS)).isoformat()
    assert valuation_is_due(stale, now=now) is True
    older = (now - timedelta(days=45)).isoformat() + "Z"
    assert valuation_is_due(older, now=now) is True


def test_compute_market_applies_haircut_and_asking_band():
    samples = [
        ListingSample(price=p, km=100_000, title="Seat Leon", source="wallapop")
        for p in [9000, 9500, 10_000, 10_500, 11_000, 11_500, 12_000, 12_500, 13_000, 20_000]
    ]
    result = compute_market_valuation(
        samples,
        vehicle_km=140_000,
        vehicle_year=2016,
        hard_cap=60_000,
        fuente="wallapop",
        year_note=", año 2016 ±3",
        match_mode="strict",
        strict_failed=False,
        haircut=0.12,
    )
    assert result.fuente == "wallapop"
    assert result.muestras >= 5
    assert result.max < 20_000
    assert result.asking_p10 <= result.asking_p25 <= result.asking_p50
    expected_haircut = apply_haircut(result.asking_ref, 0.12)
    if result.clamped:
        assert result.clamp_techo is not None
        assert result.valor_mercado_realizable == round(result.clamp_techo, 2)
        assert result.valor_mercado_realizable <= expected_haircut
    else:
        assert result.valor_mercado_realizable == expected_haircut
    assert result.valor_estimado == result.valor_mercado_realizable
    assert result.percentil_usado == 12.0
    assert result.haircut == 0.12
    snap = result.as_dict()
    assert "asking_p10" in snap
    assert "nota" in snap


def test_compute_market_low_km_higher_percentile():
    samples = [
        ListingSample(price=p, km=80_000, source="wallapop")
        for p in [10_000, 10_500, 11_000, 11_500, 12_000, 12_500, 13_000, 13_500]
    ]
    result = compute_market_valuation(
        samples,
        vehicle_km=50_000,
        vehicle_year=2018,
        hard_cap=60_000,
        fuente="wallapop",
        year_note=", año 2018 ±3",
        match_mode="strict",
        strict_failed=False,
        haircut=0.12,
    )
    assert result.percentil_usado == 18.0
    assert result.valor_estimado < result.asking_ref
