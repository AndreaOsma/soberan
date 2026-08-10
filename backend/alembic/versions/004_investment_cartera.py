"""Add cartera field to investments

Revision ID: 004_investment_cartera
Revises: 003_vehicle_fields
Create Date: 2026-07-10
"""
from alembic import op
import sqlalchemy as sa

revision = '004_investment_cartera'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('investments') as batch_op:
        batch_op.add_column(sa.Column('cartera', sa.String(), nullable=True, server_default=''))


def downgrade():
    with op.batch_alter_table('investments') as batch_op:
        batch_op.drop_column('cartera')
