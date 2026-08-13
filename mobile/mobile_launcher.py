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
