"""Transaction bank sync enhancements: internal transfers, pending, sync errors

Revision ID: 019_transaction_bank_enhancements
Revises: 018_accounts_oculta
Create Date: 2026-07-28

"""
from alembic import op
import sqlalchemy as sa

revision = "019_transaction_bank_enhancements"
down_revision = "018_accounts_oculta"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("transactions") as batch_op:
        batch_op.add_column(sa.Column("es_interna", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("transfer_pair_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("es_pending", sa.Boolean(), nullable=False, server_default=sa.false()))
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.add_column(sa.Column("last_sync_error", sa.String(), nullable=True))


def downgrade():
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.drop_column("last_sync_error")
    with op.batch_alter_table("transactions") as batch_op:
        batch_op.drop_column("es_pending")
        batch_op.drop_column("transfer_pair_id")
        batch_op.drop_column("es_interna")
