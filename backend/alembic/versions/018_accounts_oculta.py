"""Add oculta flag to accounts (hide from list without archiving)

Revision ID: 018_accounts_oculta
Revises: 017_accounts_archivada
Create Date: 2026-07-28

"""
from alembic import op
import sqlalchemy as sa

revision = "018_accounts_oculta"
down_revision = "017_accounts_archivada"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.add_column(sa.Column("oculta", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.drop_column("oculta")
