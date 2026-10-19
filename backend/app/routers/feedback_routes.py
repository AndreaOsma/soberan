"""Feedback widget endpoint — see ../feedback.py for the local-first design
rationale (every install forwards to Andrea's hosted instance instead of
holding secrets itself)."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..desktop_updates import get_desktop_version
from ..feedback import MAX_IMAGES, rate_limited, submit_feedback, is_hosted_intake

router = APIRouter()


class FeedbackContext(BaseModel):
    app_version: Optional[str] = None
    platform: Optional[str] = None
    locale: Optional[str] = None


class FeedbackRequest(BaseModel):
    message: str
    type: str = "other"
    images: List[str] = []
    context: Optional[FeedbackContext] = None


@router.post("/feedback")
def submit_feedback_route(payload: FeedbackRequest, request: Request):
    message = (payload.message or "").strip()
    if not message:
        return {"ok": False, "error": "empty_message"}

    if is_hosted_intake():
        client_ip = request.client.host if request.client else "unknown"
        if rate_limited(client_ip):
            # Best-effort feature: degrade quietly instead of a scary 429.
            return {"ok": True, "issue_url": None}

    context = (payload.context.model_dump() if payload.context else {}) or {}
    context.setdefault("app_version", get_desktop_version())

    return submit_feedback(message, payload.type, payload.images[:MAX_IMAGES], context)
