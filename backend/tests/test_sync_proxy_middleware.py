"""Tests for dev/lib/native-sync/backend/sync_proxy_middleware.py's two middlewares:
SyncProxyMiddleware (client side — forwards to a connected private server, falls back
to local + queues writes when offline) and DeviceApiAuthMiddleware (server side — the
bare /device bypass a client's own requests land on, gated by SOBERAN_SYNC_SERVER_TOKEN).

Uses a minimal throwaway FastAPI app + in-memory sqlite instead of importing app.main,
since is_desktop_mode()/server_mode_enabled() are read at import time in main.py and
env vars can't retroactively reconfigure an already-built app within one test process.
"""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, Column, Integer, String, Text
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "lib" / "native-sync" / "backend"))
import sync_proxy_middleware as spm  # noqa: E402
from native_sync_router import create_sync_router  # noqa: E402

Base = declarative_base()


class FakePendingOp(Base):
    __tablename__ = "fake_pending_ops"
    id = Column(Integer, primary_key=True, autoincrement=True)
    method = Column(String, nullable=False)
    path = Column(String, nullable=False)
    body = Column(Text, nullable=True)


class FakeProxyCache(Base):
    __tablename__ = "fake_proxy_cache"
    id = Column(Integer, primary_key=True, autoincrement=True)
    cache_key = Column(String, nullable=False, unique=True)
    body = Column(Text, nullable=False)


@pytest.fixture
def session_factory():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)


class SettingsStore:
    """Tiny in-memory settings dict matching the get_setting(db, key, default) shape
    the real app's routers use, but without needing the real UserSettings model."""

    def __init__(self, **initial):
        self.values = dict(initial)

    def get(self, _db, key, default=""):
        return self.values.get(key, default)


def make_app(
    *,
    settings: SettingsStore,
    session_factory,
    reachability: spm.SyncReachability | None = None,
    cache_model=None,
):
    reachability = reachability or spm.SyncReachability()
    middleware = spm.create_sync_proxy_middleware(
        session_factory=session_factory,
        get_setting=settings.get,
        pending_op_model=FakePendingOp,
        reachability=reachability,
        cache_model=cache_model,
    )
    app = FastAPI()
    app.add_middleware(middleware)

    @app.get("/accounts")
    def local_accounts_get():
        return {"source": "local", "accounts": []}

    @app.post("/accounts")
    def local_accounts_post():
        return {"source": "local", "created": True}

    @app.get("/sync/status")
    def local_sync_status():
        return {"enabled": True}

    @app.get("/settings/")
    def local_settings_get(keys: str | None = None):
        wanted = [k.strip() for k in (keys or "").split(",") if k.strip()]
        return {k: settings.values.get(k, "") for k in wanted}

    @app.post("/settings/")
    def local_settings_post(payload: dict):
        settings.values[payload["key"]] = payload["value"]
        return {"status": "ok", "source": "local"}

    @app.get("/settings/{key}")
    def local_settings_get_one(key: str):
        return {"value": settings.values.get(key), "source": "local"}

    return app, reachability


def test_blocked_prefix_never_proxied_even_when_configured(session_factory):
    settings = SettingsStore(sync_provider="custom_server", sync_custom_url="https://remote.example.com")
    app, reachability = make_app(settings=settings, session_factory=session_factory)
    reachability.reachable = True
    client = TestClient(app)

    resp = client.get("/sync/status")
    assert resp.status_code == 200
    assert resp.json() == {"enabled": True}


def test_no_custom_server_configured_falls_through_to_local(session_factory):
    settings = SettingsStore(sync_provider="google_drive")
    app, _ = make_app(settings=settings, session_factory=session_factory)
    client = TestClient(app)

    resp = client.get("/accounts")
    assert resp.status_code == 200
    assert resp.json()["source"] == "local"


def test_unreachable_server_falls_back_local_and_queues_write(session_factory):
    settings = SettingsStore(sync_provider="custom_server", sync_custom_url="https://remote.example.com")
    app, reachability = make_app(settings=settings, session_factory=session_factory)
    reachability.reachable = False
    client = TestClient(app)

    resp = client.post("/accounts", json={"alias_real": "Cuenta X"})
    assert resp.status_code == 200
    assert resp.json()["source"] == "local"

    db = session_factory()
    try:
        ops = db.query(FakePendingOp).all()
        assert len(ops) == 1
        assert ops[0].method == "POST"
        assert ops[0].path == "/accounts"
        assert "Cuenta X" in ops[0].body
    finally:
        db.close()


