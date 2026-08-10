"""Add transaction_splits for shared expenses among N people

Revision ID: 021_transaction_splits
Revises: 020_transaction_excluida_presupuesto
Create Date: 2026-07-29
"""
from alembic import op
import sqlalchemy as sa

revision = "021_transaction_splits"
down_revision = "020_transaction_excluida_presupuesto"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "transaction_splits",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("transaction_id", sa.Integer(), sa.ForeignKey("transactions.id"), nullable=False),
        sa.Column("person_name", sa.String(), nullable=False, server_default=""),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("is_me", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("settled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_transaction_splits_transaction_id", "transaction_splits", ["transaction_id"])


def downgrade() -> None:
    op.drop_index("ix_transaction_splits_transaction_id", table_name="transaction_splits")
    op.drop_table("transaction_splits")
