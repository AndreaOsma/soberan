"""iOS on-device entrypoint (embedded CPython via Python.xcframework) — local SQLite,
uvicorn on 127.0.0.1:PORT.

Mirrors mobile/mobile_launcher.py's Android/Chaquopy approach (same desktop-mode env vars,
same fixed port) — the iOS side differs in three ways: it blocks the calling thread instead
of spawning its own (see start()'s docstring for why), it gets the app's private storage
directory from an argument rather than a platform API call, and it needs a different WKWebView
origin allowed via CORS ("capacitor://localhost" on iOS vs. "https://localhost" on Android).
"""
import logging
import os
import sys

logger = logging.getLogger("soberan.ios")

PORT = 17890
HOST = "127.0.0.1"

_started = False


def start(data_root: str) -> None:
    """Called once from the Swift/ObjC app bootstrap with a writable, app-private directory
    (NSApplicationSupportDirectory in the app's sandboxed container). Idempotent.

    Blocks forever running the backend — unlike mobile_launcher.py's Android equivalent,
    which spawns a Python threading.Thread for this and returns immediately. That doesn't
    work here: on this CPython iOS build, a thread started via threading.Thread reports
    is_alive() == True but its target function's body never actually runs (confirmed with
    an unconditional write as the very first line — nothing, not even that, executes) —
    apparently threading needs the main-thread event loop that Py_RunMain() drives, which
    a custom PyInitializeFromConfig-based embedding like PythonRunner.m doesn't have.
    Calling this directly, blocking, is the fix: PythonRunner.m already dispatches the
    whole Python bootstrap (including this call) onto a background GCD queue, so nothing
    here runs on the UI thread regardless of whether it's a further Python-level thread."""
    global _started
    if _started:
        return
    _started = True

    data_dir = os.path.join(data_root, "soberan")
    os.makedirs(data_dir, exist_ok=True)
    db_path = os.path.join(data_dir, "soberan.db")

    os.environ["SOBERAN_DESKTOP"] = "1"
    os.environ.setdefault("DATABASE_URL", "sqlite:///" + db_path)
    os.environ["SOBERAN_HOST"] = HOST
    os.environ["SOBERAN_PORT"] = str(PORT)
    # Same reasoning as mobile_launcher.py: the caller is the WebView, not a page served
    # from this same host:port, so its origin needs to be listed explicitly. Capacitor's
    # default iOS WKWebView origin is "capacitor://localhost" (Android's is different:
    # "https://localhost") — see capacitor.config.ts, no custom `ios.scheme` override there.
    os.environ["CORS_ALLOW_ORIGINS"] = "capacitor://localhost"

    # A normal app launch has nothing attached to read stdout/stderr (unlike an Xcode debug
    # session or the CPython testbed's XCTest run, where both show up in the visible test
    # log) — without this, uvicorn's own request/error logging below is invisible. Same role
    # as desktop_logs_dir()'s logs/soberan.log on Windows/macOS, not iOS-only debug code.
    log_dir = os.path.join(data_root, "logs")
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, "soberan.log")
    log_file = open(log_path, "a", buffering=1)
    sys.stdout = log_file
    sys.stderr = log_file
    logging.basicConfig(level=logging.INFO, stream=log_file, force=True)

    import uvicorn
    from app.main import app  # import alone runs create_all + alembic upgrade head

    logger.info("Soberan backend starting on http://%s:%s (db=%s)", HOST, PORT, db_path)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
