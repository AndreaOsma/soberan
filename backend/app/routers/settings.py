"""User settings get/set routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..schemas import SettingBase
from ..secrets_crypto import ENCRYPTED_SETTING_KEYS, decrypt_setting, encrypt_setting

router = APIRouter()

# Fixed placeholder returned in place of a stored secret's plaintext. The value
# itself is meaningless — the client only reads "non-empty => a secret is stored"
# (write-only fields, see SettingTextField `secret` mode). Reads must never echo
# the real key/secret: the app is single-user behind Authelia, but an XSS in that
# session could otherwise exfiltrate live API credentials straight from /settings.
SECRET_MASK = "••••••••"


def _mask_if_secret(key: str, value: str | None) -> str | None:
    """Replace a stored secret's value with SECRET_MASK; pass everything else through."""
    if key in ENCRYPTED_SETTING_KEYS and value:
        return SECRET_MASK
    return value


@router.get("/settings/")
def list_settings(
    keys: str | None = Query(None, description="Comma-separated keys; omit for all"),
    db: Session = Depends(get_db),
):
    """Return settings as { key: value }. Missing keys are omitted (client fills "")."""
    q = db.query(models.UserSettings)
    if keys:
        wanted = [k.strip() for k in keys.split(",") if k.strip()]
        if wanted:
            q = q.filter(models.UserSettings.key.in_(wanted))
    rows = q.all()
    return {
        row.key: _mask_if_secret(row.key, decrypt_setting(row.key, row.value) or "")
        for row in rows
    }


@router.get("/settings/{key}")
def get_set(key: str, db: Session = Depends(get_db)):
    db_set = db.query(models.UserSettings).filter(models.UserSettings.key == key).first()
    value = decrypt_setting(key, db_set.value) if db_set else None
    return {"value": _mask_if_secret(key, value)}


@router.post("/settings/")
def post_set(setting: SettingBase, db: Session = Depends(get_db)):
    # Never persist the read-time mask as if it were the real secret: a client that
    # round-trips a masked field (should send it empty instead) must not clobber the
    # stored credential. Silently keep the existing value in that case.
    if setting.key in ENCRYPTED_SETTING_KEYS and setting.value == SECRET_MASK:
        return {"status": "ok"}
    stored_value = encrypt_setting(setting.key, setting.value)
    db_set = db.query(models.UserSettings).filter(models.UserSettings.key == setting.key).first()
    if db_set:
        db_set.value = stored_value
    else:
        db_set = models.UserSettings(key=setting.key, value=stored_value)
        db.add(db_set)
    db.commit()
    return {"status": "ok"}
