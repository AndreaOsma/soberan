"""Add mes_fin, anio_fin to recurring_entries (soft cancel from month)

Revision ID: 011_recurring_entry_end
Revises: 010_debt_installments
Create Date: 2026-07-20
"""
from alembic import op
import sqlalchemy as sa

revision = "011_recurring_entry_end"
down_revision = "010_debt_installments"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("recurring_entries") as batch_op:
        batch_op.add_column(sa.Column("mes_fin", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("anio_fin", sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table("recurring_entries") as batch_op:
        batch_op.drop_column("anio_fin")
        batch_op.drop_column("mes_fin")
