"""Native sync routes (Windows/APK): Google Drive and custom server."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import requests
from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..desktop import desktop_data_dir, is_desktop_mode
from ..sync_bundle import export_bundle_bytes, import_bundle_replace

router = APIRouter()

GOOGLE_DEVICE_URL = "https://oauth2.googleapis.com/device/code"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3"
GOOGLE_DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.appdata"
SYNC_FILE_NAME = "soberan-sync.zip"


def _native_sync_enabled() -> bool:
    return is_desktop_mode() or os.getenv("SOBERAN_NATIVE_SYNC", "").strip() in ("1", "true", "yes")


def _require_native_sync() -> None:
    if not _native_sync_enabled():
        raise HTTPException(status_code=404, detail="Sync nativo no disponible en este despliegue")


def _server_mode_enabled() -> bool:
    return os.getenv("SOBERAN_SYNC_SERVER_MODE", "").strip() in ("1", "true", "yes")


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


def _google_client_id() -> str:
    return os.getenv("SOBERAN_GOOGLE_CLIENT_ID", "").strip()


def _google_client_secret() -> str:
    return os.getenv("SOBERAN_GOOGLE_CLIENT_SECRET", "").strip()


def _require_google_config() -> tuple[str, str]:
    cid = _google_client_id()
    csecret = _google_client_secret()
    if not cid:
        raise HTTPException(status_code=503, detail="Google Drive no configurado en este dispositivo")
    return cid, csecret


def _google_refresh_token(db: Session) -> str:
    token = _get_setting(db, "sync_google_refresh_token")
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


def _google_find_sync_file(access_token: str) -> str | None:
    headers = {"Authorization": f"Bearer {access_token}"}
    params = {
        "spaces": "appDataFolder",
        "q": f"name='{SYNC_FILE_NAME}' and trashed=false",
        "fields": "files(id,name,modifiedTime)",
        "pageSize": 1,
    }
    resp = requests.get(f"{GOOGLE_DRIVE_API}/files", headers=headers, params=params, timeout=20)
    if not resp.ok:
        raise HTTPException(status_code=502, detail="No se pudo consultar Google Drive")
    files = resp.json().get("files") or []
    if not files:
        return None
    return str(files[0]["id"])


def _push_to_google(db: Session) -> dict[str, Any]:
    access = _google_access_token(db)
    data = export_bundle_bytes(db)
    file_id = _google_find_sync_file(access)
    headers = {"Authorization": f"Bearer {access}"}
    meta = {"name": SYNC_FILE_NAME, "parents": ["appDataFolder"]}
    files = {
        "metadata": ("metadata", json.dumps(meta), "application/json; charset=UTF-8"),
        "file": (SYNC_FILE_NAME, data, "application/zip"),
    }
    if file_id:
        resp = requests.patch(
            f"{GOOGLE_DRIVE_UPLOAD}/{file_id}",
            headers=headers,
            params={"uploadType": "multipart"},
            files=files,
            timeout=45,
        )
    else:
        resp = requests.post(
            GOOGLE_DRIVE_UPLOAD,
            headers=headers,
            params={"uploadType": "multipart"},
            files=files,
            timeout=45,
        )
    if not resp.ok:
        raise HTTPException(status_code=502, detail="No se pudo subir el backup a Google Drive")
    _set_setting(db, "sync_last_push_at", str(resp.headers.get("Date", "")))
    return {"status": "ok", "provider": "google_drive", "bytes": len(data)}


def _pull_from_google(db: Session) -> dict[str, Any]:
    access = _google_access_token(db)
    file_id = _google_find_sync_file(access)
    if not file_id:
        raise HTTPException(status_code=404, detail="No hay backup en Google Drive todavía")
    headers = {"Authorization": f"Bearer {access}"}
    resp = requests.get(f"{GOOGLE_DRIVE_API}/files/{file_id}", headers=headers, params={"alt": "media"}, timeout=45)
    if not resp.ok:
        raise HTTPException(status_code=502, detail="No se pudo descargar backup de Google Drive")
    loaded = import_bundle_replace(db, resp.content)
    _set_setting(db, "sync_last_pull_at", str(resp.headers.get("Date", "")))
    return {"status": "ok", "provider": "google_drive", "tables": loaded}


def _sync_server_storage() -> Path:
    raw = os.getenv("SOBERAN_SYNC_SERVER_STORAGE_DIR", "").strip()
    if raw:
        root = Path(raw).expanduser()
    elif is_desktop_mode():
        root = desktop_data_dir() / "sync-server"
    else:
        root = Path.cwd() / "data" / "sync-server"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _server_auth_ok(authorization: str | None) -> bool:
    expected = os.getenv("SOBERAN_SYNC_SERVER_TOKEN", "").strip()
    if not expected:
        return False
    if not authorization or not authorization.startswith("Bearer "):
        return False
    return authorization[7:].strip() == expected


def _remote_endpoint(base: str, path: str) -> str:
    url = base.rstrip("/")
    if not (url.startswith("https://") or url.startswith("http://")):
        raise HTTPException(status_code=400, detail="La URL del servidor debe empezar por http:// o https://")
    return f"{url}{path}"


@router.get("/sync/status")
def sync_status(db: Session = Depends(get_db)):
    if not _native_sync_enabled():
        return {"enabled": False}
    custom_url = _get_setting(db, "sync_custom_url")
    custom_token = _get_setting(db, "sync_custom_token")
    return {
        "enabled": True,
        "google_configured": bool(_google_client_id()),
        "google_connected": bool(_get_setting(db, "sync_google_refresh_token")),
        "custom_server_configured": bool(custom_url and custom_token),
        "custom_url": custom_url,
    }


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
    _set_setting(db, "sync_google_device_code", device_code)
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
    device_code = _get_setting(db, "sync_google_device_code")
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
    _set_setting(db, "sync_google_refresh_token", refresh)
    _set_setting(db, "sync_google_device_code", "")
    return {"status": "connected", "provider": "google_drive"}


@router.post("/sync/google/push")
def sync_google_push(db: Session = Depends(get_db)):
    _require_native_sync()
    return _push_to_google(db)


@router.post("/sync/google/pull")
def sync_google_pull(db: Session = Depends(get_db)):
    _require_native_sync()
    return _pull_from_google(db)


@router.post("/sync/custom/push")
def sync_custom_push(db: Session = Depends(get_db)):
    _require_native_sync()
    base = _get_setting(db, "sync_custom_url")
    token = _get_setting(db, "sync_custom_token")
    if not base or not token:
        raise HTTPException(status_code=400, detail="Configura URL y token del servidor")
    data = export_bundle_bytes(db)
    endpoint = _remote_endpoint(base, "/sync/server/push")
    resp = requests.post(
        endpoint,
        headers={"Authorization": f"Bearer {token}"},
        files={"file": (SYNC_FILE_NAME, data, "application/zip")},
        timeout=45,
    )
    if not resp.ok:
        raise HTTPException(status_code=502, detail="El servidor remoto rechazó la subida")
    return {"status": "ok", "provider": "custom_server", "bytes": len(data)}


@router.post("/sync/custom/pull")
def sync_custom_pull(db: Session = Depends(get_db)):
    _require_native_sync()
    base = _get_setting(db, "sync_custom_url")
    token = _get_setting(db, "sync_custom_token")
    if not base or not token:
        raise HTTPException(status_code=400, detail="Configura URL y token del servidor")
    endpoint = _remote_endpoint(base, "/sync/server/pull")
    resp = requests.get(endpoint, headers={"Authorization": f"Bearer {token}"}, timeout=45)
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
    storage = _sync_server_storage() / SYNC_FILE_NAME
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

    storage = _sync_server_storage() / SYNC_FILE_NAME
    if not storage.is_file():
        raise HTTPException(status_code=404, detail="Aún no hay backup subido")
    payload = storage.read_bytes()
    return Response(
        payload,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{SYNC_FILE_NAME}"'},
    )
