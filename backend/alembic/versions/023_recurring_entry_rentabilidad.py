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
    # Plain add_column, not batch_alter_table — see 013_debt_archivada.py.
    op.add_column("recurring_entries", sa.Column("rentabilidad_anual_pct", sa.Float(), nullable=True))


def downgrade():
    op.drop_column("recurring_entries", "rentabilidad_anual_pct")
