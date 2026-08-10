"""Unify ahorro and inversion recurring entry types

Revision ID: 009_unify_ahorro_inversion
Revises: 008_legacy_column_parity
Create Date: 2026-07-13
"""
from alembic import op

revision = "009_unify_ahorro_inversion"
down_revision = "008_legacy_column_parity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE recurring_entries SET tipo_partida = 'ahorro_inversion' "
        "WHERE tipo_partida IN ('ahorro', 'inversion')"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE recurring_entries SET tipo_partida = 'ahorro' "
        "WHERE tipo_partida = 'ahorro_inversion' AND cartera_destino IS NULL"
    )
    op.execute(
        "UPDATE recurring_entries SET tipo_partida = 'inversion' "
        "WHERE tipo_partida = 'ahorro_inversion' AND cartera_destino IS NOT NULL"
    )