def test_reachable_server_proxies_and_does_not_hit_local(monkeypatch, session_factory):
    settings = SettingsStore(sync_provider="custom_server", sync_custom_url="https://remote.example.com")
    app, reachability = make_app(settings=settings, session_factory=session_factory)
    reachability.reachable = True
    client = TestClient(app)

    calls = []

    def fake_request(method, url, headers=None, data=None, timeout=None):
        calls.append((method, url, headers, data))
        return SimpleNamespace(
            content=b'{"source": "remote"}',
            status_code=200,
            headers={"content-type": "application/json"},
        )

    monkeypatch.setattr(spm.requests, "request", fake_request)

    resp = client.get("/accounts")
    assert resp.status_code == 200
    assert resp.json() == {"source": "remote"}
    assert len(calls) == 1
    method, url, _headers, _data = calls[0]
    assert method == "GET"
    assert url == "https://remote.example.com/device/accounts"


def test_proxied_response_carries_cors_headers(monkeypatch, session_factory):
    """Regression test: SyncProxyMiddleware is registered *outer* relative to
    CORSMiddleware (see app/main.py) so it can see the already-un-prefixed path
    ApiPrefixMiddleware produces — every response it returns directly, without calling
    call_next(), therefore never reaches CORSMiddleware at all. The WebView's fetch()
    still got its 200 with no JS-visible error, but without Access-Control-Allow-Origin
    the browser silently discarded the response body before application code ever saw
    it — every proxied request "succeeded" and every screen stayed empty. Found by
    reasoning through the real middleware order after device logs showed healthy 200s
    with zero errors on both sides, yet no data ever rendered."""
    settings = SettingsStore(sync_provider="custom_server", sync_custom_url="https://remote.example.com")
    app, reachability = make_app(settings=settings, session_factory=session_factory)
    reachability.reachable = True
    client = TestClient(app)

    monkeypatch.setattr(
        spm.requests, "request",
        lambda *a, **k: SimpleNamespace(content=b'{"source": "remote"}', status_code=200, headers={"content-type": "application/json"}),
    )

    resp = client.get("/accounts", headers={"Origin": "capacitor://localhost"})
    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == "capacitor://localhost"
    assert resp.headers["access-control-allow-credentials"] == "true"


def test_successful_proxy_get_writes_through_to_cache(monkeypatch, session_factory):
    settings = SettingsStore(sync_provider="custom_server", sync_custom_url="https://remote.example.com")
    app, reachability = make_app(settings=settings, session_factory=session_factory, cache_model=FakeProxyCache)
    reachability.reachable = True
    client = TestClient(app)

    monkeypatch.setattr(
        spm.requests, "request",
        lambda *a, **k: SimpleNamespace(content=b'{"source": "remote"}', status_code=200, headers={"content-type": "application/json"}),
    )

    resp = client.get("/accounts")
    assert resp.status_code == 200

    db = session_factory()
    try:
        row = db.query(FakeProxyCache).filter(FakeProxyCache.cache_key == "/accounts").first()
        assert row is not None
        assert row.body == '{"source": "remote"}'
    finally:
        db.close()


def test_unreachable_get_serves_cached_response_not_empty_local(monkeypatch, session_factory):
    """Regression test: in pure-proxy mode the local tables are permanently empty (data
    lives on the server, never persisted locally) — falling back to call_next() while
    offline used to mean an empty screen instead of the last known-good data."""
    settings = SettingsStore(sync_provider="custom_server", sync_custom_url="https://remote.example.com")
    db = session_factory()
    db.add(FakeProxyCache(cache_key="/accounts", body='{"source": "cached"}'))
    db.commit()
    db.close()

    app, reachability = make_app(settings=settings, session_factory=session_factory, cache_model=FakeProxyCache)
    reachability.reachable = False
    client = TestClient(app)

    resp = client.get("/accounts")
    assert resp.status_code == 200
    assert resp.json() == {"source": "cached"}


def test_unreachable_get_with_no_cache_falls_back_to_local(session_factory):
    settings = SettingsStore(sync_provider="custom_server", sync_custom_url="https://remote.example.com")
    app, reachability = make_app(settings=settings, session_factory=session_factory, cache_model=FakeProxyCache)
    reachability.reachable = False
    client = TestClient(app)

    resp = client.get("/accounts")
    assert resp.status_code == 200
    assert resp.json()["source"] == "local"


