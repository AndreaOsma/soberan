"""Add valoracion_json to properties for vehicle valuation snapshots

Revision ID: 016_property_valoracion_json
Revises: 015_goal_id_links
Create Date: 2026-07-22

"""
from alembic import op
import sqlalchemy as sa

revision = "016_property_valoracion_json"
down_revision = "015_goal_id_links"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("properties") as batch_op:
        batch_op.add_column(sa.Column("valoracion_json", sa.Text(), nullable=True))


def downgrade():
    with op.batch_alter_table("properties") as batch_op:
        batch_op.drop_column("valoracion_json")
