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
    # Plain add_column, not batch_alter_table — see 013_debt_archivada.py's comment for
    # the full explanation. Same CircularDependencyError here, against wishlist_items'
    # two FKs (recurring_entry_id -> recurring_entries.id, transaction_id ->
    # transactions.id): "Circular dependency detected. ('fecha_compra',
    # 'recurring_entry_id', 'archivado', 'monto_real', 'transaction_id')". None of these
    # columns need batch mode's table-recreate emulation — plain adds, no renames/type
    # changes — so there's nothing to lose by skipping it.
    op.add_column("wishlist_items", sa.Column("archivado", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("wishlist_items", sa.Column("recurring_entry_id", sa.Integer(), nullable=True))
    op.add_column("wishlist_items", sa.Column("monto_real", sa.Float(), nullable=True))
    op.add_column("wishlist_items", sa.Column("fecha_compra", sa.DateTime(), nullable=True))
    op.add_column("wishlist_items", sa.Column("transaction_id", sa.Integer(), nullable=True))

    op.execute(
        """
        UPDATE wishlist_items
        SET archivado = 1
        WHERE comprado = 1
        """
    )


def downgrade():
    op.drop_column("wishlist_items", "transaction_id")
    op.drop_column("wishlist_items", "fecha_compra")
    op.drop_column("wishlist_items", "monto_real")
    op.drop_column("wishlist_items", "recurring_entry_id")
    op.drop_column("wishlist_items", "archivado")
