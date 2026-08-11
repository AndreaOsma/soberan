"""Add vehicle fields to properties table

Revision ID: 003
Revises: 002
Create Date: 2026-07-10
"""
from alembic import op
import sqlalchemy as sa

revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('properties', sa.Column('marca', sa.String(), nullable=True))
    op.add_column('properties', sa.Column('modelo', sa.String(), nullable=True))
    op.add_column('properties', sa.Column('anio', sa.Integer(), nullable=True))
    op.add_column('properties', sa.Column('matricula', sa.String(), nullable=True))
    op.add_column('properties', sa.Column('bastidor', sa.String(), nullable=True))
    op.add_column('properties', sa.Column('color', sa.String(), nullable=True))
    op.add_column('properties', sa.Column('km', sa.Integer(), nullable=True))
    op.add_column('properties', sa.Column('estado_notas', sa.String(), nullable=True))
    op.add_column('properties', sa.Column('valor_actualizado_en', sa.String(), nullable=True))


def downgrade() -> None:
    for col in ['marca', 'modelo', 'anio', 'matricula', 'bastidor', 'color', 'km', 'estado_notas', 'valor_actualizado_en']:
        op.drop_column('properties', col)
