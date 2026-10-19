"""Native sync routes (Windows/macOS/Android/iOS): Google Drive and custom server.

Thin instantiation of the shared native-sync factory — the actual sync logic (Google
OAuth device-code flow, auto-sync with conflict detection, push/pull to Drive or a
private server) lives in app/native_sync/, a generated copy of dev/lib/native-sync
(see AGENTS.md for the adoption contract; never edit the copy).
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from .. import models
from ..database import SessionLocal, get_db
from ..desktop import desktop_data_dir, is_desktop_mode
from ..sync_bundle import export_bundle_bytes, import_bundle_replace

from ..native_sync.native_sync_router import create_sync_router
from ..native_sync.sync_proxy_middleware import (
    SyncReachability,
    create_device_api_middleware,
    create_sync_proxy_middleware,
    make_reachability_check,
    replay_pending_ops,
)

def _get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.query(models.UserSettings).filter(models.UserSettings.key == key).first()
    if not row or row.value is None:
        return default
    return row.value.strip()


def _set_setting(db: Session, key: str, value: str) -> None:
    row = db.query(models.UserSettings).filter(models.UserSettings.key == key).first()
    if row:
        row.value = value
    else:
        db.add(models.UserSettings(key=key, value=value))
    db.commit()


def _pending_op_count(db: Session) -> int:
    return db.query(models.PendingSyncOp).count()


# --- Proxy-with-offline-cache: only relevant on native clients (desktop/mobile), never
# in Docker server mode — a self-hosted server has no "upstream server" of its own to
# proxy to. Wired into main.py: middleware registered on the FastAPI app, reachability
# task started on startup. See app/native_sync/sync_proxy_middleware.py.
# Defined before create_sync_router() below so /sync/status can report reachability +
# pending-op count via is_reachable/get_pending_count.
sync_reachability = SyncReachability()

router = create_sync_router(
    app_slug="soberan",
    is_desktop_mode=is_desktop_mode,
    desktop_data_dir=desktop_data_dir,
    get_db=get_db,
    get_setting=_get_setting,
    set_setting=_set_setting,
    export_bundle_bytes=export_bundle_bytes,
    import_bundle_replace=import_bundle_replace,
    is_reachable=lambda: bool(sync_reachability.reachable),
    get_pending_count=_pending_op_count,
)

SyncProxyMiddleware = create_sync_proxy_middleware(
    session_factory=SessionLocal,
    get_setting=_get_setting,
    pending_op_model=models.PendingSyncOp,
    reachability=sync_reachability,
    cache_model=models.ProxyResponseCache,
)

_reachability_check = make_reachability_check(
    session_factory=SessionLocal,
    get_setting=_get_setting,
)


async def _on_reconnect() -> None:
    import logging

    logger = logging.getLogger("soberan.sync_proxy")
    result = await replay_pending_ops(
        session_factory=SessionLocal,
        get_setting=_get_setting,
        pending_op_model=models.PendingSyncOp,
        import_bundle_replace=import_bundle_replace,
    )
    logger.info("Sync proxy reconnected: %s", result)


def start_sync_reachability_task() -> None:
    sync_reachability.start(_reachability_check, on_reconnect=_on_reconnect)


# --- Device-api bypass: the OTHER side of the proxy — this app acting as the server
# being connected to. Safe to register unconditionally (see create_device_api_middleware
# docstring): it's a no-op unless a request's path actually starts with /device, and a
# no-op again unless SOBERAN_SYNC_SERVER_MODE is on for this deployment.
DeviceApiAuthMiddleware = create_device_api_middleware(app_slug="soberan")
