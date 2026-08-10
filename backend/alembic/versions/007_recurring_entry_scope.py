"""Add mes_inicio, anio_inicio, es_puntual to recurring_entries

Revision ID: 007_recurring_entry_scope
Revises: 006_recurring_entry_bloque_sinking
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = '007_recurring_entry_scope'
down_revision = '006_recurring_entry_bloque_sinking'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('recurring_entries') as batch_op:
        batch_op.add_column(sa.Column('mes_inicio', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('anio_inicio', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('es_puntual', sa.Boolean(), nullable=False, server_default='0'))


def downgrade():
    with op.batch_alter_table('recurring_entries') as batch_op:
        batch_op.drop_column('es_puntual')
        batch_op.drop_column('anio_inicio')
        batch_op.drop_column('mes_inicio')