def test_cors_preflight_never_proxied_even_when_reachable(monkeypatch, session_factory):
    """Regression test: proxying an OPTIONS preflight leaks the remote server's CORS
    policy (which only allows its own browser-facing origin) back as if it were the
    local server's decision, 400-ing every subsequent real request behind it — CORS
    preflight is a WebView<->local-server negotiation, it must never reach the remote
    at all. Found via a real device log full of "OPTIONS ... 400 Bad Request" loops."""
    settings = SettingsStore(sync_provider="custom_server", sync_custom_url="https://remote.example.com")
    app, reachability = make_app(settings=settings, session_factory=session_factory)
    reachability.reachable = True
    client = TestClient(app)

    calls = []
    monkeypatch.setattr(
        spm.requests, "request",
        lambda *a, **k: calls.append((a, k)) or SimpleNamespace(content=b"", status_code=200, headers={}),
    )

    client.options("/accounts", headers={"Origin": "capacitor://localhost", "Access-Control-Request-Method": "GET"})
    assert calls == [], "OPTIONS preflight must be answered locally, never proxied to the remote server"


def test_reachable_server_write_forwarded_not_queued(monkeypatch, session_factory):
    settings = SettingsStore(sync_provider="custom_server", sync_custom_url="https://remote.example.com")
    app, reachability = make_app(settings=settings, session_factory=session_factory)
    reachability.reachable = True
    client = TestClient(app)

    monkeypatch.setattr(
        spm.requests, "request",
        lambda *a, **k: SimpleNamespace(content=b'{"ok": true}', status_code=200, headers={}),
    )

    resp = client.post("/accounts", json={"alias_real": "Cuenta Y"})
    assert resp.status_code == 200

    db = session_factory()
    try:
        assert db.query(FakePendingOp).count() == 0
    finally:
        db.close()


def test_remote_error_mid_request_falls_back_and_marks_unreachable(monkeypatch, session_factory):
    import requests as real_requests

    settings = SettingsStore(sync_provider="custom_server", sync_custom_url="https://remote.example.com")
    app, reachability = make_app(settings=settings, session_factory=session_factory)
    reachability.reachable = True
    client = TestClient(app)

    def raise_conn_error(*a, **k):
        raise real_requests.ConnectionError("boom")

    monkeypatch.setattr(spm.requests, "request", raise_conn_error)

    resp = client.post("/accounts", json={"alias_real": "Cuenta Z"})
    assert resp.status_code == 200
    assert resp.json()["source"] == "local"
    assert reachability.reachable is False

    db = session_factory()
    try:
        assert db.query(FakePendingOp).count() == 1
    finally:
        db.close()


def test_reachability_ensure_checked_resolves_unknown_state_inline():
    """Regression test: a cold app start fires its whole first page load within
    milliseconds of the WebView connecting, well before the background ping task's
    first tick can complete — reachable used to default to False, so every cold start
    silently served stale local data even on a healthy connection. reachable now starts
    as None ("never checked") and ensure_checked() resolves it inline for whichever
    request is first."""
    import asyncio

    reachability = spm.SyncReachability()
    assert reachability.reachable is None

    async def scenario():
        reachability.start(lambda: True, interval=999)
        result = await reachability.ensure_checked()
        reachability.stop()
        return result

    assert asyncio.run(scenario()) is True
    assert reachability.reachable is True


def test_reachability_ensure_checked_fires_on_reconnect_once():
    """Regression test: ensure_checked() used to set reachable=True without ever calling
    on_reconnect, silently dropping the replay-pending-ops + full-bundle-pull step for
    whatever request happens to resolve the very first reachability check (the common
    case, since it usually wins the race against the slower periodic loop)."""
    import asyncio

    reachability = spm.SyncReachability()
    reconnects = []

    async def on_reconnect():
        reconnects.append(1)

    async def scenario():
        reachability.start(lambda: True, interval=999, on_reconnect=on_reconnect)
        await reachability.ensure_checked()
        await reachability.ensure_checked()  # second call must not fire it again
        reachability.stop()

    asyncio.run(scenario())
    assert reconnects == [1]


def test_reachable_unknown_state_resolved_inline_not_treated_as_unreachable(monkeypatch, session_factory):
    settings = SettingsStore(sync_provider="custom_server", sync_custom_url="https://remote.example.com")
    reachability = spm.SyncReachability()
    reachability._check = lambda: True  # same seam .start() wires up, without needing a running loop in this sync test
    app, reachability = make_app(settings=settings, session_factory=session_factory, reachability=reachability)
    assert reachability.reachable is None
    client = TestClient(app)

    monkeypatch.setattr(
        spm.requests, "request",
        lambda *a, **k: SimpleNamespace(content=b'{"source": "remote"}', status_code=200, headers={"content-type": "application/json"}),
    )

    resp = client.get("/accounts")
    assert resp.json() == {"source": "remote"}
    assert reachability.reachable is True


