"""Add excluido field to monthly_budgets

Revision ID: 005_monthly_budget_excluido
Revises: 004_investment_cartera
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa

revision = '005_monthly_budget_excluido'
down_revision = '004_investment_cartera'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('monthly_budgets') as batch_op:
        batch_op.add_column(sa.Column('excluido', sa.Boolean(), nullable=False, server_default='0'))


def downgrade():
    with op.batch_alter_table('monthly_budgets') as batch_op:
        batch_op.drop_column('excluido')
