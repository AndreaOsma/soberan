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
    # Plain add_column, not batch_alter_table — see 013_debt_archivada.py.
    op.add_column("properties", sa.Column("valoracion_json", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("properties", "valoracion_json")
