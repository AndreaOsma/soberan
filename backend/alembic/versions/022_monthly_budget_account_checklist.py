"""Add account checklist fields to monthly_budgets

Revision ID: 022_monthly_budget_account_checklist
Revises: 021_transaction_splits
Create Date: 2026-07-30
"""
from alembic import op
import sqlalchemy as sa

revision = "022_monthly_budget_account_checklist"
down_revision = "021_transaction_splits"
branch_labels = None
depends_on = None


def upgrade():
    # Plain add_column, not batch_alter_table — see 013_debt_archivada.py.
    op.add_column("monthly_budgets", sa.Column("cuenta_gestion_id", sa.Integer(), nullable=True))
    op.add_column(
        "monthly_budgets",
        sa.Column("movido_a_cuenta", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("monthly_budgets", sa.Column("movido_checked_at", sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column("monthly_budgets", "movido_checked_at")
    op.drop_column("monthly_budgets", "movido_a_cuenta")
    op.drop_column("monthly_budgets", "cuenta_gestion_id")
