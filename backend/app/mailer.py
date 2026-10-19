"""Minimal transactional email via Resend's REST API (no SDK dependency).

Ported from riffbase's backend/modules/mailer.py — same provider, same
plain-urllib approach. Only ever used by feedback.py on the hosted instance
(SOBERAN_RESEND_API_KEY is unset everywhere else, same gating as Kraken/
GoCardless secrets).
"""
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request

logger = logging.getLogger("soberan.mailer")

RESEND_URL = "https://api.resend.com/emails"
RESEND_API_KEY = os.environ.get("SOBERAN_RESEND_API_KEY", "").strip()
RESEND_FROM = os.environ.get("SOBERAN_RESEND_FROM", "").strip() or "soberan <hello@soberan.andreaosma.com>"


def branded_email_html(
    *,
    eyebrow: str,
    title: str,
    body: str,
    cta_label: str,
    cta_url: str,
    tagline: str,
    lang: str = "es",
) -> str:
    return f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>soberan</title>
</head>
<body style="margin:0;padding:0;background:#05070a;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05070a;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0c1017;border:1px solid rgba(255,255,255,0.08);border-radius:20px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 8px;border-bottom:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:26px;font-weight:800;letter-spacing:-0.06em;color:#fff;">soberan</div>
              <div style="margin-top:6px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#7dd3fc;">{eyebrow}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 14px;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-0.03em;color:#fff;">{title}</h1>
              <p style="margin:0 0 22px;font-size:16px;line-height:1.55;color:#a1a1aa;">{body}</p>
              <a href="{cta_url}" style="display:inline-block;padding:12px 18px;background:#007aff;color:#fff;text-decoration:none;border-radius:12px;font-size:14px;font-weight:700;">{cta_label}</a>
            </td>
          </tr>
        </table>
        <p style="margin:18px 0 0;font-size:11px;color:#52525b;">{tagline}</p>
      </td>
    </tr>
  </table>
</body>
</html>"""


def send_email(to: str, subject: str, html: str, text: str) -> bool:
    """Best-effort send. Returns False (and logs) on any failure — callers
    should not let a mail-provider outage break the calling request."""
    if not RESEND_API_KEY:
        logger.warning("SOBERAN_RESEND_API_KEY not set — skipping email to %s", to)
        return False
    payload = json.dumps(
        {"from": RESEND_FROM, "to": [to], "subject": subject, "html": html, "text": text}
    ).encode("utf-8")
    req = urllib.request.Request(
        RESEND_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
            # Resend sits behind Cloudflare, which bot-blocks (403, CF error
            # 1010) urllib's default "Python-urllib/x.y" User-Agent.
            "User-Agent": "soberan-backend/1.0 (+https://soberan.andreaosma.com)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if 200 <= resp.status < 300:
                return True
            logger.error("Resend %s sending to %s: %s", resp.status, to, resp.read()[:300])
            return False
    except urllib.error.HTTPError as e:
        logger.error("Resend %s sending to %s: %s", e.code, to, e.read()[:300])
        return False
    except Exception as e:  # noqa: BLE001 - network/DNS/timeout, never let mail break the request
        logger.error("Resend send to %s failed: %s", to, e)
        return False
