"""Detect and mark internal transfers between user accounts."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy.orm import Session

from . import models

INTERNAL_TRANSFER_CATEGORY = "Transferencia interna"
_TRANSFER_HINTS = ("traspaso", "transferencia", "transfer ", "trf ", "movimiento entre cuentas")


def _looks_like_transfer(description: str | None) -> bool:
    text = (description or "").lower()
    return any(hint in text for hint in _TRANSFER_HINTS)


def _amount_match(a: float, b: float, tolerance: float = 0.02) -> bool:
    return abs(abs(a) - abs(b)) <= tolerance


def _dates_close(d1, d2, max_days: int = 3) -> bool:
    if not d1 or not d2:
        return True
    return abs((d1 - d2).total_seconds()) <= max_days * 86400


def mark_internal_pair(db: Session, tx_out: models.Transaction, tx_in: models.Transaction) -> int:
    pair_id = min(tx_out.id, tx_in.id)
    for tx in (tx_out, tx_in):
        tx.es_interna = True
        tx.transfer_pair_id = pair_id
        tx.category_anon = INTERNAL_TRANSFER_CATEGORY
    return pair_id


def detect_internal_transfers(db: Session, *, days: int = 30) -> int:
    """Pair opposite-sign txs on different accounts with matching amounts."""
    from datetime import datetime

    since = datetime.utcnow() - timedelta(days=days)
    txs = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.date >= since,
            models.Transaction.es_interna.is_(False),
            models.Transaction.es_pending.is_(False),
        )
        .order_by(models.Transaction.date.desc())
        .all()
    )
    debits = [t for t in txs if float(t.amount or 0) < 0 and t.account_id]
    credits = [t for t in txs if float(t.amount or 0) > 0 and t.account_id]
    used: set[int] = set()
    pairs = 0

    for debit in debits:
        if debit.id in used:
            continue
        best: models.Transaction | None = None
        best_score = -1
        for credit in credits:
            if credit.id in used or credit.account_id == debit.account_id:
                continue
            if not _amount_match(float(debit.amount), float(credit.amount)):
                continue
            if not _dates_close(debit.date, credit.date):
                continue
            score = 2
            if _looks_like_transfer(debit.description_raw) or _looks_like_transfer(credit.description_raw):
                score += 2
            if score > best_score:
                best_score = score
                best = credit
        if best is not None:
            mark_internal_pair(db, debit, best)
            used.add(debit.id)
            used.add(best.id)
            pairs += 1

    if pairs:
        db.commit()
    return pairs


def unmark_internal(db: Session, tx_id: int) -> None:
    tx = db.query(models.Transaction).filter(models.Transaction.id == tx_id).first()
    if not tx or not tx.es_interna:
        return
    pair_id = tx.transfer_pair_id or tx.id
    related = db.query(models.Transaction).filter(
        (models.Transaction.id == pair_id) | (models.Transaction.transfer_pair_id == pair_id)
    ).all()
    for row in related:
        row.es_interna = False
        row.transfer_pair_id = None
        if (row.category_anon or "").strip() == INTERNAL_TRANSFER_CATEGORY:
            row.category_anon = ""
    db.commit()
