"""Helpers for shared expense splits and budget "my share" amounts."""
from __future__ import annotations

from typing import Any, Sequence


def _split_rows(tx: Any) -> Sequence[Any]:
    rows = getattr(tx, "splits", None) or []
    return list(rows)


def counts_in_budget(tx: Any) -> bool:
    if getattr(tx, "es_interna", False) or getattr(tx, "es_pending", False):
        return False
    if getattr(tx, "excluida_presupuesto", False):
        return False
    return True


def budget_expense_amount(tx: Any) -> float:
    """Amount that counts toward budget spent (0 if not a real expense).

    When splits exist, only the ``is_me`` share counts. Bank balance keeps full amount.
    """
    if not counts_in_budget(tx):
        return 0.0
    amount = float(getattr(tx, "amount", 0) or 0)
    if amount >= 0:
        return 0.0
    splits = _split_rows(tx)
    if not splits:
        return abs(amount)
    me = next((s for s in splits if getattr(s, "is_me", False)), None)
    if me is None:
        return abs(amount)
    return max(0.0, float(getattr(me, "amount", 0) or 0))


def validate_split_payload(tx_amount: float, splits: list[dict]) -> list[dict]:
    """Normalize and validate split rows. Empty list clears splits.

    Each row: person_name, amount (>0), is_me, settled.
    Requires exactly one is_me when non-empty; sum ≈ abs(tx_amount).
    """
    if float(tx_amount) >= 0 and splits:
        raise ValueError("Solo se pueden dividir gastos (importe negativo).")
    if not splits:
        return []

    normalized: list[dict] = []
    me_count = 0
    total = 0.0
    for raw in splits:
        amount = float(raw.get("amount") or 0)
        if amount <= 0:
            raise ValueError("Cada parte debe ser un importe positivo.")
        is_me = bool(raw.get("is_me"))
        if is_me:
            me_count += 1
        name = str(raw.get("person_name") or "").strip()
        if is_me and not name:
            name = "Yo"
        if not is_me and not name:
            raise ValueError("Indica el nombre de cada persona (salvo tu parte).")
        settled = bool(raw.get("settled")) if not is_me else False
        normalized.append({
            "person_name": name,
            "amount": round(amount, 2),
            "is_me": is_me,
            "settled": settled,
        })
        total += amount

    if me_count != 1:
        raise ValueError("Marca exactamente una fila como tu parte.")
    expected = abs(float(tx_amount))
    if abs(total - expected) > 0.02:
        raise ValueError(
            f"La suma de partes ({total:.2f}) debe coincidir con el gasto ({expected:.2f})."
        )
    return normalized


def unsettled_owed_by_person(transactions: Sequence[Any]) -> dict[str, float]:
    """Aggregate unsettled amounts others owe you, keyed by person_name."""
    owed: dict[str, float] = {}
    for tx in transactions:
        if float(getattr(tx, "amount", 0) or 0) >= 0:
            continue
        for split in _split_rows(tx):
            if getattr(split, "is_me", False):
                continue
            if getattr(split, "settled", False):
                continue
            name = (getattr(split, "person_name", None) or "").strip() or "Sin nombre"
            owed[name] = owed.get(name, 0.0) + float(getattr(split, "amount", 0) or 0)
    return owed
