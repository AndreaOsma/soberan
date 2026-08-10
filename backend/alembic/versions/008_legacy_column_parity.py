"""Add remaining columns previously patched at runtime

Revision ID: 008_legacy_column_parity
Revises: 007_recurring_entry_scope
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "008_legacy_column_parity"
down_revision = "007_recurring_entry_scope"
branch_labels = None
depends_on = None


def _add_column(table: str, column: sa.Column) -> None:
    with op.batch_alter_table(table) as batch_op:
        batch_op.add_column(column)


def upgrade() -> None:
    _add_column("accounts", sa.Column("iban", sa.String(), nullable=True))
    _add_column("debts", sa.Column("nombre", sa.String(), nullable=True))
    _add_column("money_owed", sa.Column("tasa_anual", sa.Float(), nullable=True))
    _add_column("money_owed", sa.Column("fecha_inicio", sa.String(), nullable=True))
    _add_column("goals", sa.Column("account_id", sa.Integer(), nullable=True))
    _add_column("goals", sa.Column("cartera_destino", sa.String(), nullable=True))
    _add_column("work_history", sa.Column("salario_bruto", sa.Float(), nullable=True))
    _add_column("work_history", sa.Column("periodicidad", sa.String(), nullable=True, server_default="M"))
    _add_column("work_history", sa.Column("irpf_pct", sa.Float(), nullable=True, server_default="0"))
    _add_column("work_history", sa.Column("ss_pct", sa.Float(), nullable=True, server_default="6.35"))
    _add_column("subscriptions", sa.Column("bloque", sa.String(), nullable=True))
    _add_column("subscriptions", sa.Column("meses_excluidos", sa.String(), nullable=True))

    with op.batch_alter_table("recurring_entries") as batch_op:
        batch_op.add_column(sa.Column("empresa", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("tipo_partida", sa.String(), nullable=True, server_default="gasto"))
        batch_op.add_column(sa.Column("cuenta_destino_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("cartera_destino", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("es_fondo", sa.Boolean(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("frecuencia", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("fecha_pago", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("mes_cobro", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("meses_excluidos", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("recurring_entries") as batch_op:
        for col in [
            "meses_excluidos", "mes_cobro", "fecha_pago", "frecuencia", "es_fondo",
            "cartera_destino", "cuenta_destino_id", "tipo_partida", "empresa",
        ]:
            batch_op.drop_column(col)

    for table, cols in [
        ("subscriptions", ["meses_excluidos", "bloque"]),
        ("work_history", ["ss_pct", "irpf_pct", "periodicidad", "salario_bruto"]),
        ("goals", ["cartera_destino", "account_id"]),
        ("money_owed", ["fecha_inicio", "tasa_anual"]),
        ("debts", ["nombre"]),
        ("accounts", ["iban"]),
    ]:
        with op.batch_alter_table(table) as batch_op:
            for col in cols:
                batch_op.drop_column(col)
