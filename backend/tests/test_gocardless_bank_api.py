"""Tests for GoCardless API client resilience."""
from unittest.mock import patch

import pytest
import requests
from requests.exceptions import ConnectionError

from app.gocardless_bank_api import format_gocardless_error, _request_with_retry


def test_format_gocardless_error_dns():
    err = ConnectionError(
        "HTTPSConnectionPool(host='bankaccountdata.gocardless.com', port=443): "
        "Max retries exceeded (Caused by NameResolutionError(...))"
    )
    msg = format_gocardless_error(err)
    assert "bankaccountdata.gocardless.com" in msg
    assert "DNS" in msg


def test_request_with_retry_recovers_from_transient_dns():
    ok = requests.Response()
    ok.status_code = 200
    ok._content = b"{}"

    calls = 0

    def fake_request(method, url, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ConnectionError("Temporary failure in name resolution")
        return ok

    with patch("app.gocardless_bank_api.requests.request", side_effect=fake_request):
        with patch("app.gocardless_bank_api.time.sleep"):
            resp = _request_with_retry("GET", "https://example.com", timeout=1)

    assert resp.status_code == 200
    assert calls == 2


def test_format_gocardless_error_rate_limit():
    msg = format_gocardless_error(Exception("429 Client Error: Too Many Requests for url: https://x"))
    assert "limitado" in msg.lower() or "GoCardless" in msg


def test_request_retries_on_429():
    from app.gocardless_bank_api import GoCardlessBankAPI

    limited = requests.Response()
    limited.status_code = 429
    limited.headers["Retry-After"] = "1"
    limited._content = b'{"detail":"rate"}'

    ok = requests.Response()
    ok.status_code = 200
    ok._content = b'{"access":"tok"}'

    calls = {"n": 0}

    def fake_request(method, url, **kwargs):
        calls["n"] += 1
        if "token" in url:
            return ok
        if calls["n"] < 4:
            return limited
        ok2 = requests.Response()
        ok2.status_code = 200
        ok2._content = b'{"transactions":{}}'
        return ok2

    client = GoCardlessBankAPI("id", "key")
    with patch("app.gocardless_bank_api.requests.request", side_effect=fake_request):
        with patch("app.gocardless_bank_api.time.sleep"):
            data = client.get_account_transactions("acc-1")
    assert "transactions" in data
    assert calls["n"] >= 3
