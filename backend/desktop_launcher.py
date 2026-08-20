"""Soberan desktop entrypoint — configure env, start API + static UI, show a native window."""
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


def _wait_for_port(host: str, port: int, timeout: float = 15.0) -> bool:
    """Polls until the backend actually accepts connections — opening the native
    window before then briefly shows WKWebView's own "couldn't connect" error page
    instead of the app."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _port_in_use(host, port):
            return True
        time.sleep(0.15)
    return False


def _open_browser(url: str, delay: float = 1.2) -> None:
    time.sleep(delay)
    webbrowser.open(url)


# `requests` ignores the OS trust store by default — it always verifies against certifi's
# own bundled cacert.pem. Any *.andreaosma.com service this backend calls over HTTPS
# (private-server sync push/pull, Ollama, ...) needs that file to also trust this
# homelab's own Vault PKI root, since its Traefik-issued leaf certs aren't signed by a
# public CA — confirmed on iOS (CERTIFICATE_VERIFY_FAILED) with the exact same underlying
# cause, see mobile_launcher.py's twin of this function for the full explanation.
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
    except Exception:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Soberan — finanzas personales (modo escritorio)")
    parser.add_argument("--no-browser", action="store_true", help="No mostrar ventana, solo arrancar el servidor")
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

    _trust_homelab_root_ca()

    import uvicorn  # noqa: E402
    from app.main import app  # noqa: E402

    print(f"Soberan en {url}")
    print(f"Datos: {info['data_dir']}")

    if args.no_browser:
        # Headless/background mode — no native window, this call blocks as the server
        # itself (previous default behavior). For anyone running the desktop build as
        # a manually-connected local service instead of the normal windowed app.
        uvicorn.run(app, host=host, port=port, log_level="info")
        return 0

    # Windowed mode (default): the backend runs on its own thread instead, since
    # pywebview's native window needs the main thread for its GUI event loop (mandatory
    # on macOS/Cocoa) — the previous "open the system browser" behavior looked like a
    # website, not an installed app. threading.Thread works fine here (unlike the
    # embedded-iOS build's ios_launcher.py, a completely different CPython embedding).
    threading.Thread(
        target=uvicorn.run,
        kwargs={"app": app, "host": host, "port": port, "log_level": "info"},
        daemon=True,
    ).start()
    if not _wait_for_port(host, port):
        print("El backend no respondió a tiempo — abriendo la ventana igualmente.", file=sys.stderr)

    import webview  # noqa: E402

    webview.create_window("Soberan", url, width=1280, height=860, min_size=(760, 560))
    webview.start()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
