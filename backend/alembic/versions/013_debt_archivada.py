"""Add archivada flag to debts (auto-archive when paid off)

Revision ID: 013_debt_archivada
Revises: 012_subscription_price_history
Create Date: 2026-07-20
"""
from alembic import op
import sqlalchemy as sa

revision = "013_debt_archivada"
down_revision = "012_subscription_price_history"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("debts") as batch_op:
        batch_op.add_column(sa.Column("archivada", sa.Boolean(), nullable=False, server_default=sa.false()))

    # Backfill: debts already paid off
    op.execute(
        """
        UPDATE debts
        SET archivada = 1
        WHERE COALESCE(monto_total, 0) - COALESCE(monto_pagado, 0) <= 0.01
        """
    )


def downgrade():
    with op.batch_alter_table("debts") as batch_op:
        batch_op.drop_column("archivada")
