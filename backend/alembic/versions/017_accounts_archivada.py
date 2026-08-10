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
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.add_column(sa.Column("archivada", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.drop_column("archivada")
