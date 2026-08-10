"""Initial schema

Revision ID: 001
Revises:
Create Date: 2026-06-09

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("alias_real", sa.String),
        sa.Column("alias_anonimo", sa.String, unique=True, index=True),
        sa.Column("tipo", sa.String),
        sa.Column("balance_actual", sa.Float, default=0.0),
        sa.Column("banco", sa.String),
    )
    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("account_id", sa.Integer, sa.ForeignKey("accounts.id")),
        sa.Column("amount", sa.Float),
        sa.Column("category_anon", sa.String),
        sa.Column("description_raw", sa.String),
        sa.Column("date", sa.DateTime),
        sa.Column("tipo_meta", sa.String, nullable=True),
    )
    op.create_table(
        "goals",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("nombre", sa.String),
        sa.Column("monto_objetivo", sa.Float),
        sa.Column("monto_actual", sa.Float, default=0.0),
        sa.Column("fecha_limite", sa.DateTime, nullable=True),
    )
    op.create_table(
        "debts",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("acreedor", sa.String),
        sa.Column("monto_total", sa.Float),
        sa.Column("monto_pagado", sa.Float, default=0.0),
        sa.Column("tipo", sa.String),
        sa.Column("fecha_vencimiento", sa.DateTime, nullable=True),
        sa.Column("cuota_mensual", sa.Float, nullable=True),
        sa.Column("tasa_anual", sa.Float, nullable=True),
        sa.Column("notas", sa.String, nullable=True),
        sa.Column("dia_cargo_mensual", sa.Integer, nullable=True),
    )
    op.create_table(
        "properties",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("nombre", sa.String),
        sa.Column("valor_estimado", sa.Float),
        sa.Column("tipo", sa.String),
    )
    op.create_table(
        "money_owed",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("deudor", sa.String),
        sa.Column("monto", sa.Float),
        sa.Column("descripcion", sa.String),
        sa.Column("fecha_limite", sa.DateTime, nullable=True),
        sa.Column("pagado", sa.Boolean, default=False),
    )
    op.create_table(
        "investments",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("nombre", sa.String),
        sa.Column("monto_invertido", sa.Float),
        sa.Column("valor_actual", sa.Float),
        sa.Column("tipo", sa.String),
        sa.Column("fecha_inicio", sa.DateTime),
    )
    op.create_table(
        "recurring_entries",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("nombre", sa.String),
        sa.Column("monto_estimado", sa.Float),
        sa.Column("es_ingreso", sa.Boolean, default=False),
        sa.Column("es_fijo", sa.Boolean, default=True),
        sa.Column("categoria", sa.String),
    )
    op.create_table(
        "monthly_budgets",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("recurring_entry_id", sa.Integer, sa.ForeignKey("recurring_entries.id")),
        sa.Column("mes", sa.Integer),
        sa.Column("anio", sa.Integer),
        sa.Column("monto_real", sa.Float),
    )
    op.create_table(
        "salary_breakdown",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("mes", sa.Integer),
        sa.Column("anio", sa.Integer),
        sa.Column("bruto", sa.Float),
        sa.Column("irpf", sa.Float),
        sa.Column("ss", sa.Float),
        sa.Column("neto", sa.Float),
        sa.Column("empresa", sa.String),
        sa.Column("account_id", sa.Integer, sa.ForeignKey("accounts.id"), nullable=True),
    )
    op.create_table(
        "work_history",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("empresa", sa.String),
        sa.Column("grupo_cotizacion", sa.String),
        sa.Column("fecha_inicio", sa.DateTime),
        sa.Column("fecha_fin", sa.DateTime, nullable=True),
        sa.Column("dias_alta", sa.Integer),
    )
    op.create_table(
        "user_settings",
        sa.Column("key", sa.String, primary_key=True, index=True),
        sa.Column("value", sa.String),
    )
    op.create_table(
        "cards",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("nombre", sa.String),
        sa.Column("tipo", sa.String),
        sa.Column("banco", sa.String),
        sa.Column("limite", sa.Float, nullable=True),
    )
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("nombre", sa.String),
        sa.Column("monto", sa.Float),
        sa.Column("frecuencia", sa.String),
        sa.Column("fecha_pago", sa.Integer),
        sa.Column("mes", sa.Integer, nullable=True, default=1),
    )


def downgrade() -> None:
    for table in [
        "subscriptions", "cards", "user_settings", "work_history",
        "salary_breakdown", "monthly_budgets", "recurring_entries",
        "investments", "money_owed", "properties", "debts",
        "goals", "transactions", "accounts",
    ]:
        op.drop_table(table)
