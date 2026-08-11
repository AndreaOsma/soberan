from app.desktop_updates import (
    DEFAULT_RELEASE_PAGE,
    _safe_release_url,
    build_update_check,
    get_desktop_version,
    is_newer_version,
    version_tuple,
)


def test_version_tuple():
    assert version_tuple("0.1.45") == (0, 1, 45)
    assert version_tuple("v1.2.3") == (1, 2, 3)


def test_is_newer_version():
    assert is_newer_version("0.1.46", "0.1.45")
    assert not is_newer_version("0.1.45", "0.1.45")
    assert not is_newer_version("0.1.44", "0.1.45")
    assert is_newer_version("1.0.0", "0.9.99")


def test_safe_release_url_github():
    url = "https://api.github.com/repos/AndreaOsma/soberan/releases/tags/desktop-latest"
    assert _safe_release_url(url) == "https://github.com/AndreaOsma/soberan/releases/tag/desktop-latest"
    assert DEFAULT_RELEASE_PAGE.startswith("https://github.com/AndreaOsma/soberan/")


def test_safe_release_url_github_latest_default():
    # /releases/latest (default now, git-publish tags real versions, not a rolling
    # "desktop-latest" — GitHub's own "latest release" alias replaces that).
    url = "https://api.github.com/repos/AndreaOsma/soberan/releases/latest"
    assert _safe_release_url(url) == "https://github.com/AndreaOsma/soberan/releases/latest"


def test_build_update_check_disabled():
    result = build_update_check(check_enabled=False)
    assert result["check_enabled"] is False
    assert result["update_available"] is False


def test_build_update_check_with_mock_release(monkeypatch):
    monkeypatch.setenv("SOBERAN_APP_VERSION", "0.1.10")
    monkeypatch.setattr(
        "app.desktop_updates.fetch_latest_release",
        lambda **_: {
            "latest_version": "0.1.12",
            "download_url": "https://example.com/SoberanSetup-0.1.12.exe",
            "release_url": "https://example.com/releases",
            "release_name": "Test",
        },
    )
    result = build_update_check(check_enabled=True, force=True)
    assert result["update_available"] is True
    assert result["latest_version"] == "0.1.12"
    assert result["current_version"] == "0.1.10"


def test_get_desktop_version_from_env(monkeypatch):
    monkeypatch.setenv("SOBERAN_APP_VERSION", "2.3.4")
    assert get_desktop_version() == "2.3.4"
