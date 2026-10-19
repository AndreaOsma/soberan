"""Encryption at rest for sensitive `user_settings` values (API keys/secrets).

`user_settings` is a generic key/value store (see models.UserSettings) shared by
onboarding flags, UI prefs, and a handful of third-party API credentials (Kraken
today) entered through the same generic /settings/ endpoints. Only the latter need
encryption — everything else passes through untouched.

Key source, in order: `SOBERAN_SETTINGS_ENCRYPTION_KEY` env var (same convention as
every other cross-cutting secret in this app: SOBERAN_API_KEY, GOCARDLESS_SECRET_*,
SOBERAN_SYNC_SERVER_TOKEN). If unset and the DB is a real SQLite file, a key is
generated once and persisted next to it (desktop/mobile installs have no env-var
UX). That key file is deliberately excluded from the export/sync bundle (see
sync_bundle.py) — a backup or Google Drive copy should not carry the means to
decrypt itself; restoring on a new device without the same env var just means
re-entering the affected settings, same tradeoff as an OS keychain not roaming.
If no key can be obtained at all (e.g. Postgres without the env var), values are
stored as plaintext — the pre-existing behavior — with a one-time warning.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger("soberan.secrets_crypto")

# user_settings keys that must never be persisted as plaintext.
ENCRYPTED_SETTING_KEYS = {"kraken_api_key", "kraken_api_secret"}

_ENC_PREFIX = "enc:v1:"

_cipher: Optional[object] = None
_cipher_loaded = False
_warned_no_key = False


def _key_file_path() -> Optional[Path]:
    from .database import DATABASE_URL

    prefix = "sqlite:///"
    if not DATABASE_URL.startswith(prefix) or DATABASE_URL.endswith(":memory:"):
        return None
    db_path = Path(DATABASE_URL[len(prefix):])
    return db_path.resolve().parent / ".soberan_settings_key"


def _load_or_create_key() -> Optional[bytes]:
    env_key = os.getenv("SOBERAN_SETTINGS_ENCRYPTION_KEY", "").strip()
    if env_key:
        return env_key.encode("utf-8")

    path = _key_file_path()
    if path is None:
        return None
    if path.is_file():
        try:
            return path.read_bytes().strip()
        except OSError as exc:
            logger.warning("No se pudo leer la clave de cifrado de settings: %s", exc)
            return None

    from cryptography.fernet import Fernet

    key = Fernet.generate_key()
    try:
        path.write_bytes(key)
        os.chmod(path, 0o600)
    except OSError as exc:
        logger.warning("No se pudo crear la clave de cifrado de settings: %s", exc)
        return None
    return key


def _get_cipher():
    global _cipher, _cipher_loaded
    if _cipher_loaded:
        return _cipher
    _cipher_loaded = True
    key = _load_or_create_key()
    if not key:
        return None
    from cryptography.fernet import Fernet

    try:
        _cipher = Fernet(key)
    except ValueError as exc:
        logger.warning("Clave de cifrado de settings inválida, se ignora: %s", exc)
        _cipher = None
    return _cipher


def encrypt_setting(setting_key: str, value: Optional[str]) -> Optional[str]:
    """Encrypt `value` when `setting_key` is sensitive and a cipher is available."""
    global _warned_no_key
    if setting_key not in ENCRYPTED_SETTING_KEYS or not value:
        return value
    cipher = _get_cipher()
    if cipher is None:
        if not _warned_no_key:
            logger.warning(
                "Sin clave de cifrado disponible (define SOBERAN_SETTINGS_ENCRYPTION_KEY): "
                "'%s' se guardará sin cifrar.",
                setting_key,
            )
            _warned_no_key = True
        return value
    token = cipher.encrypt(value.encode("utf-8")).decode("ascii")
    return _ENC_PREFIX + token


def decrypt_setting(setting_key: str, value: Optional[str]) -> Optional[str]:
    """Decrypt `value` when it carries the encrypted-setting marker; pass through otherwise."""
    if not value or not value.startswith(_ENC_PREFIX):
        return value
    cipher = _get_cipher()
    if cipher is None:
        return value
    token = value[len(_ENC_PREFIX):]
    try:
        return cipher.decrypt(token.encode("ascii")).decode("utf-8")
    except Exception:
        logger.warning(
            "No se pudo descifrar '%s' (clave de cifrado distinta o dato corrupto).",
            setting_key,
        )
        return value


def reset_cipher_cache_for_tests() -> None:
    """Test-only: force the next call to re-resolve the key (env var changed mid-run)."""
    global _cipher, _cipher_loaded, _warned_no_key
    _cipher = None
    _cipher_loaded = False
    _warned_no_key = False
