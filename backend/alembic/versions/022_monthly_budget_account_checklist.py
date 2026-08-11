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
    with op.batch_alter_table("monthly_budgets") as batch_op:
        batch_op.add_column(sa.Column("cuenta_gestion_id", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column("movido_a_cuenta", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(sa.Column("movido_checked_at", sa.DateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table("monthly_budgets") as batch_op:
        batch_op.drop_column("movido_checked_at")
        batch_op.drop_column("movido_a_cuenta")
        batch_op.drop_column("cuenta_gestion_id")
