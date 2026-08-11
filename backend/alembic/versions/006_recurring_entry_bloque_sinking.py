"""Add bloque, objetivo_monto, objetivo_fecha to recurring_entries

Revision ID: 006_recurring_entry_bloque_sinking
Revises: 005_monthly_budget_excluido
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa

revision = '006_recurring_entry_bloque_sinking'
down_revision = '005_monthly_budget_excluido'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('recurring_entries') as batch_op:
        batch_op.add_column(sa.Column('bloque', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('objetivo_monto', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('objetivo_fecha', sa.String(), nullable=True))


def downgrade():
    with op.batch_alter_table('recurring_entries') as batch_op:
        batch_op.drop_column('objetivo_fecha')
        batch_op.drop_column('objetivo_monto')
        batch_op.drop_column('bloque')
