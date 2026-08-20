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
    # Plain add_column, not batch_alter_table: SQLite supports ADD COLUMN directly for a
    # NOT NULL column with a fixed (non-function) default, no table recreation needed —
    # and batch mode's recreate-and-reorder path throws
    # sqlalchemy.exc.CircularDependencyError: Circular dependency detected.
    # ('archivada', 'goal_id') on this table specifically (debts.goal_id is a real FK to
    # goals.id, which apparently confuses batch mode's column-reordering topological
    # sort here). Confirmed via a real on-device iOS log: this migration silently failed
    # on every single app launch (never advanced past 012, never stamped 013) — the
    # column ended up added anyway (batch mode's recreate got that far before the
    # reorder step blew up) but alembic_version never moved, so every cold start
    # re-attempted the whole failing recreate, which is real, measurable slowness on a
    # populated table, not just a hypothetical.
    op.add_column("debts", sa.Column("archivada", sa.Boolean(), nullable=False, server_default=sa.false()))

    # Backfill: debts already paid off
    op.execute(
        """
        UPDATE debts
        SET archivada = 1
        WHERE COALESCE(monto_total, 0) - COALESCE(monto_pagado, 0) <= 0.01
        """
    )


def downgrade():
    op.drop_column("debts", "archivada")
