"""Desktop mode info and update-check routes."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..desktop import DESKTOP_HOST, DESKTOP_PORT, desktop_data_dir, desktop_logs_dir, is_desktop_mode
from ..desktop_updates import build_update_check, get_desktop_version
from .chat import _chat_enabled, _resolve_ollama_base_url

router = APIRouter()

@router.get("/desktop/info")
def desktop_info(db: Session = Depends(get_db)):
    if not is_desktop_mode():
        raise HTTPException(status_code=404, detail="Solo disponible en modo escritorio")
    port = os.getenv("SOBERAN_PORT", str(DESKTOP_PORT))
    host = os.getenv("SOBERAN_HOST", DESKTOP_HOST)
    return {
        "desktop": True,
        "version": get_desktop_version(),
        "url": f"http://{host}:{port}",
        "data_dir": str(desktop_data_dir()),
        "logs_dir": str(desktop_logs_dir()),
        "chat_available": bool(_resolve_ollama_base_url(db) and _chat_enabled(db)),
    }


@router.get("/desktop/update-check")
def desktop_update_check(
    force: bool = False,
    db: Session = Depends(get_db),
):
    if not is_desktop_mode():
        raise HTTPException(status_code=404, detail="Solo disponible en modo escritorio")
    setting = db.query(models.UserSettings).filter(models.UserSettings.key == "desktop_check_updates").first()
    enabled = setting.value != "0" if setting and setting.value is not None else True
    return build_update_check(check_enabled=enabled, force=force)
