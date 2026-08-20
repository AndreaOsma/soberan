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
    # Plain add_column, not batch_alter_table — see 013_debt_archivada.py.
    op.add_column("transactions", sa.Column("es_interna", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("transactions", sa.Column("transfer_pair_id", sa.Integer(), nullable=True))
    op.add_column("transactions", sa.Column("es_pending", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("accounts", sa.Column("last_sync_error", sa.String(), nullable=True))


def downgrade():
    op.drop_column("accounts", "last_sync_error")
    op.drop_column("transactions", "es_pending")
    op.drop_column("transactions", "transfer_pair_id")
    op.drop_column("transactions", "es_interna")
