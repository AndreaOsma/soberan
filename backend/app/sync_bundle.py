"""CSV bundle export/import helpers for native sync providers."""
from __future__ import annotations

import io
import zipfile
from datetime import datetime
from typing import Any, Dict

import pandas as pd
from sqlalchemy.orm import Session

from . import models

CSV_TABLE_MODELS: Dict[str, Any] = {
    "accounts": models.Account,
    "transactions": models.Transaction,
    "goals": models.Goal,
    "debts": models.Debt,
    "properties": models.Property,
    "investments": models.Investment,
    "work-history": models.WorkHistory,
    "salary-breakdown": models.SalaryBreakdown,
    "recurring-entries": models.RecurringEntry,
}

CSV_TABLE_SLUGS: Dict[str, str] = {
    "accounts": "cuentas",
    "transactions": "transacciones",
    "recurring-entries": "partidas-recurrentes",
    "goals": "objetivos",
    "debts": "deudas",
    "investments": "inversiones",
    "properties": "activos-fijos",
    "work-history": "historial-laboral",
    "salary-breakdown": "desglose-nomina",
}


def csv_bytes_for_table(db: Session, table: str) -> bytes:
    model = CSV_TABLE_MODELS[table]
    rows = db.query(model).all()
    df = pd.DataFrame([{c.name: getattr(q, c.name) for c in q.__table__.columns} for q in rows])
    stream = io.StringIO()
    df.to_csv(stream, index=False)
    return ("\ufeff" + stream.getvalue()).encode("utf-8")


def export_bundle_bytes(db: Session) -> bytes:
    stamp = datetime.utcnow().strftime("%Y-%m-%d")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for table in CSV_TABLE_MODELS:
            slug = CSV_TABLE_SLUGS.get(table, table)
            zf.writestr(f"soberan-{slug}-{stamp}.csv", csv_bytes_for_table(db, table))
    return buf.getvalue()


def import_bundle_replace(db: Session, payload: bytes) -> dict[str, int]:
    loaded: dict[str, int] = {}
    with zipfile.ZipFile(io.BytesIO(payload), "r") as zf:
        table_for_slug = {v: k for k, v in CSV_TABLE_SLUGS.items()}
        members = [name for name in zf.namelist() if name.lower().endswith(".csv")]
        for member in members:
            stem = member.rsplit("/", 1)[-1]
            parts = stem.split("-")
            if len(parts) < 3:
                continue
            slug = "-".join(parts[1:-1])
            table = table_for_slug.get(slug)
            if not table:
                continue
            model = CSV_TABLE_MODELS[table]
            raw = zf.read(member)
            df = pd.read_csv(io.BytesIO(raw))
            db.query(model).delete()
            inserted = 0
            for _, row in df.iterrows():
                rd = row.to_dict()
                if "id" in rd:
                    del rd["id"]
                for c in ("date", "fecha_inicio", "fecha_fin"):
                    if c in rd and pd.notnull(rd[c]):
                        try:
                            rd[c] = pd.to_datetime(rd[c])
                        except (ValueError, TypeError):
                            pass
                db_i = model(**{k: v for k, v in rd.items() if pd.notnull(v)})
                db.add(db_i)
                inserted += 1
            loaded[table] = inserted
    db.commit()
    return loaded
