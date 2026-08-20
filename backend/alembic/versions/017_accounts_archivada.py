"""Add archivada flag to accounts

Revision ID: 017_accounts_archivada
Revises: 016_property_valoracion_json
Create Date: 2026-07-28

"""
from alembic import op
import sqlalchemy as sa

revision = "017_accounts_archivada"
down_revision = "016_property_valoracion_json"
branch_labels = None
depends_on = None


def upgrade():
    # Plain add_column, not batch_alter_table — see 013_debt_archivada.py.
    op.add_column("accounts", sa.Column("archivada", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("accounts", "archivada")
