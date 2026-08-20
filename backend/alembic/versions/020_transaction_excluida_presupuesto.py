"""Transaction flag: exclude from budget totals without marking as internal transfer

Revision ID: 020_transaction_excluida_presupuesto
Revises: 019_transaction_bank_enhancements
Create Date: 2026-07-29

"""
from alembic import op
import sqlalchemy as sa

revision = "020_transaction_excluida_presupuesto"
down_revision = "019_transaction_bank_enhancements"
branch_labels = None
depends_on = None


def upgrade():
    # Plain add_column, not batch_alter_table — see 013_debt_archivada.py.
    op.add_column(
        "transactions",
        sa.Column("excluida_presupuesto", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column("transactions", "excluida_presupuesto")