def test_settings_batch_get_proxies_general_keys_keeps_sync_keys_local(monkeypatch, session_factory):
    """Regression test: /settings/ used to be entirely blocked from proxying, so theme
    and every other general setting could never sync from a connected server. Now only
    the handful of keys describing the device's own connection (sync_custom_url etc.)
    stay local; everything else proxies live in the same request."""
    settings = SettingsStore(
        sync_provider="custom_server",
        sync_custom_url="https://remote.example.com",
    )
    app, reachability = make_app(settings=settings, session_factory=session_factory)
    reachability.reachable = True
    client = TestClient(app)

    calls = []

    def fake_request(method, url, headers=None, data=None, timeout=None):
        calls.append((method, url))
        return SimpleNamespace(
            ok=True,
            content=b'{"theme_accent": "#b92d5d", "theme_name": "Soberan Blue"}',
            status_code=200,
            headers={"content-type": "application/json"},
        )

    monkeypatch.setattr(spm.requests, "request", fake_request)

    resp = client.get("/settings/?keys=theme_accent,theme_name,sync_custom_url")
    assert resp.status_code == 200
    body = resp.json()
    assert body["theme_accent"] == "#b92d5d"
    assert body["theme_name"] == "Soberan Blue"
    assert body["sync_custom_url"] == "https://remote.example.com"  # local, not proxied
    assert len(calls) == 1
    assert "keys=theme_accent,theme_name" in calls[0][1]
    assert "sync_custom_url" not in calls[0][1]


def test_settings_batch_get_all_local_keys_makes_no_remote_call(monkeypatch, session_factory):
    settings = SettingsStore(
        sync_provider="custom_server",
        sync_custom_url="https://remote.example.com",
    )
    app, reachability = make_app(settings=settings, session_factory=session_factory)
    reachability.reachable = True
    client = TestClient(app)

    calls = []
    monkeypatch.setattr(spm.requests, "request", lambda *a, **k: calls.append(1))

    resp = client.get("/settings/?keys=sync_custom_url,sync_provider")
    assert resp.status_code == 200
    assert resp.json() == {"sync_custom_url": "https://remote.example.com", "sync_provider": "custom_server"}
    assert calls == []


def test_settings_post_with_device_local_key_never_proxied(monkeypatch, session_factory):
    settings = SettingsStore(sync_provider="custom_server", sync_custom_url="https://remote.example.com")
    app, reachability = make_app(settings=settings, session_factory=session_factory)
    reachability.reachable = True
    client = TestClient(app)

    calls = []
    monkeypatch.setattr(spm.requests, "request", lambda *a, **k: calls.append(1))

    resp = client.post("/settings/", json={"key": "sync_custom_url", "value": "https://other.example.com"})
    assert resp.status_code == 200
    assert resp.json()["source"] == "local"
    assert calls == []


def test_settings_single_key_get_device_local_key_never_proxied(monkeypatch, session_factory):
    settings = SettingsStore(sync_provider="custom_server", sync_custom_url="https://remote.example.com")
    app, reachability = make_app(settings=settings, session_factory=session_factory)
    reachability.reachable = True
    client = TestClient(app)

    calls = []
    monkeypatch.setattr(spm.requests, "request", lambda *a, **k: calls.append(1))

    resp = client.get("/settings/sync_custom_url")
    assert resp.status_code == 200
    assert resp.json()["source"] == "local"
    assert calls == []


def test_settings_single_key_get_general_key_proxies(monkeypatch, session_factory):
    settings = SettingsStore(sync_provider="custom_server", sync_custom_url="https://remote.example.com")
    app, reachability = make_app(settings=settings, session_factory=session_factory)
    reachability.reachable = True
    client = TestClient(app)

    monkeypatch.setattr(
        spm.requests, "request",
        lambda *a, **k: SimpleNamespace(content=b'{"value": "#b92d5d", "source": "remote"}', status_code=200, headers={}),
    )

    resp = client.get("/settings/theme_accent")
    assert resp.json()["source"] == "remote"


# --- DeviceApiAuthMiddleware -------------------------------------------------------

def make_device_api_app(*, env: dict, monkeypatch):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    middleware = spm.create_device_api_middleware(app_slug="testapp")
    app = FastAPI()
    app.add_middleware(middleware)

    @app.get("/accounts")
    def accounts():
        return {"ok": True}

    return app


def test_device_api_untouched_outside_prefix(monkeypatch):
    app = make_device_api_app(env={}, monkeypatch=monkeypatch)
    client = TestClient(app)
    resp = client.get("/accounts")
    assert resp.status_code == 200


