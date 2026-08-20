"""Add goal_id to debts and recurring_entries

Revision ID: 015_goal_id_links
Revises: 014_wishlist_archive
Create Date: 2026-07-21

"""
from alembic import op
import sqlalchemy as sa

revision = "015_goal_id_links"
down_revision = "014_wishlist_archive"
branch_labels = None
depends_on = None


def upgrade():
    # Plain add_column, not batch_alter_table — see 013_debt_archivada.py for the full
    # explanation (CircularDependencyError from batch mode's table-recreate/reorder path,
    # confirmed on a real on-device DB; plain adds don't need that path at all).
    op.add_column("debts", sa.Column("goal_id", sa.Integer(), nullable=True))
    op.add_column("recurring_entries", sa.Column("goal_id", sa.Integer(), nullable=True))


def downgrade():
    op.drop_column("recurring_entries", "goal_id")
    op.drop_column("debts", "goal_id")
