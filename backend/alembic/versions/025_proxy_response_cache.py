"""Add proxy_response_cache table for cold-start caching of live-proxied GET responses

Revision ID: 025_proxy_response_cache
Revises: 024_pending_sync_ops
Create Date: 2026-08-18
"""
from alembic import op
import sqlalchemy as sa

revision = "025_proxy_response_cache"
down_revision = "024_pending_sync_ops"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "proxy_response_cache",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("cache_key", sa.String(), nullable=False, unique=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("proxy_response_cache")
