"""Bank Open Banking sync health → alert findings."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session


def build_bank_sync_alert(db: Session, now: Optional[datetime] = None) -> Optional[dict[str, Any]]:
    """One alert when linked (non-archived) accounts are stale, errored, or need reauth."""
    from app import models

    ref = now or datetime.utcnow()
    linked = (
        db.query(models.Account)
        .filter(
            models.Account.gocardless_account_id.isnot(None),
            models.Account.archivada.is_(False),
        )
        .all()
    )
    if not linked:
        return None

    stale_count = 0
    error_count = 0
    sample_error = None
    for acc in linked:
        if acc.last_sync_at:
            stale = (ref - acc.last_sync_at).total_seconds() > 86400
        else:
            stale = True
        if stale:
            stale_count += 1
        if acc.last_sync_error:
            error_count += 1
            if sample_error is None:
                sample_error = (acc.last_sync_error or "")[:120]

    reauth_count = 0
    for req in db.query(models.BankRequisition).all():
        status = (req.status or "").upper()
        if status in {"EX", "RJ", "REJECTED", "EXPIRED"}:
            reauth_count += 1

    if stale_count == 0 and error_count == 0 and reauth_count == 0:
        return None

    parts: list[str] = []
    if reauth_count > 0:
        parts.append(
            f"consentimiento bancario caducado ({reauth_count} conexión"
            f"{'es' if reauth_count != 1 else ''})"
        )
    if stale_count > 0:
        parts.append(
            f"{stale_count} cuenta{'s' if stale_count != 1 else ''} sin sync en las últimas 24 h"
        )
    if error_count > 0:
        err_bit = f" (p. ej. {sample_error})" if sample_error else ""
        parts.append(
            f"{error_count} cuenta{'s' if error_count != 1 else ''} fallaron al sincronizar{err_bit}"
        )

    severity = "alta" if reauth_count > 0 else "media" if error_count > 0 else "baja"
    return {
        "tipo": "sync_bancaria",
        "severidad": severity,
        "mensaje": "Open Banking: " + "; ".join(parts) + ".",
        "id": None,
    }
