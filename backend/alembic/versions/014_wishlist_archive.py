"""Wishlist: archivado, enlace a presupuesto y compra registrada

Revision ID: 014_wishlist_archive
Revises: 013_debt_archivada
Create Date: 2026-07-21

"""
from alembic import op
import sqlalchemy as sa

revision = "014_wishlist_archive"
down_revision = "013_debt_archivada"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("wishlist_items") as batch_op:
        batch_op.add_column(sa.Column("archivado", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("recurring_entry_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("monto_real", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("fecha_compra", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("transaction_id", sa.Integer(), nullable=True))

    op.execute(
        """
        UPDATE wishlist_items
        SET archivado = 1
        WHERE comprado = 1
        """
    )


def downgrade():
    with op.batch_alter_table("wishlist_items") as batch_op:
        batch_op.drop_column("transaction_id")
        batch_op.drop_column("fecha_compra")
        batch_op.drop_column("monto_real")
        batch_op.drop_column("recurring_entry_id")
        batch_op.drop_column("archivado")
