"""Add rentabilidad_anual_pct to recurring_entries

Revision ID: 023_recurring_entry_rentabilidad
Revises: 022_monthly_budget_account_checklist
Create Date: 2026-08-04
"""
from alembic import op
import sqlalchemy as sa

revision = "023_recurring_entry_rentabilidad"
down_revision = "022_monthly_budget_account_checklist"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("recurring_entries") as batch_op:
        batch_op.add_column(sa.Column("rentabilidad_anual_pct", sa.Float(), nullable=True))


def downgrade():
    with op.batch_alter_table("recurring_entries") as batch_op:
        batch_op.drop_column("rentabilidad_anual_pct")
