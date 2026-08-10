"""Soberan desktop entrypoint — configure env, start API + static UI, open browser."""
from __future__ import annotations

import argparse
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

# Ensure backend root is on path when frozen or run from repo.
_BACKEND_ROOT = Path(__file__).resolve().parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from app.desktop import configure_desktop_environment, DESKTOP_HOST, DESKTOP_PORT  # noqa: E402


def _port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def _open_browser(url: str, delay: float = 1.2) -> None:
    time.sleep(delay)
    webbrowser.open(url)


def main() -> int:
    parser = argparse.ArgumentParser(description="Soberan — finanzas personales (modo escritorio)")
    parser.add_argument("--no-browser", action="store_true", help="No abrir el navegador al arrancar")
    parser.add_argument("--port", type=int, default=None, help=f"Puerto local (default {DESKTOP_PORT})")
    args = parser.parse_args()

    static_dir = _BACKEND_ROOT / "desktop" / "static"
    info = configure_desktop_environment(
        static_dir=str(static_dir) if static_dir.is_dir() else None,
        port=args.port,
    )
    host = info["host"]
    port = int(info["port"])
    url = info["url"]

    if _port_in_use(host, port):
        print(f"Soberan ya está en ejecución o el puerto {port} está ocupado.", file=sys.stderr)
        print(f"Abre {url} en el navegador o cierra la otra instancia.", file=sys.stderr)
        if not args.no_browser:
            webbrowser.open(url)
        return 1

    import uvicorn  # noqa: E402
    from app.main import app  # noqa: E402

    if not args.no_browser:
        threading.Thread(target=_open_browser, args=(url,), daemon=True).start()

    print(f"Soberan en {url}")
    print(f"Datos: {info['data_dir']}")
    uvicorn.run(app, host=host, port=port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
