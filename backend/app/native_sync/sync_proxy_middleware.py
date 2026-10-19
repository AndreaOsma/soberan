# GENERADO desde dev/lib/native-sync (Homelab): no lo edites aquí, edita la librería y ejecuta su sync.mjs
"""Proxy-with-offline-cache middleware for native sync: when connected to a private
sync server, that server becomes the source of truth and every request is forwarded
to it live; the local SQLite-backed routers only handle a request when the remote is
unreachable, keeping the app usable offline.

Mirrors the DI pattern in native_sync_router.py (settings/DB are injected, this module
has no knowledge of any particular app's models beyond the pending-op table it's given)
and the middleware pattern in Soberan's own app/desktop.py (ApiPrefixMiddleware).

Single-user design: no per-row conflict resolution. A write that can't reach the
server still applies locally (the UI responds instantly) and is queued in
pending_op_model; on reconnect the queue replays in order, then the caller is expected
to do a full bundle pull (import_bundle_replace) to reconcile — see AGENTS.md.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable, Iterable, Optional

import requests
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from sqlalchemy.orm import Session

from .native_sync_router import server_auth_ok, server_mode_enabled

logger = logging.getLogger("native_sync.proxy")

# Never proxied: device-local secrets/config (open-banking tokens, the sync action
# endpoints themselves — proxying /sync/* would ask the remote server about how to reach
# itself), and local-network-only integrations (Ollama) that don't make sense against a
# remote host. Includes both the plain and "/api/"-prefixed forms of agent/chat: Soberan's
# own ApiPrefixMiddleware (app/desktop.py, NATIVE_API_PREFIXES) deliberately leaves those
# two with their /api/ prefix intact even in desktop/native mode, unlike every other
# route — this middleware has to match whichever shape it actually receives.
#
# /settings/ is deliberately NOT here: general settings (theme, appearance, everything
# else) are meant to sync live from the connected server just like any other data — see
# _DEVICE_LOCAL_SETTINGS_KEYS below for the handful of keys that stay device-local instead
# of the whole path being blocked.
DEFAULT_BLOCKED_PREFIXES = (
    "/sync/",
    "/banks/",
    "/agent/",
    "/api/agent/",
    "/chat/",
    "/api/chat/",
    "/desktop/",
    # This device deciding "am I the hosted instance, or do I forward to it"
    # (soberan's app/feedback.py) is itself a device-local operation, not app
    # data — proxying it to whatever server the user happens to be synced to
    # would mean an unnecessary extra hop (that server just forwards again
    # to Andrea's instance anyway, since it has no secrets either) at best,
    # or silently going nowhere useful if that server predates this feature.
    "/feedback",
)

# These settings keys describe *this device's own connection to a server*, not app data —
# proxying them would mean either asking the remote what ITS OWN sync_custom_url is (which
# is empty/meaningless on the receiving end, and would blank out the device's Settings
# screen for a connection that is demonstrably working) or, on write, telling the remote to
# repoint its own sync config at whatever this device just typed in. Kept local always;
# every other settings key proxies normally like any other data.
_DEVICE_LOCAL_SETTINGS_KEYS = frozenset({"sync_custom_url", "sync_provider", "sync_custom_token"})

# Bare prefix (no /api) matching the convention set by /sync/server/* — a reverse proxy
# in front of the remote (Traefik, nginx...) can bypass any browser-SSO gate for this
# one prefix without opening the rest of the app, since every request under it still
# needs a valid Authorization: Bearer {ENV_PREFIX}_SYNC_SERVER_TOKEN (server_auth_ok,
# same check /sync/server/* already uses) — see create_device_api_middleware below.
DEVICE_API_PREFIX = "/device"

_WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")
_HOP_BY_HOP_REQUEST_HEADERS = {"host", "content-length", "connection"}
_HOP_BY_HOP_RESPONSE_HEADERS = {"content-encoding", "transfer-encoding", "connection", "content-length"}


class SyncReachability:
    """In-memory cached reachability flag, refreshed by a background asyncio task.

    Deliberately asyncio.create_task(), not threading.Thread — a thread's target never
    actually runs under this app's embedded-iOS CPython build (see AGENTS.md), a
    constraint discovered the hard way elsewhere in this codebase. The same applies to
    asyncio.to_thread() (it schedules onto a ThreadPoolExecutor worker thread under the
    hood) — a previous version of this class awaited the reachability check through it,
    which meant the check's body never actually ran on a real device: no exception, no
    result, the awaited future just never resolved, silently hanging whichever request
    called ensure_checked() and permanently stuck reachable at None. check() below is
    called directly instead — it blocks the event loop for one request's duration, worse
    for concurrency than a real thread pool would be, but it actually executes.

    `reachable` starts as None ("never checked yet"), not False — a cold app start fires
    its whole first page load (accounts, transactions, ...) within milliseconds of the
    WebView connecting, well before the background task's first ping to the remote server
    can possibly complete. Treating "unknown" the same as "unreachable" made every single
    cold start silently serve stale local data even on a perfectly healthy connection —
    see ensure_checked(), which the middleware calls to resolve that first request inline
    instead of assuming the worst.
    """

    def __init__(self) -> None:
        self.reachable: Optional[bool] = None
        self._task: Optional[asyncio.Task] = None
        self._check: Optional[Callable[[], bool]] = None
        self._on_reconnect: Optional[Callable[[], "asyncio.Future"]] = None
        self._lock = asyncio.Lock()

    def start(
        self,
        check: Callable[[], bool],
        interval: float = 12.0,
        on_reconnect: Optional[Callable[[], "asyncio.Future"]] = None,
    ) -> None:
        """`on_reconnect` (if given) fires once per non-True→True transition — the signal
        to replay the pending-op queue and pull a fresh bundle, see replay_pending_ops.
        The loop below sleeps *before* its first check, not after: ensure_checked()
        already resolves the very first request inline, so an immediate first tick here
        would just race it for a redundant network call — this loop is steady-state
        refresh only."""
        if self._task is not None:
            return
        self._check = check
        self._on_reconnect = on_reconnect

        async def _loop() -> None:
            while True:
                await asyncio.sleep(interval)
                was_reachable = self.reachable
                try:
                    self.reachable = check()
                except Exception:
                    self.reachable = False
                if self.reachable and not was_reachable and on_reconnect is not None:
                    try:
                        await on_reconnect()
                    except Exception:
                        logger.exception("Sync proxy: on_reconnect callback failed")

        self._task = asyncio.create_task(_loop())

    async def ensure_checked(self) -> bool:
        """Resolves the "never checked yet" state inline, for whichever request happens
        to be first — the periodic loop above only handles steady-state refresh after
        this. The lock collapses concurrent first-requests (a cold start fires a dozen at
        once) into one actual network call instead of one per request. Also fires
        on_reconnect on a None->True resolution, same as the loop does for False->True —
        this is a real reconnect (the very first one), not just a status read, and skipping
        it here silently drops replaying any writes queued before this device ever
        confirmed reachability."""
        if self.reachable is not None or self._check is None:
            return bool(self.reachable)
        async with self._lock:
            if self.reachable is None:
                was_reachable = self.reachable
                try:
                    self.reachable = self._check()
                except Exception:
                    self.reachable = False
                if self.reachable and not was_reachable and self._on_reconnect is not None:
                    try:
                        await self._on_reconnect()
                    except Exception:
                        logger.exception("Sync proxy: on_reconnect callback failed")
        return bool(self.reachable)

    def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None


def make_reachability_check(
    *,
    session_factory: Callable[[], Session],
    get_setting: Callable[[Session, str, str], str],
    timeout: float = 2.5,
) -> Callable[[], bool]:
    """Builds the ping function passed to SyncReachability.start()."""

    def _check() -> bool:
        db = session_factory()
        try:
            provider = get_setting(db, "sync_provider", "")
            base = get_setting(db, "sync_custom_url", "")
            token = get_setting(db, "sync_custom_token", "")
        finally:
            db.close()
        if provider != "custom_server" or not base:
            return False
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        try:
            resp = requests.get(
                base.rstrip("/") + DEVICE_API_PREFIX + "/sync/status",
                headers=headers, timeout=timeout,
            )
            if not resp.ok:
                logger.warning("Sync proxy: reachability check got HTTP %s from %s", resp.status_code, base)
            return resp.ok
        except requests.RequestException as exc:
            # Deliberately logged (not just swallowed): a silent False here is
            # indistinguishable from "server is down" when it's actually a TLS/DNS/proxy
            # config problem on the device itself — see the CERTIFICATE_VERIFY_FAILED bug
            # this surfaced (device trusted no CA for the homelab's internal PKI at all).
            logger.warning("Sync proxy: reachability check failed for %s: %r", base, exc)
            return False

    return _check


def create_sync_proxy_middleware(
    *,
    session_factory: Callable[[], Session],
    get_setting: Callable[[Session, str, str], str],
    pending_op_model: Any,
    reachability: SyncReachability,
    blocked_prefixes: Iterable[str] = DEFAULT_BLOCKED_PREFIXES,
    request_timeout: float = 15.0,
    cache_model: Any = None,
) -> type:
    """Returns a BaseHTTPMiddleware subclass bound to one app's settings/DB/pending-op
    model. `reachability` is shared with the background ping task (see
    make_reachability_check + SyncReachability.start(), wired up at app startup).

    `cache_model` (optional — a model with cache_key/body/updated_at columns, e.g.
    ProxyResponseCache) caches every successful proxied GET response so a cold start (or
    a moment offline) has *something* to show immediately instead of an empty screen that
    silently fills in once the network round-trip lands — see AGENTS.md. Omit it to keep
    the previous behavior (local tables only, empty in pure-proxy mode) for any adopter
    that hasn't wired the model + migration up yet.
    """
    blocked = tuple(blocked_prefixes)

    def _cors_headers(request: Request) -> dict[str, str]:
        # SyncProxyMiddleware is registered *outer* relative to CORSMiddleware (see
        # app/main.py's own comment on registration order, needed so this middleware sees
        # the already-un-prefixed path ApiPrefixMiddleware produces) — every response it
        # returns directly here, without calling call_next(), therefore never passes
        # through CORSMiddleware at all. The WebView's fetch() still got its 200 (no
        # console error, no exception on the JS side), but without
        # Access-Control-Allow-Origin the browser silently discards the response body
        # before it reaches application code — every proxied request "succeeded" and
        # every screen stayed empty. Origin is reflected unconditionally: this only ever
        # answers the app's own embedded 127.0.0.1 server, never exposed beyond the
        # device, so there's no cross-site party to restrict it against.
        origin = request.headers.get("origin")
        if not origin:
            return {}
        return {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true"}

    def _cache_key(request: Request) -> str:
        path = request.scope["path"]
        return path + "?" + request.url.query if request.url.query else path

    def _read_cache(db: Session, cache_key: str) -> Optional[str]:
        if cache_model is None:
            return None
        row = db.query(cache_model).filter(cache_model.cache_key == cache_key).first()
        return row.body if row else None

    def _write_cache(db: Session, cache_key: str, body: bytes) -> None:
        if cache_model is None:
            return
        text = body.decode("utf-8", errors="ignore")
        row = db.query(cache_model).filter(cache_model.cache_key == cache_key).first()
        if row:
            row.body = text
        else:
            db.add(cache_model(cache_key=cache_key, body=text))
        db.commit()

    def _cached_response(request: Request, cached_body: str) -> Response:
        return Response(
            content=cached_body,
            status_code=200,
            media_type="application/json",
            headers=_cors_headers(request),
        )

    def _queue_pending_op(db: Session, request: Request, body: bytes) -> None:
        path = request.scope["path"]
        if request.url.query:
            path += "?" + request.url.query
        db.add(pending_op_model(
            method=request.method,
            path=path,
            body=body.decode("utf-8", errors="ignore") if body else None,
        ))
        db.commit()

    class SyncProxyMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next: Callable) -> Response:
            path = request.scope["path"]
            if any(path.startswith(prefix) for prefix in blocked):
                return await call_next(request)

            # CORS preflight is a negotiation between the WebView and *this* local
            # server, never the remote one — proxying it leaks the remote's own CORS
            # policy (which only knows its browser-facing origin, not
            # capacitor://localhost) back as if it were the local server's decision,
            # 400-ing every real request behind it. Always answer it locally; the
            # local CORSMiddleware already allows the native origin correctly.
            if request.method == "OPTIONS":
                return await call_next(request)

            # A single-key settings route (/settings/theme_accent) or a single-key
            # settings write (checked below, once the body is parsed) that names one of
            # the device-local keys never proxies — always the same decision the batch
            # GET path makes for those keys, see _DEVICE_LOCAL_SETTINGS_KEYS.
            if path.startswith("/settings/") and path != "/settings/" and request.method == "GET":
                if path[len("/settings/"):] in _DEVICE_LOCAL_SETTINGS_KEYS:
                    return await call_next(request)

            db = session_factory()
            try:
                provider = get_setting(db, "sync_provider", "")
                base = get_setting(db, "sync_custom_url", "")
                if provider != "custom_server" or not base:
                    return await call_next(request)

                body = await request.body()
                is_write = request.method in _WRITE_METHODS

                if path == "/settings/" and request.method == "POST":
                    try:
                        write_key = json.loads(body).get("key") if body else None
                    except (ValueError, AttributeError):
                        write_key = None
                    if write_key in _DEVICE_LOCAL_SETTINGS_KEYS:
                        return await call_next(request)

                # Resolves "never checked yet" inline for whichever request is first —
                # see SyncReachability.ensure_checked(): without this, a cold app start's
                # very first page load (fired within milliseconds of the WebView
                # connecting) always loses the race against the background ping task and
                # silently falls back to stale local data even on a healthy connection.
                await reachability.ensure_checked()
                if not reachability.reachable:
                    if request.method == "GET":
                        cached = _read_cache(db, _cache_key(request))
                        if cached is not None:
                            return _cached_response(request, cached)
                    response = await call_next(request)
                    if is_write and 200 <= response.status_code < 300:
                        _queue_pending_op(db, request, body)
                    return response

                token = get_setting(db, "sync_custom_token", "")
                headers = {
                    k: v for k, v in request.headers.items()
                    if k.lower() not in _HOP_BY_HOP_REQUEST_HEADERS
                }
                if token:
                    headers["Authorization"] = f"Bearer {token}"

                # Batch settings GET: the device-local keys (sync_custom_url, etc.) never
                # ask the remote about itself — they're stripped from the outgoing "keys"
                # list and merged back in locally afterwards, so the same one request
                # still returns everything else (theme included) live from the remote.
                local_only_values: dict[str, str] | None = None
                query = request.url.query
                if path == "/settings/" and request.method == "GET":
                    requested = [k.strip() for k in request.query_params.get("keys", "").split(",") if k.strip()]
                    local_only = [k for k in requested if k in _DEVICE_LOCAL_SETTINGS_KEYS]
                    if local_only:
                        remote_keys = [k for k in requested if k not in _DEVICE_LOCAL_SETTINGS_KEYS]
                        local_only_values = {k: get_setting(db, k, "") for k in local_only}
                        if not remote_keys:
                            return Response(
                                content=json.dumps(local_only_values),
                                status_code=200,
                                media_type="application/json",
                                headers=_cors_headers(request),
                            )
                        query = "keys=" + ",".join(remote_keys)

                url = base.rstrip("/") + DEVICE_API_PREFIX + path
                if query:
                    url += "?" + query

                try:
                    remote = requests.request(
                        request.method, url, headers=headers,
                        data=body or None, timeout=request_timeout,
                    )
                except requests.RequestException:
                    logger.warning("Sync proxy: remote unreachable mid-request, falling back to local")
                    reachability.reachable = False
                    if request.method == "GET":
                        cached = _read_cache(db, _cache_key(request))
                        if cached is not None:
                            return _cached_response(request, cached)
                    response = await call_next(request)
                    if is_write and 200 <= response.status_code < 300:
                        _queue_pending_op(db, request, body)
                    return response

                if local_only_values is not None and remote.ok:
                    try:
                        merged = {**json.loads(remote.content or b"{}"), **local_only_values}
                    except ValueError:
                        merged = local_only_values
                    return Response(
                        content=json.dumps(merged),
                        status_code=remote.status_code,
                        media_type="application/json",
                        headers=_cors_headers(request),
                    )

                if request.method == "GET" and 200 <= remote.status_code < 300:
                    _write_cache(db, _cache_key(request), remote.content)

                return Response(
                    content=remote.content,
                    status_code=remote.status_code,
                    headers={
                        **{
                            k: v for k, v in remote.headers.items()
                            if k.lower() not in _HOP_BY_HOP_RESPONSE_HEADERS
                        },
                        **_cors_headers(request),
                    },
                )
            finally:
                db.close()

    return SyncProxyMiddleware


def create_device_api_middleware(
    *,
    app_slug: str,
    prefix: str = DEVICE_API_PREFIX,
) -> type:
    """Bypass for a device client's own general API calls when this deployment is the
    one being connected TO (server side of the proxy-with-offline-cache design).

    Runs on the receiving server, not the client — register unconditionally there (see
    Soberan's main.py) since server_mode_enabled()/server_auth_ok() already gate it:
    outside {prefix} every request is untouched; requests are 404 unless server mode is
    on, then 401 unless they carry a valid Authorization: Bearer token (same check
    /sync/server/push and /sync/server/pull already use — no token configured on this
    server means this bypass is open, matching that same existing trust model). Once
    authorized, the prefix is stripped and the request falls through exactly like any
    other local request, e.g. "{prefix}/accounts" becomes "/accounts".
    """
    env_prefix = app_slug.upper()

    class DeviceApiAuthMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next: Callable) -> Response:
            path = request.scope["path"]
            if not path.startswith(prefix):
                return await call_next(request)
            if not server_mode_enabled(env_prefix):
                return Response(status_code=404)
            authorization = request.headers.get("authorization")
            if not server_auth_ok(env_prefix, authorization):
                return Response(status_code=401)

            rewritten = path[len(prefix):] or "/"
            request.scope["path"] = rewritten
            if request.scope.get("raw_path"):
                request.scope["raw_path"] = rewritten.encode("utf-8")
            return await call_next(request)

    return DeviceApiAuthMiddleware


async def replay_pending_ops(
    *,
    session_factory: Callable[[], Session],
    get_setting: Callable[[Session, str, str], str],
    pending_op_model: Any,
    import_bundle_replace: Callable[[Session, bytes], Any],
) -> dict[str, int]:
    """Replays queued offline writes against the remote server in order, then does a
    full bundle pull to reconcile — no per-row ID remapping/merging, see module
    docstring. Called once reachability flips from False to True."""
    db = session_factory()
    try:
        base = get_setting(db, "sync_custom_url", "")
        if not base:
            return {"replayed": 0, "pulled_tables": 0}
        token = get_setting(db, "sync_custom_token", "")
        headers = {"Authorization": f"Bearer {token}"} if token else {}

        ops = db.query(pending_op_model).order_by(pending_op_model.id.asc()).all()
        replayed = 0
        for op in ops:
            url = base.rstrip("/") + DEVICE_API_PREFIX + op.path
            try:
                resp = requests.request(
                    op.method, url, headers=headers,
                    data=(op.body.encode("utf-8") if op.body else None),
                    timeout=15.0,
                )
                if resp.ok:
                    replayed += 1
            except requests.RequestException:
                logger.warning("Sync proxy: replay failed for %s %s, stopping replay", op.method, op.path)
                break
            db.delete(op)
            db.commit()

        pull_endpoint = base.rstrip("/") + "/sync/server/pull"
        pull_resp = requests.get(pull_endpoint, headers=headers, timeout=45.0)
        if not pull_resp.ok:
            return {"replayed": replayed, "pulled_tables": 0}
        loaded = import_bundle_replace(db, pull_resp.content)
        return {"replayed": replayed, "pulled_tables": len(loaded)}
    finally:
        db.close()
