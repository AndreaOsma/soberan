"""Feedback widget: local-first-aware, unlike riffbase's (dev/apps/riffbase/
backend/modules/feedback.py), which this mirrors in spirit.

Almost every soberan install (Docker self-host, desktop, mobile) is run by a
stranger with zero server-side secrets — there's no single server everyone
talks to. So instead of holding a Resend/Gitea token locally (which would
ship it inside every publicly downloaded .exe/.dmg/.apk/Docker image), every
non-hosted install *forwards* the submission, server-to-server (no CORS,
no browser exposure), to Andrea's own hosted instance. That one instance is
the only one with SOBERAN_FEEDBACK_* secrets configured (injected via Vault,
same pattern as kraken_api.py / gocardless_bank_api.py) and does the actual
email + Gitea-issue work — see handle_feedback_intake() below.

Both the forward and the intake are best-effort and silent on failure: a
stranger's offline desktop app must never surface an error just because this
optional, click-to-send feature couldn't reach the internet.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import secrets as _secrets
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html import escape as _escape
from typing import Any, Optional

import requests

logger = logging.getLogger("soberan.feedback")

DEFAULT_FORWARD_URL = "https://soberan.andreaosma.com/feedback"

FEEDBACK_EMAIL = os.environ.get("SOBERAN_FEEDBACK_EMAIL", "").strip()
FEEDBACK_GITEA_URL = (
    os.environ.get("SOBERAN_FEEDBACK_GITEA_URL", "").strip().rstrip("/") or "https://gitea.andreaosma.com"
)
FEEDBACK_GITEA_REPO = os.environ.get("SOBERAN_FEEDBACK_GITEA_REPO", "").strip() or "andrea/soberan"
FEEDBACK_GITEA_TOKEN = os.environ.get("SOBERAN_FEEDBACK_GITEA_TOKEN", "").strip()
FORWARD_URL = os.environ.get("SOBERAN_FEEDBACK_URL", "").strip() or DEFAULT_FORWARD_URL

MAX_IMAGES = 3
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_MESSAGE_CHARS = 4000

_TYPE_LABELS = {
    "bug": "🐛 Bug",
    "idea": "💡 Idea",
    "ui": "🎨 Diseño/UX",
    "other": "💬 Otro",
}

_EXT_BY_MIME = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
}

# Simple in-memory sliding-window limiter for the hosted intake — the one
# endpoint that's genuinely public/unauthenticated (every other install just
# forwards to it, so abuse anywhere else is self-inflicted). No new
# dependency for one endpoint; resets on process restart, which is fine for
# a single hosted instance with no shared state to worry about.
_RATE_WINDOW_SEC = 3600
_RATE_MAX_PER_IP = 10
_rate_hits: dict[str, list[float]] = {}


def rate_limited(client_ip: str) -> bool:
    now = time.time()
    hits = [t for t in _rate_hits.get(client_ip, []) if now - t < _RATE_WINDOW_SEC]
    hits.append(now)
    _rate_hits[client_ip] = hits
    return len(hits) > _RATE_MAX_PER_IP


def is_hosted_intake() -> bool:
    """True only on Andrea's own deployment — the one instance with real
    secrets configured. Every other install forwards instead of handling."""
    return bool(FEEDBACK_GITEA_TOKEN or FEEDBACK_EMAIL)


def _decode_data_url(data_url: str) -> Optional[tuple[str, bytes]]:
    if not data_url.startswith("data:"):
        return None
    try:
        header, b64 = data_url.split(",", 1)
        mime = header[5:].split(";")[0] or "image/png"
        raw = base64.b64decode(b64)
    except Exception:
        return None
    return mime, raw


def _upload_image(mime: str, raw: bytes) -> Optional[str]:
    """Commits an attached screenshot straight into the feedback repo via
    Gitea's contents API — same approach as riffbase's upload_feedback_image."""
    ext = _EXT_BY_MIME.get(mime.lower(), "png")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = f"feedback-attachments/{stamp}-{_secrets.token_hex(4)}.{ext}"
    payload = json.dumps(
        {"content": base64.b64encode(raw).decode("ascii"), "message": f"feedback: attach {path}"}
    ).encode("utf-8")
    url = f"{FEEDBACK_GITEA_URL}/api/v1/repos/{FEEDBACK_GITEA_REPO}/contents/{path}"
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"token {FEEDBACK_GITEA_TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "soberan-backend/1.0 (+https://soberan.andreaosma.com)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            return (data.get("content") or {}).get("download_url")
    except urllib.error.HTTPError as e:
        logger.error("feedback image upload %s: %s", e.code, e.read()[:300])
        return None
    except Exception as e:  # noqa: BLE001 - network hiccup, never break the request
        logger.error("feedback image upload failed: %s", e)
        return None


def _context_lines(context: dict[str, Any]) -> list[str]:
    return [
        f"App version: {context.get('app_version') or '(unknown)'}",
        f"Platform: {context.get('platform') or '(unknown)'}",
        f"Locale: {context.get('locale') or '(unknown)'}",
    ]


def _send_email(message: str, feedback_type: str, context: dict[str, Any], image_urls: list[str]) -> None:
    if not FEEDBACK_EMAIL:
        return
    from .mailer import branded_email_html, send_email  # local import: optional dep on hosted-only module

    type_label = _TYPE_LABELS.get(feedback_type, _TYPE_LABELS["other"])
    ctx = _context_lines(context)
    images_html = "".join(
        f'<br/><img src="{_escape(u)}" style="max-width:100%;border-radius:8px;margin-top:8px;" />'
        for u in image_urls
    )
    send_email(
        to=FEEDBACK_EMAIL,
        subject=f"[Feedback] {type_label} — Soberan",
        html=branded_email_html(
            eyebrow=f"Beta feedback · {type_label}",
            title="New feedback from Soberan",
            body=(
                f"{_escape(message).replace(chr(10), '<br/>')}"
                f"{images_html}"
                f"<br/><br/><span style=\"color:#71717a;font-size:13px;\">"
                f"{'<br/>'.join(_escape(l) for l in ctx)}</span>"
            ),
            cta_label="Ver repositorio",
            cta_url="https://github.com/AndreaOsma/soberan",
            tagline="Tu dinero, tus reglas.",
        ),
        text=message + "\n\n" + "\n".join(ctx) + ("\n\n" + "\n".join(image_urls) if image_urls else ""),
    )


def _create_gitea_issue(message: str, feedback_type: str, context: dict[str, Any], image_urls: list[str]) -> Optional[str]:
    if not FEEDBACK_GITEA_TOKEN:
        return None
    type_label = _TYPE_LABELS.get(feedback_type, _TYPE_LABELS["other"])
    ctx = [f"Type: {type_label}", *_context_lines(context)]
    body = message.strip() + "\n\n---\n" + "\n".join(f"- {l}" for l in ctx)
    if image_urls:
        body += "\n\n" + "\n\n".join(f"![attachment]({u})" for u in image_urls)
    first_line = message.strip().splitlines()[0][:80] if message.strip() else ""
    title_prefix = f"[Beta feedback] [{type_label}] Soberan"
    title = f"{title_prefix}: {first_line}" if first_line else title_prefix
    payload = json.dumps({"title": title, "body": body, "labels": []}).encode("utf-8")
    url = f"{FEEDBACK_GITEA_URL}/api/v1/repos/{FEEDBACK_GITEA_REPO}/issues"
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"token {FEEDBACK_GITEA_TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "soberan-backend/1.0 (+https://soberan.andreaosma.com)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data.get("html_url")
    except urllib.error.HTTPError as e:
        logger.error("Gitea issue creation %s: %s", e.code, e.read()[:300])
        return None
    except Exception as e:  # noqa: BLE001 - network hiccup, never break the request
        logger.error("Gitea issue creation failed: %s", e)
        return None


def handle_feedback_intake(message: str, feedback_type: str, images: list[str], context: dict[str, Any]) -> dict[str, Any]:
    """Only ever called on the hosted instance (is_hosted_intake() True) —
    does the actual email + Gitea-issue work, same shape as riffbase's."""
    image_urls: list[str] = []
    for data_url in images[:MAX_IMAGES]:
        decoded = _decode_data_url(data_url)
        if not decoded:
            continue
        mime, raw = decoded
        if not mime.startswith("image/") or len(raw) > MAX_IMAGE_BYTES:
            continue
        uploaded = _upload_image(mime, raw)
        if uploaded:
            image_urls.append(uploaded)

    _send_email(message, feedback_type, context, image_urls)
    issue_url = _create_gitea_issue(message, feedback_type, context, image_urls)
    return {"ok": True, "issue_url": issue_url}


