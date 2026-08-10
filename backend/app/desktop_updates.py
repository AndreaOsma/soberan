"""Desktop app version and optional update checks against GitHub Releases."""
from __future__ import annotations

import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import requests

logger = logging.getLogger("soberan.desktop.updates")

DEFAULT_RELEASES_URL = "https://api.github.com/repos/AndreaOsma/soberan/releases/latest"
DEFAULT_RELEASE_PAGE = "https://github.com/AndreaOsma/soberan/releases/latest"

_CACHE: dict[str, Any] = {"ts": 0.0, "payload": None}
_CACHE_TTL_SEC = 6 * 60 * 60  # 6 h


def _version_file_candidates() -> list[Path]:
    paths: list[Path] = []
    if getattr(sys, "frozen", False):
        bundle = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        paths.extend([
            bundle / "desktop" / "VERSION",
            Path(sys.executable).parent / "desktop" / "VERSION",
            Path(sys.executable).parent / "_internal" / "desktop" / "VERSION",
        ])
    paths.append(Path(__file__).resolve().parent.parent / "desktop" / "VERSION")
    return paths


def get_desktop_version() -> str:
    env = os.getenv("SOBERAN_APP_VERSION", "").strip()
    if env:
        return env
    for path in _version_file_candidates():
        if path.is_file():
            text = path.read_text(encoding="utf-8").strip()
            if text:
                return text
    return "0.0.0"


def version_tuple(version: str) -> tuple[int, ...]:
    nums = [int(n) for n in re.findall(r"\d+", version or "")]
    return tuple(nums) if nums else (0,)


def is_newer_version(latest: str, current: str) -> bool:
    return version_tuple(latest) > version_tuple(current)


def _parse_version_from_asset(name: str) -> Optional[str]:
    m = re.search(r"SoberanSetup-(.+?)\.exe$", name, re.I)
    return m.group(1) if m else None


def _safe_release_url(api_url: str) -> str:
    parsed = urlparse(api_url)
    if not parsed.scheme or not parsed.netloc:
        return DEFAULT_RELEASE_PAGE
    parts = [p for p in parsed.path.strip("/").split("/") if p]
    # GitHub: /repos/{owner}/{repo}/releases/tags/{tag} (o /releases/latest)
    # Otras forjas con API tipo GitHub: /api/v1/repos/{owner}/{repo}/releases/...
    try:
        idx = parts.index("repos")
        owner, repo = parts[idx + 1], parts[idx + 2]
        tag = parts[-1] if len(parts) > idx + 4 and parts[-2] == "tags" else None
        suffix = f"releases/tag/{tag}" if tag else "releases/latest"
        if parsed.netloc.endswith("github.com") or parsed.netloc == "api.github.com":
            return f"https://github.com/{owner}/{repo}/{suffix}"
        return f"{parsed.scheme}://{parsed.netloc}/{owner}/{repo}/{suffix}"
    except (ValueError, IndexError):
        return DEFAULT_RELEASE_PAGE


def fetch_latest_release(
    releases_url: Optional[str] = None,
    *,
    force: bool = False,
) -> Optional[dict[str, Any]]:
    now = time.time()
    if not force and _CACHE["payload"] is not None and (now - _CACHE["ts"]) < _CACHE_TTL_SEC:
        return _CACHE["payload"]

    url = (releases_url or os.getenv("SOBERAN_RELEASES_URL") or DEFAULT_RELEASES_URL).strip()
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    try:
        resp = requests.get(url, timeout=8, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.info("Desktop update check failed: %s", exc)
        return None

    assets = data.get("assets") or []
    installer = next((a for a in assets if str(a.get("name", "")).lower().startswith("soberansetup-")), None)
    latest_version = None
    download_url = None
    if installer:
        latest_version = _parse_version_from_asset(str(installer.get("name", "")))
        download_url = installer.get("browser_download_url")

    if not latest_version:
        latest_version = str(data.get("tag_name") or "") or None

    payload = {
        "latest_version": latest_version,
        "download_url": download_url,
        "release_url": data.get("html_url") or _safe_release_url(url),
        "release_name": data.get("name"),
        "published_at": data.get("published_at"),
    }
    _CACHE["ts"] = now
    _CACHE["payload"] = payload
    return payload


def build_update_check(
    *,
    check_enabled: bool,
    force: bool = False,
) -> dict[str, Any]:
    current = get_desktop_version()
    base = {
        "check_enabled": check_enabled,
        "current_version": current,
        "update_available": False,
        "latest_version": None,
        "download_url": None,
        "release_url": DEFAULT_RELEASE_PAGE,
        "release_name": None,
        "error": None,
    }
    if not check_enabled:
        return base

    release = fetch_latest_release(force=force)
    if not release:
        return {**base, "error": "offline"}

    latest = release.get("latest_version")
    if not latest:
        return {**base, "error": "no_version"}

    update = is_newer_version(str(latest), current)
    return {
        **base,
        "latest_version": latest,
        "download_url": release.get("download_url"),
        "release_url": release.get("release_url") or DEFAULT_RELEASE_PAGE,
        "release_name": release.get("release_name"),
        "update_available": update,
    }
