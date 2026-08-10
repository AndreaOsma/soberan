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
    with op.batch_alter_table("debts") as batch_op:
        batch_op.add_column(sa.Column("goal_id", sa.Integer(), nullable=True))

    with op.batch_alter_table("recurring_entries") as batch_op:
        batch_op.add_column(sa.Column("goal_id", sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table("recurring_entries") as batch_op:
        batch_op.drop_column("goal_id")

    with op.batch_alter_table("debts") as batch_op:
        batch_op.drop_column("goal_id")
