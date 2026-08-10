"""Add debt_installments table for creditor payment schedules

Revision ID: 010_debt_installments
Revises: 009_unify_ahorro_inversion
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "010_debt_installments"
down_revision = "009_unify_ahorro_inversion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "debt_installments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("debt_id", sa.Integer(), sa.ForeignKey("debts.id"), nullable=False),
        sa.Column("numero_cuota", sa.Integer(), nullable=False),
        sa.Column("fecha_vencimiento", sa.String(), nullable=False),
        sa.Column("capital", sa.Float(), nullable=True),
        sa.Column("interes", sa.Float(), nullable=True),
        sa.Column("cuota_total", sa.Float(), nullable=False),
        sa.Column("saldo_pendiente", sa.Float(), nullable=True),
        sa.Column("pagada", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("notas", sa.String(), nullable=True),
    )
    op.create_index("ix_debt_installments_debt_id", "debt_installments", ["debt_id"])


def downgrade() -> None:
    op.drop_index("ix_debt_installments_debt_id", table_name="debt_installments")
    op.drop_table("debt_installments")