def forward_feedback(message: str, feedback_type: str, images: list[str], context: dict[str, Any]) -> dict[str, Any]:
    """Called on every non-hosted install: relay to Andrea's instance,
    server-to-server so there's no CORS/browser exposure and no hardcoded
    external URL baked into the shipped frontend bundle. Bounded timeout,
    always returns an ok-shaped result even on failure — offline is not an
    error for this feature."""
    try:
        resp = requests.post(
            FORWARD_URL,
            json={"message": message, "type": feedback_type, "images": images, "context": context},
            timeout=8,
        )
        if resp.ok:
            return resp.json()
        logger.info("feedback forward to %s: HTTP %s", FORWARD_URL, resp.status_code)
    except Exception as e:  # noqa: BLE001 - offline/unreachable is expected, not an error
        logger.info("feedback forward failed (likely offline): %s", e)
    return {"ok": True, "issue_url": None}


def submit_feedback(message: str, feedback_type: str, images: list[str], context: dict[str, Any]) -> dict[str, Any]:
    message = (message or "").strip()[:MAX_MESSAGE_CHARS]
    feedback_type = feedback_type if feedback_type in _TYPE_LABELS else "other"
    if is_hosted_intake():
        return handle_feedback_intake(message, feedback_type, images, context)
    return forward_feedback(message, feedback_type, images, context)
