"""CSV bundle export/import helpers for native sync providers."""
from __future__ import annotations

import csv
import io
import re
import zipfile
from datetime import datetime
from typing import Any, Dict

from sqlalchemy.orm import Session

from . import models
from .csv_coerce import coerce_field

CSV_TABLE_MODELS: Dict[str, Any] = {
    "accounts": models.Account,
    "transactions": models.Transaction,
    "transaction-splits": models.TransactionSplit,
    "goals": models.Goal,
    "debts": models.Debt,
    "debt-payments": models.DebtPayment,
    "debt-installments": models.DebtInstallment,
    "properties": models.Property,
    "money-owed": models.MoneyOwed,
    "investments": models.Investment,
    "cards": models.Card,
    "subscriptions": models.Subscription,
    "work-history": models.WorkHistory,
    "salary-breakdown": models.SalaryBreakdown,
    "recurring-entries": models.RecurringEntry,
    "monthly-budgets": models.MonthlyBudget,
    "wishlist-items": models.WishlistItem,
}

CSV_TABLE_SLUGS: Dict[str, str] = {
    "accounts": "cuentas",
    "transactions": "transacciones",
    "transaction-splits": "gastos-compartidos",
    "recurring-entries": "partidas-recurrentes",
    "monthly-budgets": "presupuestos-mensuales",
    "goals": "objetivos",
    "debts": "deudas",
    "debt-payments": "pagos-deuda",
    "debt-installments": "cuotas-deuda",
    "investments": "inversiones",
    "properties": "activos-fijos",
    "money-owed": "dinero-prestado",
    "cards": "tarjetas",
    "subscriptions": "suscripciones",
    "wishlist-items": "lista-deseos",
    "work-history": "historial-laboral",
    "salary-breakdown": "desglose-nomina",
}


def csv_bytes_for_table(db: Session, table: str) -> bytes:
    model = CSV_TABLE_MODELS[table]
    rows = db.query(model).all()
    columns = [c.name for c in model.__table__.columns]
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=columns)
    writer.writeheader()
    for row in rows:
        writer.writerow({name: getattr(row, name) for name in columns})
    return ("\ufeff" + stream.getvalue()).encode("utf-8")


def export_bundle_bytes(db: Session) -> bytes:
    stamp = datetime.utcnow().strftime("%Y-%m-%d")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for table in CSV_TABLE_MODELS:
            slug = CSV_TABLE_SLUGS.get(table, table)
            zf.writestr(f"soberan-{slug}-{stamp}.csv", csv_bytes_for_table(db, table))
    return buf.getvalue()


_MEMBER_NAME_RE = re.compile(r"^soberan-(?P<slug>.+)-\d{4}-\d{2}-\d{2}\.csv$", re.IGNORECASE)


def import_bundle_replace(db: Session, payload: bytes) -> dict[str, int]:
    loaded: dict[str, int] = {}
    with zipfile.ZipFile(io.BytesIO(payload), "r") as zf:
        table_for_slug = {v: k for k, v in CSV_TABLE_SLUGS.items()}
        members = [name for name in zf.namelist() if name.lower().endswith(".csv")]
        for member in members:
            stem = member.rsplit("/", 1)[-1]
            # Slugs can contain dashes themselves (e.g. "activos-fijos"), and so does the
            # date stamp in the filename — splitting on "-" and taking the middle parts
            # (the old approach) breaks the moment the stamp has its own dashes, which it
            # always does ("soberan-cuentas-2026-08-15.csv" splits into 5 parts, not 3).
            # Anchoring on the date pattern at the end is unambiguous regardless of how
            # many dashes the slug has.
            match = _MEMBER_NAME_RE.match(stem)
            if not match:
                continue
            slug = match.group("slug")
            table = table_for_slug.get(slug)
            if not table:
                continue
            model = CSV_TABLE_MODELS[table]
            columns = {c.name: c for c in model.__table__.columns}
            raw = zf.read(member).decode("utf-8-sig")
            db.query(model).delete()
            inserted = 0
            for row in csv.DictReader(io.StringIO(raw)):
                # Keep the original id, don't strip it: several tables reference each
                # other by id (Transaction.account_id, DebtPayment.debt_id,
                # TransactionSplit.transaction_id, ...) — assigning fresh sequential ids
                # here silently repoints every one of those relationships at whatever
                # row happens to land on the old id after a delete-and-reinsert, which is
                # wrong the moment any row was ever deleted before export (any real usage
                # history). SQLite accepts an explicit id on an INTEGER PRIMARY KEY and
                # keeps auto-assigning past the highest one seen, so this doesn't collide
                # with rows created normally afterwards.
                fields = {}
                for name, value in row.items():
                    if name not in columns:
                        continue
                    coerced = coerce_field(columns[name], value)
                    if coerced is not None:
                        fields[name] = coerced
                db.add(model(**fields))
                inserted += 1
            loaded[table] = inserted
    db.commit()
    return loaded