def test_device_api_404_when_server_mode_disabled(monkeypatch):
    app = make_device_api_app(env={}, monkeypatch=monkeypatch)
    client = TestClient(app)
    resp = client.get("/device/accounts")
    assert resp.status_code == 404


def test_device_api_open_when_server_mode_on_and_no_token(monkeypatch):
    app = make_device_api_app(env={"TESTAPP_SYNC_SERVER_MODE": "1"}, monkeypatch=monkeypatch)
    client = TestClient(app)
    resp = client.get("/device/accounts")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_device_api_401_wrong_token(monkeypatch):
    app = make_device_api_app(
        env={"TESTAPP_SYNC_SERVER_MODE": "1", "TESTAPP_SYNC_SERVER_TOKEN": "correct-token"},
        monkeypatch=monkeypatch,
    )
    client = TestClient(app)
    resp = client.get("/device/accounts", headers={"Authorization": "Bearer wrong-token"})
    assert resp.status_code == 401


def test_device_api_ok_with_correct_token(monkeypatch):
    app = make_device_api_app(
        env={"TESTAPP_SYNC_SERVER_MODE": "1", "TESTAPP_SYNC_SERVER_TOKEN": "correct-token"},
        monkeypatch=monkeypatch,
    )
    client = TestClient(app)
    resp = client.get("/device/accounts", headers={"Authorization": "Bearer correct-token"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


# --- replay_pending_ops -------------------------------------------------------------

def test_replay_pending_ops_replays_in_order_then_pulls(monkeypatch, session_factory):
    settings = SettingsStore(sync_custom_url="https://remote.example.com", sync_custom_token="tok")
    db = session_factory()
    db.add(FakePendingOp(method="POST", path="/accounts", body='{"a": 1}'))
    db.add(FakePendingOp(method="PATCH", path="/accounts/1", body='{"b": 2}'))
    db.commit()
    db.close()

    calls = []

    def fake_request(method, url, headers=None, data=None, timeout=None):
        calls.append((method, url))
        return SimpleNamespace(ok=True, content=b"", status_code=200, headers={})

    def fake_get(url, headers=None, timeout=None):
        calls.append(("GET", url))
        return SimpleNamespace(ok=True, content=b"zip-bytes", status_code=200, headers={})

    monkeypatch.setattr(spm.requests, "request", fake_request)
    monkeypatch.setattr(spm.requests, "get", fake_get)

    pulled = {}

    def fake_import_bundle_replace(_db, payload):
        pulled["payload"] = payload
        return {"accounts": 3, "transactions": 5}

    import asyncio

    result = asyncio.run(spm.replay_pending_ops(
        session_factory=session_factory,
        get_setting=settings.get,
        pending_op_model=FakePendingOp,
        import_bundle_replace=fake_import_bundle_replace,
    ))

    assert result == {"replayed": 2, "pulled_tables": 2}
    assert pulled["payload"] == b"zip-bytes"
    assert calls[0] == ("POST", "https://remote.example.com/device/accounts")
    assert calls[1] == ("PATCH", "https://remote.example.com/device/accounts/1")
    assert calls[2] == ("GET", "https://remote.example.com/sync/server/pull")

    db = session_factory()
    try:
        assert db.query(FakePendingOp).count() == 0
    finally:
        db.close()


# --- /sync/status reachability + pending-ops fields --------------------------------

def test_sync_status_reports_reachability_and_pending_count(session_factory):
    def get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    router = create_sync_router(
        app_slug="testapp",
        is_desktop_mode=lambda: True,
        desktop_data_dir=lambda: Path("/tmp"),
        get_db=get_db,
        get_setting=lambda db, key, default="": default,
        set_setting=lambda db, key, value: None,
        export_bundle_bytes=lambda db: b"",
        import_bundle_replace=lambda db, payload: {},
        is_reachable=lambda: True,
        get_pending_count=lambda db: 3,
    )
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    resp = client.get("/sync/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is True
    assert body["custom_server_reachable"] is True
    assert body["pending_ops"] == 3


def test_sync_status_omits_new_fields_when_not_wired(session_factory):
    def get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    router = create_sync_router(
        app_slug="testapp2",
        is_desktop_mode=lambda: True,
        desktop_data_dir=lambda: Path("/tmp"),
        get_db=get_db,
        get_setting=lambda db, key, default="": default,
        set_setting=lambda db, key, value: None,
        export_bundle_bytes=lambda db: b"",
        import_bundle_replace=lambda db, payload: {},
    )
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    resp = client.get("/sync/status")
    assert resp.status_code == 200
    body = resp.json()
    assert "custom_server_reachable" not in body
    assert "pending_ops" not in body
