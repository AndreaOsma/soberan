"""Bank sync tables: BankRequisition, Account.gocardless_account_id, Transaction.gocardless_tx_id

Revision ID: 002
Revises: 001
Create Date: 2026-07-07
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("gocardless_account_id", sa.String, nullable=True))
    op.add_column("accounts", sa.Column("last_sync_at", sa.DateTime, nullable=True))
    op.add_column("transactions", sa.Column("gocardless_tx_id", sa.String, nullable=True))

    op.create_table(
        "bank_requisitions",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("requisition_id", sa.String, unique=True, index=True),
        sa.Column("institution_id", sa.String),
        sa.Column("institution_name", sa.String, nullable=True),
        sa.Column("status", sa.String, default="CR"),
        sa.Column("link", sa.String, nullable=True),
        sa.Column("reference", sa.String, nullable=True),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
    )


def downgrade() -> None:
    op.drop_table("bank_requisitions")
    op.drop_column("transactions", "gocardless_tx_id")
    op.drop_column("accounts", "last_sync_at")
    op.drop_column("accounts", "gocardless_account_id")
