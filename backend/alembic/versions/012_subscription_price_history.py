"""Add historial_precios to recurring_entries (subscription price tiers)

Revision ID: 012_subscription_price_history
Revises: 011_recurring_entry_end
Create Date: 2026-07-20
"""
from alembic import op
import sqlalchemy as sa

revision = "012_subscription_price_history"
down_revision = "011_recurring_entry_end"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("recurring_entries") as batch_op:
        batch_op.add_column(sa.Column("historial_precios", sa.String(), nullable=True))


def downgrade():
    with op.batch_alter_table("recurring_entries") as batch_op:
        batch_op.drop_column("historial_precios")
