"""Kraken credentials must be encrypted at rest in user_settings; other keys stay plain."""
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app import models
from app.database import SessionLocal
from app.main import app
from app.routers import settings as settings_router
from app.secrets_crypto import reset_cipher_cache_for_tests

client = TestClient(app)


def _raw_value(key: str) -> str | None:
    db = SessionLocal()
    try:
        row = db.query(models.UserSettings).filter(models.UserSettings.key == key).first()
        return row.value if row else None
    finally:
        db.close()


def test_kraken_credentials_are_encrypted_at_rest(monkeypatch):
    monkeypatch.setenv("SOBERAN_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
    reset_cipher_cache_for_tests()
    try:
        res = client.post("/settings/", json={"key": "kraken_api_key", "value": "MY-KRAKEN-KEY"})
        assert res.status_code == 200

        stored = _raw_value("kraken_api_key")
        assert stored is not None
        assert stored != "MY-KRAKEN-KEY"
        assert stored.startswith("enc:v1:")

        # Reads never echo the plaintext secret — they return the mask instead.
        assert client.get("/settings/kraken_api_key").json()["value"] == settings_router.SECRET_MASK
        assert client.get("/settings/?keys=kraken_api_key").json()["kraken_api_key"] == settings_router.SECRET_MASK
    finally:
        reset_cipher_cache_for_tests()


def test_secret_reads_are_masked_not_leaked(monkeypatch):
    """GET must never return the plaintext of an encrypted-secret key, only the mask."""
    monkeypatch.setenv("SOBERAN_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
    reset_cipher_cache_for_tests()
    try:
        client.post("/settings/", json={"key": "kraken_api_secret", "value": "SUPER-SECRET"})
        single = client.get("/settings/kraken_api_secret").json()["value"]
        bulk = client.get("/settings/?keys=kraken_api_secret").json()["kraken_api_secret"]
        assert single == settings_router.SECRET_MASK
        assert bulk == settings_router.SECRET_MASK
        assert "SUPER-SECRET" not in (single or "") and "SUPER-SECRET" not in (bulk or "")
    finally:
        reset_cipher_cache_for_tests()


def test_posting_the_mask_does_not_clobber_the_stored_secret(monkeypatch):
    """A client that echoes the mask back must not overwrite the real credential."""
    monkeypatch.setenv("SOBERAN_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
    reset_cipher_cache_for_tests()
    try:
        client.post("/settings/", json={"key": "kraken_api_key", "value": "REAL-KEY-123"})
        before = _raw_value("kraken_api_key")
        res = client.post("/settings/", json={"key": "kraken_api_key", "value": settings_router.SECRET_MASK})
        assert res.status_code == 200
        # Stored ciphertext is untouched, and still decrypts to the real value.
        assert _raw_value("kraken_api_key") == before
        from app.secrets_crypto import decrypt_setting

        assert decrypt_setting("kraken_api_key", _raw_value("kraken_api_key")) == "REAL-KEY-123"
    finally:
        reset_cipher_cache_for_tests()


def test_unset_secret_reads_as_null_not_mask(monkeypatch):
    """An absent secret returns null — the mask only ever stands in for a stored value."""
    monkeypatch.setenv("SOBERAN_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
    reset_cipher_cache_for_tests()
    try:
        db = SessionLocal()
        try:
            db.query(models.UserSettings).filter(models.UserSettings.key == "kraken_api_key").delete()
            db.commit()
        finally:
            db.close()
        got = client.get("/settings/kraken_api_key").json()["value"]
        assert got is None and got != settings_router.SECRET_MASK
    finally:
        reset_cipher_cache_for_tests()


def test_non_sensitive_settings_stay_plaintext(monkeypatch):
    monkeypatch.setenv("SOBERAN_SETTINGS_ENCRYPTION_KEY", Fernet.generate_key().decode())
    reset_cipher_cache_for_tests()
    try:
        client.post("/settings/", json={"key": "boot_theme_enc_test", "value": "night"})
        assert _raw_value("boot_theme_enc_test") == "night"
    finally:
        reset_cipher_cache_for_tests()


def test_legacy_plaintext_kraken_value_still_reads_back(monkeypatch):
    """Values saved before this change (plaintext) must keep working after upgrade."""
    monkeypatch.delenv("SOBERAN_SETTINGS_ENCRYPTION_KEY", raising=False)
    reset_cipher_cache_for_tests()
    try:
        db = SessionLocal()
        try:
            db.add(models.UserSettings(key="kraken_api_key_legacy", value="already-plaintext"))
            db.commit()
        finally:
            db.close()
        assert client.get("/settings/kraken_api_key_legacy").json()["value"] == "already-plaintext"
    finally:
        reset_cipher_cache_for_tests()
