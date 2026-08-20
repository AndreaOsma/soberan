"""Type coercion for CSV import — shared by the /export-csv|/import-csv routes and the
native sync bundle. Coerces against the model's actual declared column type instead of
guessing from CSV content (pandas' old approach here) — same result for the columns that
matter, without needing pandas just to move rows between a DB and a CSV file.
"""
from __future__ import annotations

from datetime import datetime


def coerce_field(column, raw: str):
    """Convert a raw CSV string to the Python value for a SQLAlchemy column, or None
    to signal the field should be omitted (letting the model's default apply)."""
    if raw is None or raw == "":
        return None
    py_type = column.type.python_type
    if py_type is bool:
        return raw.strip().lower() in ("true", "1", "yes", "t")
    if py_type is int:
        try:
            return int(float(raw))
        except ValueError:
            return None
    if py_type is float:
        try:
            return float(raw)
        except ValueError:
            return None
    if py_type is datetime:
        try:
            return datetime.fromisoformat(raw)
        except ValueError:
            return raw
    return raw
