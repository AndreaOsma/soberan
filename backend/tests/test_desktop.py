"""Tests for desktop API path rewriting and environment."""
import os

import pytest

from app.desktop import configure_desktop_environment, is_desktop_mode, rewrite_api_path


def test_rewrite_api_path_strips_prefix_for_crud():
    assert rewrite_api_path("/api/accounts/") == "/accounts/"
    assert rewrite_api_path("/api/settings/theme_name") == "/settings/theme_name"


def test_rewrite_api_path_keeps_native_api_routes():
    assert rewrite_api_path("/api/chat/status") == "/api/chat/status"
    assert rewrite_api_path("/api/alertas") == "/api/alertas"


def test_rewrite_api_path_double_api_for_alertas():
    assert rewrite_api_path("/api/api/alertas") == "/api/alertas"
    assert rewrite_api_path("/api/api/sankey/7/2026") == "/api/sankey/7/2026"


def test_configure_desktop_environment_sets_sqlite(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SOBERAN_DESKTOP", raising=False)

    info = configure_desktop_environment(static_dir=None, port=17891)

    assert is_desktop_mode()
    assert os.environ["DATABASE_URL"].startswith("sqlite:///")
    assert info["port"] == "17891"
    assert (tmp_path / "Soberan" / "data").is_dir()
