# GENERADO desde dev/lib/native-sync (Homelab): no lo edites aquí, edita la librería y ejecuta su sync.mjs
"""Generic native-client sync router: Google Drive (OAuth2 device-code) + private
server push/pull, for any FastAPI app that has a "client mode" (desktop/mobile, own
local SQLite, no login) distinct from a "server mode" (e.g. Docker self-hosted).

Extracted from Soberan's original app-specific sync_routes.py — this module has no
knowledge of any particular app's settings table or data-bundle format; those are
injected via create_sync_router()'s callables so the router stays reusable.

See AGENTS.md for the adoption contract (what a new app's backend/frontend need to
provide) and how each build target (dev, Windows/macOS/Android/iOS, Docker) gets this
file staged into its own backend source tree.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Literal

import requests
from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

GOOGLE_DEVICE_URL = "https://oauth2.googleapis.com/device/code"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3"
GOOGLE_DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.appdata"
BACKUPS_KEPT = 5


def _google_credential(name: str, env_prefix: str) -> str:
    """CLIENT_ID / CLIENT_SECRET del cliente OAuth, por orden: <APP>_GOOGLE_<name> (soberan
    ya lo usaba así), NATIVE_SYNC_GOOGLE_<name> (compartido por todas las apps) y, en un
    binario, build_config.py — lo escriben los scripts de native-packaging al compilar con
    los secretos de Agenix. Un clon público no lo tiene: su build sale sin Google Drive hasta
    que quien compila ponga su propio cliente en esas variables."""
    for var in (f"{env_prefix}_GOOGLE_{name}", f"NATIVE_SYNC_GOOGLE_{name}"):
        value = os.getenv(var, "").strip()
        if value:
            return value
    try:
        from . import build_config  # type: ignore[attr-defined]
    except ImportError:
        return ""
    return str(getattr(build_config, f"GOOGLE_{name}", "") or "").strip()


def bundle_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def server_auth_ok(env_prefix: str, authorization: str | None) -> bool:
    """Shared by /sync/server/* below and the device-api bypass middleware in
    sync_proxy_middleware.py — one place decides what counts as a valid device.

    Fails CLOSED: server mode bypasses the SSO/reverse-proxy at the edge and the
    /device middleware proxies the ENTIRE API, so an unset token must reject, not
    wave everyone through. Set {ENV_PREFIX}_SYNC_SERVER_TOKEN (a real random
    value) to enable these endpoints and enter the same token on each client."""
    expected = os.getenv(f"{env_prefix}_SYNC_SERVER_TOKEN", "").strip()
    if not expected:
        return False
    if not authorization or not authorization.startswith("Bearer "):
        return False
    return hmac.compare_digest(authorization[7:].strip(), expected)


def server_mode_enabled(env_prefix: str) -> bool:
    """Also shared with the device-api bypass middleware — same env var gates both."""
    return os.getenv(f"{env_prefix}_SYNC_SERVER_MODE", "").strip() in ("1", "true", "yes")


class ResolveRequest(BaseModel):
    keep: Literal["local", "remote"]


def create_sync_router(
    *,
    app_slug: str,
    is_desktop_mode: Callable[[], bool],
    desktop_data_dir: Callable[[], Path],
    get_db: Callable[..., Any],
    get_setting: Callable[[Session, str, str], str],
    set_setting: Callable[[Session, str, str], None],
    export_bundle_bytes: Callable[[Session], bytes],
    import_bundle_replace: Callable[[Session, bytes], Any],
    is_reachable: Callable[[], bool] | None = None,
    get_pending_count: Callable[[Session], int] | None = None,
) -> APIRouter:
    """Builds a /sync/* router bound to one app's storage/settings/bundle logic.

    app_slug (e.g. "soberan") drives both the env var prefix (SOBERAN_GOOGLE_CLIENT_ID,
    SOBERAN_NATIVE_SYNC, SOBERAN_SYNC_SERVER_MODE, ...) and the synced file name
    (soberan-sync.zip) — passing the same slug an app already used keeps existing env
    vars/secrets valid with zero migration.

    is_reachable/get_pending_count are optional — only apps that adopted the
    proxy-with-offline-cache design (sync_proxy_middleware.py) have anything meaningful
    to report there; omitting them just leaves those two /sync/status fields out.
    """
    router = APIRouter()
    env_prefix = app_slug.upper()
    sync_file_name = f"{app_slug}-sync.zip"
    # El frontend llama a /sync/auto al abrir, al volver a primer plano y al irse: sin esto
    # dos llamadas casi simultáneas (endpoints sync = hilos distintos) subirían dos veces.
    sync_lock = threading.Lock()

    def _native_sync_enabled() -> bool:
        return is_desktop_mode() or os.getenv(f"{env_prefix}_NATIVE_SYNC", "").strip() in ("1", "true", "yes")

    def _require_native_sync() -> None:
        if not _native_sync_enabled():
            raise HTTPException(status_code=404, detail="Sync nativo no disponible en este despliegue")

    def _server_mode_enabled() -> bool:
        return server_mode_enabled(env_prefix)

    def _google_client_id() -> str:
        return _google_credential("CLIENT_ID", env_prefix)

    def _google_client_secret() -> str:
        return _google_credential("CLIENT_SECRET", env_prefix)

    def _require_google_config() -> tuple[str, str]:
        cid = _google_client_id()
        csecret = _google_client_secret()
        if not cid:
            raise HTTPException(status_code=503, detail="Google Drive no configurado en este dispositivo")
        return cid, csecret

    def _google_refresh_token(db: Session) -> str:
        token = get_setting(db, "sync_google_refresh_token", "")
        if not token:
            raise HTTPException(status_code=400, detail="Google Drive no conectado todavía")
        return token

    def _google_access_token(db: Session) -> str:
        client_id, client_secret = _require_google_config()
        refresh = _google_refresh_token(db)
        payload = {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh,
        }
        resp = requests.post(GOOGLE_TOKEN_URL, data=payload, timeout=20)
        if not resp.ok:
            raise HTTPException(status_code=502, detail="No se pudo renovar token de Google Drive")
        data = resp.json()
        access = str(data.get("access_token") or "").strip()
        if not access:
            raise HTTPException(status_code=502, detail="Google no devolvió access_token")
        return access

    def _google_find_sync_file(access_token: str) -> dict[str, str] | None:
        headers = {"Authorization": f"Bearer {access_token}"}
        params = {
            "spaces": "appDataFolder",
            "q": f"name='{sync_file_name}' and trashed=false",
            "fields": "files(id,name,modifiedTime)",
            "pageSize": 1,
        }
        resp = requests.get(f"{GOOGLE_DRIVE_API}/files", headers=headers, params=params, timeout=20)
        if not resp.ok:
            raise HTTPException(status_code=502, detail="No se pudo consultar Google Drive")
        files = resp.json().get("files") or []
        if not files:
            return None
        return {"id": str(files[0]["id"]), "modifiedTime": str(files[0].get("modifiedTime") or "")}

    def _mark_synced(db: Session, remote_modified: str, local_bytes: bytes) -> None:
        """Base de la próxima comparación de /sync/auto: qué versión de Drive vimos y cómo
        era el bundle local en ese momento."""
        set_setting(db, "sync_base_modified", remote_modified)
        set_setting(db, "sync_last_hash", bundle_hash(local_bytes))
        set_setting(db, "sync_last_at", datetime.now(timezone.utc).isoformat(timespec="seconds"))

    def _push_to_google(db: Session, access: str | None = None, data: bytes | None = None) -> dict[str, Any]:
        access = access or _google_access_token(db)
        data = export_bundle_bytes(db) if data is None else data
        remote = _google_find_sync_file(access)
        headers = {"Authorization": f"Bearer {access}"}
        meta = {"name": sync_file_name}
        if not remote:
            meta["parents"] = ["appDataFolder"]
        files = {
            "metadata": ("metadata", json.dumps(meta), "application/json; charset=UTF-8"),
            "file": (sync_file_name, data, "application/zip"),
        }
        params = {"uploadType": "multipart", "fields": "id,modifiedTime"}
        if remote:
            resp = requests.patch(
                f"{GOOGLE_DRIVE_UPLOAD}/{remote['id']}", headers=headers, params=params, files=files, timeout=45
            )
        else:
            resp = requests.post(GOOGLE_DRIVE_UPLOAD, headers=headers, params=params, files=files, timeout=45)
        if not resp.ok:
            raise HTTPException(status_code=502, detail="No se pudo subir el backup a Google Drive")
        set_setting(db, "sync_last_push_at", str(resp.headers.get("Date", "")))
        _mark_synced(db, str(resp.json().get("modifiedTime") or ""), data)
        return {"status": "ok", "provider": "google_drive", "bytes": len(data)}

    def _pull_from_google(db: Session, access: str | None = None, remote: dict[str, str] | None = None) -> dict[str, Any]:
        access = access or _google_access_token(db)
        remote = remote or _google_find_sync_file(access)
        if not remote:
            raise HTTPException(status_code=404, detail="No hay backup en Google Drive todavía")
        payload = _download(access, remote)
        _backup_local(db)
        loaded = import_bundle_replace(db, payload)
        set_setting(db, "sync_last_pull_at", datetime.now(timezone.utc).isoformat(timespec="seconds"))
        # Hash del export tras importar, no del fichero bajado: el import puede normalizar
        # (ids, orden), y comparar con lo bajado daría "cambio local" en el siguiente auto.
        _mark_synced(db, remote["modifiedTime"], export_bundle_bytes(db))
        return {"status": "ok", "provider": "google_drive", "tables": loaded}

    def _local_data_root() -> Path:
        return desktop_data_dir() if is_desktop_mode() else Path.cwd() / "data"

    def _backup(data: bytes, origin: str) -> None:
        """Copia de la versión que se va a sustituir (se quedan las 5 últimas de cada origen):
        si el usuario elige mal en un conflicto, aún puede recuperarla."""
        folder = _local_data_root() / "sync-backups"
        folder.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        (folder / f"{app_slug}-{origin}-{stamp}.zip").write_bytes(data)
        for old in sorted(folder.glob(f"{app_slug}-{origin}-*.zip"))[:-BACKUPS_KEPT]:
            old.unlink(missing_ok=True)

    def _backup_local(db: Session) -> None:
        _backup(export_bundle_bytes(db), "local")

    def _download(access: str, remote: dict[str, str]) -> bytes:
        headers = {"Authorization": f"Bearer {access}"}
        resp = requests.get(
            f"{GOOGLE_DRIVE_API}/files/{remote['id']}", headers=headers, params={"alt": "media"}, timeout=45
        )
        if not resp.ok:
            raise HTTPException(status_code=502, detail="No se pudo descargar backup de Google Drive")
        return resp.content

    def _auto_sync(db: Session) -> dict[str, Any]:
        """Decide sola qué hacer con Drive. Cambio local = el export ya no coincide con el
        último sincronizado (por eso export_bundle_bytes debe ser determinista); cambio remoto
        = otro dispositivo subió desde nuestra última sync. Si cambiaron los dos, no toca nada:
        409 y que el usuario elija con /sync/resolve."""
        access = _google_access_token(db)
        remote = _google_find_sync_file(access)
        local = export_bundle_bytes(db)
        last_hash = get_setting(db, "sync_last_hash", "")
        base = get_setting(db, "sync_base_modified", "")
        local_changed = bundle_hash(local) != last_hash
        if remote is None:
            _push_to_google(db, access, local)
            return {"status": "ok", "action": "pushed"}
        remote_changed = remote["modifiedTime"] != base
        if not local_changed and not remote_changed:
            return {"status": "ok", "action": "none"}
        if local_changed and not remote_changed:
            _push_to_google(db, access, local)
            return {"status": "ok", "action": "pushed"}
        if remote_changed and not local_changed:
            _pull_from_google(db, access, remote)
            return {"status": "ok", "action": "pulled"}
        raise HTTPException(
            status_code=409,
            detail={
                "conflict": True,
                "remote_modified": remote["modifiedTime"],
                "last_sync_at": get_setting(db, "sync_last_at", ""),
            },
        )

    def _sync_server_storage() -> Path:
        raw = os.getenv(f"{env_prefix}_SYNC_SERVER_STORAGE_DIR", "").strip()
        if raw:
            root = Path(raw).expanduser()
        elif is_desktop_mode():
            root = desktop_data_dir() / "sync-server"
        else:
            root = Path.cwd() / "data" / "sync-server"
        root.mkdir(parents=True, exist_ok=True)
        return root

    def _server_auth_ok(authorization: str | None) -> bool:
        return server_auth_ok(env_prefix, authorization)

    def _remote_endpoint(base: str, path: str) -> str:
        url = base.rstrip("/")
        if not (url.startswith("https://") or url.startswith("http://")):
            raise HTTPException(status_code=400, detail="La URL del servidor debe empezar por http:// o https://")
        return f"{url}{path}"

    @router.get("/sync/status")
    def sync_status(db: Session = Depends(get_db)):
        if not _native_sync_enabled():
            return {"enabled": False}
        custom_url = get_setting(db, "sync_custom_url", "")
        result = {
            "enabled": True,
            "google_configured": bool(_google_client_id()),
            "google_connected": bool(get_setting(db, "sync_google_refresh_token", "")),
            "last_sync_at": get_setting(db, "sync_last_at", ""),
            # El "servidor propio" del cliente solo funciona con el proxy en vivo
            # (sync_proxy_middleware.py, quien pasa is_reachable): sin él la UI no lo ofrece.
            "custom_server_supported": is_reachable is not None,
            "custom_server_configured": bool(custom_url),
            "custom_url": custom_url,
        }
        if is_reachable is not None:
            result["custom_server_reachable"] = is_reachable()
        if get_pending_count is not None:
            result["pending_ops"] = get_pending_count(db)
        return result

    @router.post("/sync/google/device/start")
    def sync_google_device_start(db: Session = Depends(get_db)):
        _require_native_sync()
        client_id, _ = _require_google_config()
        payload = {"client_id": client_id, "scope": GOOGLE_SCOPE}
        resp = requests.post(GOOGLE_DEVICE_URL, data=payload, timeout=20)
        if not resp.ok:
            raise HTTPException(status_code=502, detail="No se pudo iniciar login con Google")
        data = resp.json()
        device_code = str(data.get("device_code") or "").strip()
        if not device_code:
            raise HTTPException(status_code=502, detail="Google no devolvió device_code")
        set_setting(db, "sync_google_device_code", device_code)
        return {
            "status": "pending",
            "verification_url": data.get("verification_url"),
            "user_code": data.get("user_code"),
            "expires_in": data.get("expires_in"),
        }

    @router.post("/sync/google/device/complete")
    def sync_google_device_complete(db: Session = Depends(get_db)):
        _require_native_sync()
        client_id, client_secret = _require_google_config()
        device_code = get_setting(db, "sync_google_device_code", "")
        if not device_code:
            raise HTTPException(status_code=400, detail="No hay login de Google pendiente")
        payload = {
            "client_id": client_id,
            "client_secret": client_secret,
            "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        }
        resp = requests.post(GOOGLE_TOKEN_URL, data=payload, timeout=20)
        data = resp.json()
        if not resp.ok:
            err = str(data.get("error") or "")
            if err in ("authorization_pending", "slow_down"):
                return {"status": "pending"}
            raise HTTPException(status_code=502, detail="No se pudo completar login con Google")
        refresh = str(data.get("refresh_token") or "").strip()
        if not refresh:
            raise HTTPException(status_code=502, detail="Google no devolvió refresh_token")
        set_setting(db, "sync_google_refresh_token", refresh)
        set_setting(db, "sync_google_device_code", "")
        return {"status": "connected", "provider": "google_drive"}

    @router.post("/sync/google/push")
    def sync_google_push(db: Session = Depends(get_db)):
        _require_native_sync()
        with sync_lock:
            return _push_to_google(db)

    @router.post("/sync/google/pull")
    def sync_google_pull(db: Session = Depends(get_db)):
        _require_native_sync()
        with sync_lock:
            return _pull_from_google(db)

    @router.post("/sync/auto")
    def sync_auto(db: Session = Depends(get_db)):
        """Seguro de llamar siempre: sin sync nativo o sin Google conectado no hace nada."""
        if not _native_sync_enabled():
            return {"status": "disabled"}
        if not _google_client_id() or not get_setting(db, "sync_google_refresh_token", ""):
            return {"status": "not_connected"}
        if not sync_lock.acquire(blocking=False):
            return {"status": "busy"}
        try:
            return _auto_sync(db)
        finally:
            sync_lock.release()

    @router.post("/sync/resolve")
    def sync_resolve(body: ResolveRequest, db: Session = Depends(get_db)):
        """Tras un 409 de /sync/auto: el usuario elige qué versión manda."""
        _require_native_sync()
        if not sync_lock.acquire(blocking=False):
            raise HTTPException(status_code=409, detail="Ya hay una sincronización en curso")
        try:
            if body.keep == "local":
                access = _google_access_token(db)
                remote = _google_find_sync_file(access)
                if remote:
                    _backup(_download(access, remote), "drive")
                _push_to_google(db, access)
                return {"status": "ok", "action": "pushed"}
            _pull_from_google(db)
            return {"status": "ok", "action": "pulled"}
        finally:
            sync_lock.release()

    @router.post("/sync/custom/push")
    def sync_custom_push(db: Session = Depends(get_db)):
        _require_native_sync()
        base = get_setting(db, "sync_custom_url", "")
        if not base:
            raise HTTPException(status_code=400, detail="Configura la URL del servidor")
        # sync_custom_token: no longer collected by the client UI (just a URL, like the
        # Ollama connection field) — kept optional here for anyone who sets one directly
        # against a server that opted into {ENV_PREFIX}_SYNC_SERVER_TOKEN.
        token = get_setting(db, "sync_custom_token", "")
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        data = export_bundle_bytes(db)
        endpoint = _remote_endpoint(base, "/sync/server/push")
        resp = requests.post(
            endpoint,
            headers=headers,
            files={"file": (sync_file_name, data, "application/zip")},
            timeout=45,
        )
        if not resp.ok:
            raise HTTPException(status_code=502, detail="El servidor remoto rechazó la subida")
        return {"status": "ok", "provider": "custom_server", "bytes": len(data)}

    @router.post("/sync/custom/pull")
    def sync_custom_pull(db: Session = Depends(get_db)):
        _require_native_sync()
        base = get_setting(db, "sync_custom_url", "")
        if not base:
            raise HTTPException(status_code=400, detail="Configura la URL del servidor")
        token = get_setting(db, "sync_custom_token", "")
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        endpoint = _remote_endpoint(base, "/sync/server/pull")
        resp = requests.get(endpoint, headers=headers, timeout=45)
        if not resp.ok:
            raise HTTPException(status_code=502, detail="No se pudo descargar backup del servidor")
        loaded = import_bundle_replace(db, resp.content)
        return {"status": "ok", "provider": "custom_server", "tables": loaded}

    @router.post("/sync/server/push")
    async def sync_server_push(
        file: UploadFile = File(...),
        authorization: str | None = Header(default=None),
    ):
        if not _server_mode_enabled():
            raise HTTPException(status_code=404, detail="Sync server mode desactivado")
        if not _server_auth_ok(authorization):
            raise HTTPException(status_code=401, detail="Token inválido")
        storage = _sync_server_storage() / sync_file_name
        payload = await file.read()
        storage.write_bytes(payload)
        return {"status": "ok", "bytes": len(payload)}

    @router.get("/sync/server/pull")
    def sync_server_pull(authorization: str | None = Header(default=None)):
        if not _server_mode_enabled():
            raise HTTPException(status_code=404, detail="Sync server mode desactivado")
        if not _server_auth_ok(authorization):
            raise HTTPException(status_code=401, detail="Token inválido")
        from fastapi.responses import Response

        storage = _sync_server_storage() / sync_file_name
        if not storage.is_file():
            raise HTTPException(status_code=404, detail="Aún no hay backup subido")
        payload = storage.read_bytes()
        return Response(
            payload,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{sync_file_name}"'},
        )

    return router
