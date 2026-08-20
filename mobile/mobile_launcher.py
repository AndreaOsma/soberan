"""Android on-device entrypoint (Chaquopy) — local SQLite, uvicorn on 127.0.0.1:PORT.

Mirrors desktop_launcher.py/app/desktop.py's single-process local deployment (SOBERAN_DESKTOP=1
reuses its /api-prefix-stripping middleware and CORS wiring) but resolves the data directory
from Android's app-private storage instead of LOCALAPPDATA/darwin/linux paths.
"""
import logging
import os
import threading

logger = logging.getLogger("soberan.mobile")

PORT = 17890
HOST = "127.0.0.1"

_started = False

# `requests` ignores the OS trust store by default — it always verifies against certifi's
# own bundled cacert.pem. Any app whose backend calls another *.andreaosma.com service
# over HTTPS (private-server sync push/pull, Ollama, ...) needs that file to also trust
# this homelab's own Vault PKI root, since its Traefik-issued leaf certs aren't signed by
# a public CA — confirmed on iOS with the exact same setup (CERTIFICATE_VERIFY_FAILED,
# see dev/lib/native-packaging/build-ios-ci.sh, which does the equivalent fix at build
# time instead of runtime since app_packages is writable there before signing but not
# after). Chaquopy's extracted Python env has no such build-time hook available from this
# repo's build scripts, so this appends at first launch instead — idempotent (checked by
# subject line, not just presence of *a* line, so a certifi package upgrade that ships a
# byte-different file still gets the CA appended again).
_HOMELAB_ROOT_CA_PEM = """-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUaX1329nwYbw4+f8PzzBvoui1hfowDQYJKoZIhvcNAQEL
BQAwGjEYMBYGA1UEAxMPSG9tZWxhYiBSb290IENBMB4XDTI2MDUzMDExMTMyOVoX
DTM2MDUyNzExMTM1OVowGjEYMBYGA1UEAxMPSG9tZWxhYiBSb290IENBMIIBIjAN
BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnW/KoXdFH26IFVmn4IdoC5/FCMjH
A5IIxxxO4ni2Lw+ImJ1k1/NRnFoyZVAzPhoTQFzcj8GrI5Q8hqGkbkperbhaBQ0w
SMEcrt47fj4S+l77Vm7ZC7uPbIfuizY4VUzr123ZaJojrzSBFOfp4kKilNS4wwiq
IlFbxt+zlGN84UhO5LGSPVa3xeq5vuWipQXvcQv3TQiJTadm7QHmOsDoZg+QQlGg
cMWopyFpJmsC5Y2b6cf144qtWk6s4/A+2RvunQhdUSIArmDkEmydrXPC3rpl7Ck+
OWAA4AuyqeHWfbZSpgBoX4GxhxaWdryhF6SWw3/1uPBWOPCHco9qsMXiDwIDAQAB
o2MwYTAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQU
VEfKYhkWEe+5SRpUuVQ+Ps3AQiwwHwYDVR0jBBgwFoAUVEfKYhkWEe+5SRpUuVQ+
Ps3AQiwwDQYJKoZIhvcNAQELBQADggEBAAkHIt8fZdaS7vOrj7Tg3T+golx7PKsl
89DO/w6gl4LPyfwHZ+2OoodCOdrCMAgw/3pBN54LVzWDJ0fhyW48HWy902p1NJ6j
2VD0WfvaDnBgYjfu/P2GRn8fwZmZMFKQ6cWjcGH3Vlzyr9eGlHDA9RJquWkCSf3o
VhRAN2kdJ/iiRMaXWjoF+mG3gDLCBG3fsI/5jllSBfRO9nZdqaz04S+io61jdqvz
gNhDc3BhVjzBatf9cCht7Kcaz9l25/3EIMwSmgI/kWPzckJozHxC1RXtAoF+kClr
s9BIC2M1X4i9s0TbqlWJA2IzUak51rEZcGo6BEWpVgU+ZItVgBadVFM=
-----END CERTIFICATE-----"""


def _trust_homelab_root_ca() -> None:
    try:
        import certifi

        bundle_path = certifi.where()
        with open(bundle_path, "r", encoding="utf-8") as f:
            current = f.read()
        if "Homelab Root CA" not in current:
            with open(bundle_path, "a", encoding="utf-8") as f:
                f.write("\n" + _HOMELAB_ROOT_CA_PEM + "\n")
            logger.info("Homelab Root CA appended to certifi bundle at %s", bundle_path)
    except Exception:
        logger.exception("Could not append Homelab Root CA to certifi's bundle")


def start(files_dir: str) -> str:
    """Called once from MainApplication.onCreate() with Context.getFilesDir(). Idempotent."""
    global _started
    url = f"http://{HOST}:{PORT}"
    if _started:
        return url
    _started = True

    data_dir = os.path.join(files_dir, "soberan")
    os.makedirs(data_dir, exist_ok=True)
    db_path = os.path.join(data_dir, "soberan.db")

    os.environ["SOBERAN_DESKTOP"] = "1"
    os.environ.setdefault("DATABASE_URL", "sqlite:///" + db_path)
    os.environ["SOBERAN_HOST"] = HOST
    os.environ["SOBERAN_PORT"] = str(PORT)
    # main.py's desktop-mode CORS default only allows http://<SOBERAN_HOST>:<PORT> origins,
    # but the actual caller is the WebView itself — Capacitor's default androidScheme, not
    # a page served from this same host:port — so it needs to be listed explicitly.
    os.environ["CORS_ALLOW_ORIGINS"] = "https://localhost,capacitor://localhost"

    _trust_homelab_root_ca()

    def _run():
        try:
            import uvicorn
            from app.main import app  # import alone runs create_all + alembic upgrade head

            logger.info("Soberan backend starting on %s (db=%s)", url, db_path)
            uvicorn.run(app, host=HOST, port=PORT, log_level="info")
        except Exception:
            logger.exception("Soberan backend failed to start")

    threading.Thread(target=_run, daemon=True, name="soberan-backend").start()
    return url
