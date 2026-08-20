"""Add pending_sync_ops table for offline write queueing against a private sync server

Revision ID: 024_pending_sync_ops
Revises: 023_recurring_entry_rentabilidad
Create Date: 2026-08-16
"""
from alembic import op
import sqlalchemy as sa

revision = "024_pending_sync_ops"
down_revision = "023_recurring_entry_rentabilidad"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pending_sync_ops",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("method", sa.String(), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("pending_sync_ops")
