"""Desktop mode: local SQLite, static frontend, /api path rewriting for Windows bundle."""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Callable, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, Response
from starlette.staticfiles import StaticFiles

logger = logging.getLogger("soberan.desktop")

DESKTOP_PORT = 17890
DESKTOP_HOST = "127.0.0.1"

# FastAPI routes that keep the /api prefix (frontend may send /api/... or /api/api/...).
NATIVE_API_PREFIXES = (
    "/api/salary/",
    "/api/calendar/",
    "/api/payroll/",
    "/api/agent/",
    "/api/sankey/",
    "/api/patrimonio/",
    "/api/calendario/",
    "/api/alertas",
    "/api/chat/",
)

_CONFIGURED = False


def is_desktop_mode() -> bool:
    return os.getenv("SOBERAN_DESKTOP", "").strip() in ("1", "true", "yes")


def desktop_data_dir() -> Path:
    local_app = os.getenv("LOCALAPPDATA")
    if local_app:
        base = Path(local_app) / "Soberan"
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / "Soberan"
    else:
        base = Path.home() / ".local" / "share" / "Soberan"
    data = base / "data"
    data.mkdir(parents=True, exist_ok=True)
    return data


def desktop_logs_dir() -> Path:
    local_app = os.getenv("LOCALAPPDATA")
    if local_app:
        base = Path(local_app) / "Soberan"
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / "Soberan"
    else:
        base = Path.home() / ".local" / "share" / "Soberan"
    logs = base / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    return logs


def sqlite_url_for_path(db_path: Path) -> str:
    return "sqlite:///" + db_path.resolve().as_posix()


def resolve_static_dir(explicit: Optional[str] = None) -> Optional[Path]:
    if explicit:
        path = Path(explicit)
        if path.is_dir():
            return path
    env = (os.getenv("SOBERAN_STATIC_DIR") or "").strip()
    if env:
        path = Path(env)
        if path.is_dir():
            return path
    if getattr(sys, "frozen", False):
        bundle = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        for candidate in (
            bundle / "desktop" / "static",
            Path(sys.executable).parent / "desktop" / "static",
            Path(sys.executable).parent / "_internal" / "desktop" / "static",
        ):
            if candidate.is_dir():
                return candidate
    repo_static = Path(__file__).resolve().parent.parent / "desktop" / "static"
    if repo_static.is_dir() and any(repo_static.iterdir()):
        return repo_static
    return None


def rewrite_api_path(path: str) -> str:
    """Mirror nginx / Vite proxy: strip /api except for native /api/* backend routes."""
    if not path.startswith("/api/"):
        return path
    if any(path.startswith(prefix) for prefix in NATIVE_API_PREFIXES):
        return path
    if path.startswith("/api/api/"):
        return path[4:] or "/"
    stripped = path[4:] or "/"
    return stripped if stripped.startswith("/") else f"/{stripped}"


def configure_desktop_environment(
    static_dir: Optional[str] = None,
    port: Optional[int] = None,
) -> dict[str, str]:
    """Set env vars before database engine import. Idempotent."""
    global _CONFIGURED
    os.environ["SOBERAN_DESKTOP"] = "1"

    data_dir = desktop_data_dir()
    db_path = data_dir / "soberan.db"
    os.environ.setdefault("DATABASE_URL", sqlite_url_for_path(db_path))

    bind_port = str(port or int(os.getenv("SOBERAN_PORT", DESKTOP_PORT)))
    bind_host = os.getenv("SOBERAN_HOST", DESKTOP_HOST)
    os.environ["SOBERAN_PORT"] = bind_port
    os.environ["SOBERAN_HOST"] = bind_host
    os.environ.setdefault(
        "CORS_ALLOW_ORIGINS",
        f"http://{bind_host}:{bind_port},http://127.0.0.1:{bind_port}",
    )

    static = resolve_static_dir(static_dir or os.getenv("SOBERAN_STATIC_DIR"))
    if static:
        os.environ["SOBERAN_STATIC_DIR"] = str(static)

    log_dir = desktop_logs_dir()
    log_file = log_dir / "soberan.log"
    if not _CONFIGURED:
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        logging.getLogger().addHandler(file_handler)
        logger.info("Desktop data: %s", data_dir)
        logger.info("Desktop static: %s", static)
        _CONFIGURED = True

    return {
        "data_dir": str(data_dir),
        "db_path": str(db_path),
        "static_dir": str(static) if static else "",
        "host": bind_host,
        "port": bind_port,
        "url": f"http://{bind_host}:{bind_port}",
    }


class ApiPrefixMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        original = request.scope["path"]
        rewritten = rewrite_api_path(original)
        if rewritten != original:
            request.scope["path"] = rewritten
            if request.scope.get("raw_path"):
                request.scope["raw_path"] = rewritten.encode("utf-8")
        return await call_next(request)


def mount_desktop_static(app, static_dir: Path) -> None:
    """Serve Vite build + SPA fallback after API routes are registered."""
    index_path = static_dir / "index.html"
    if not index_path.is_file():
        logger.warning("Desktop static index missing at %s", index_path)
        return

    assets_dir = static_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="desktop-assets")

    public_names = (
        "favicon.svg", "favicon-32.png", "favicon-16.png", "apple-touch-icon.png",
        "icon-192.png", "icon-512.png", "icon-512-maskable.png", "manifest.json", "sw.js",
    )

    for name in public_names:
        file_path = static_dir / name
        if not file_path.is_file():
            continue

        def _make_handler(fp: Path):
            def _handler():
                return FileResponse(fp)
            return _handler

        app.get(f"/{name}")(_make_handler(file_path))

    @app.get("/{full_path:path}")
    def desktop_spa_fallback(full_path: str):
        if full_path.startswith("api"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not found")
        candidate = static_dir / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index_path, media_type="text/html")
