"""SQLAlchemy ORM models for Soberan (accounts, transactions, goals, debts, payroll, etc.)."""
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Enum, Boolean
from sqlalchemy.orm import relationship
import enum
from datetime import datetime
from .database import Base


class AccountType(enum.Enum):
    FONDOS = "fondos"      # Day-to-day cash
    METAS = "metas"        # Savings for goals
    INVERSIONES = "inversiones"

class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    alias_real = Column(String)  # e.g. "Santander"
    alias_anonimo = Column(String, unique=True, index=True)  # e.g. "ACC_01"
    tipo = Column(String)  # Stored as string (legacy: was Enum)
    balance_actual = Column(Float, default=0.0)
    banco = Column(String)
    iban = Column(String, nullable=True)
    gocardless_account_id = Column(String, nullable=True, unique=True, index=True)
    last_sync_at = Column(DateTime, nullable=True)
    last_sync_error = Column(String, nullable=True)
    archivada = Column(Boolean, default=False, nullable=False)
    oculta = Column(Boolean, default=False, nullable=False)

    transactions = relationship("Transaction", back_populates="account")

class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"))
    amount = Column(Float)
    category_anon = Column(String)
    description_raw = Column(String)
    date = Column(DateTime, default=datetime.utcnow)
    tipo_meta = Column(String, nullable=True)  # If expense is tied to a goal
    gocardless_tx_id = Column(String, nullable=True, index=True)
    es_interna = Column(Boolean, default=False, nullable=False)
    transfer_pair_id = Column(Integer, nullable=True)
    es_pending = Column(Boolean, default=False, nullable=False)
    excluida_presupuesto = Column(Boolean, default=False, nullable=False)

    account = relationship("Account", back_populates="transactions")
    splits = relationship(
        "TransactionSplit",
        back_populates="transaction",
        cascade="all, delete-orphan",
        order_by="TransactionSplit.id",
    )


class TransactionSplit(Base):
    """Share of an expense among people. Bank amount stays full; budget uses is_me row."""
    __tablename__ = "transaction_splits"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=False, index=True)
    person_name = Column(String, nullable=False, default="")
    amount = Column(Float, nullable=False)  # positive share of the expense
    is_me = Column(Boolean, default=False, nullable=False)
    settled = Column(Boolean, default=False, nullable=False)

    transaction = relationship("Transaction", back_populates="splits")


class Goal(Base):
    __tablename__ = "goals"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String)
    monto_objetivo = Column(Float)
    monto_actual = Column(Float, default=0.0)
    fecha_limite = Column(DateTime, nullable=True)
    account_id = Column(Integer, nullable=True)
    cartera_destino = Column(String, nullable=True)

class Debt(Base):
    __tablename__ = "debts"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=True)
    acreedor = Column(String)
    monto_total = Column(Float)
    monto_pagado = Column(Float, default=0.0)
    tipo = Column(String)  # e.g. "loan", "card"
    fecha_vencimiento = Column(DateTime, nullable=True)
    cuota_mensual = Column(Float, nullable=True)
    tasa_anual = Column(Float, nullable=True)  # APR / indicative interest (%)
    notas = Column(String, nullable=True)
    dia_cargo_mensual = Column(Integer, nullable=True)  # 1-31: day of month for installment
    archivada = Column(Boolean, default=False, nullable=False)
    goal_id = Column(Integer, ForeignKey("goals.id"), nullable=True)

class Property(Base):
    __tablename__ = "properties"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String)
    valor_estimado = Column(Float)
    tipo = Column(String)  # "inmueble", "vehiculo", "otro"
    # Vehicle-specific fields
    marca = Column(String, nullable=True)
    modelo = Column(String, nullable=True)
    anio = Column(Integer, nullable=True)
    matricula = Column(String, nullable=True)
    bastidor = Column(String, nullable=True)
    color = Column(String, nullable=True)
    km = Column(Integer, nullable=True)
    estado_notas = Column(String, nullable=True)
    valor_actualizado_en = Column(String, nullable=True)
    valoracion_json = Column(String, nullable=True)  # last valuation breakdown snapshot

class MoneyOwed(Base):
    __tablename__ = "money_owed"

    id = Column(Integer, primary_key=True, index=True)
    deudor = Column(String)
    monto = Column(Float)
    descripcion = Column(String)
    fecha_limite = Column(DateTime, nullable=True)
    pagado = Column(Boolean, default=False)
    tasa_anual = Column(Float, nullable=True)
    fecha_inicio = Column(String, nullable=True)

class Investment(Base):
    __tablename__ = "investments"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String)
    monto_invertido = Column(Float)
    valor_actual = Column(Float)
    tipo = Column(String)  # e.g. funds, crypto, stocks
    cartera = Column(String, nullable=True, default="")
    fecha_inicio = Column(DateTime, default=datetime.utcnow)

class RecurringEntry(Base):
    __tablename__ = "recurring_entries"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String)
    monto_estimado = Column(Float)
    es_ingreso = Column(Boolean, default=False)
    es_fijo = Column(Boolean, default=True)  # Fixed vs variable amount
    categoria = Column(String)
    empresa = Column(String, nullable=True)
    tipo_partida = Column(String, nullable=True)       # "gasto"|"ahorro_inversion"|"suscripcion"; legacy: ahorro/inversion
    cuenta_destino_id = Column(Integer, nullable=True) # Account.id for ahorro entries
    cartera_destino = Column(String, nullable=True)    # Investment cartera name for inversion entries
    bloque = Column(String, nullable=True)             # "necesidades"|"deseos"|"ahorro_inversion"|null
    objetivo_monto = Column(Float, nullable=True)      # Sinking fund target amount
    objetivo_fecha = Column(String, nullable=True)     # Sinking fund target date (ISO string)
    rentabilidad_anual_pct = Column(Float, nullable=True)  # Expected annual return % (ahorro_inversion, compound projection)
    mes_inicio = Column(Integer, nullable=True)        # First month this entry is active (1-12); null = always
    anio_inicio = Column(Integer, nullable=True)       # First year this entry is active; null = always
    mes_fin = Column(Integer, nullable=True)           # Last month this entry is active (inclusive); null = no end
    anio_fin = Column(Integer, nullable=True)          # Last year this entry is active (inclusive); null = no end
    es_puntual = Column(Boolean, default=False)        # True = only in mes_inicio/anio_inicio month
    es_fondo = Column(Boolean, default=False)          # Expense envelope: unspent balance carries over
    # Subscription-specific (tipo_partida="suscripcion")
    frecuencia = Column(String, nullable=True)         # "mensual" | "anual"
    fecha_pago = Column(Integer, nullable=True)        # Day of month for charge
    mes_cobro = Column(Integer, nullable=True)         # Billing month for annual subs
    meses_excluidos = Column(String, nullable=True)    # JSON array of months to skip, e.g. "[8,9]"
    historial_precios = Column(String, nullable=True)  # JSON tiers [{desde_mes, desde_anio, monto}] for subscriptions
    goal_id = Column(Integer, ForeignKey("goals.id"), nullable=True)

class MonthlyBudget(Base):
    __tablename__ = "monthly_budgets"

    id = Column(Integer, primary_key=True, index=True)
    recurring_entry_id = Column(Integer, ForeignKey("recurring_entries.id"))
    mes = Column(Integer)
    anio = Column(Integer)
    monto_real = Column(Float)  # User-edited amount for that month
    excluido = Column(Boolean, default=False)  # Excluded from this specific month only
    cuenta_gestion_id = Column(Integer, nullable=True)  # Account selected for managing this month
    movido_a_cuenta = Column(Boolean, default=False, nullable=False)  # Manual monthly checklist
    movido_checked_at = Column(DateTime, nullable=True)

class SalaryBreakdown(Base):
    __tablename__ = "salary_breakdown"
    # ... (existing fields)
    id = Column(Integer, primary_key=True, index=True)
    mes = Column(Integer)
    anio = Column(Integer)
    bruto = Column(Float)
    irpf = Column(Float)
    ss = Column(Float)
    neto = Column(Float)
    empresa = Column(String)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)

class WorkHistory(Base):
    __tablename__ = "work_history"
    id = Column(Integer, primary_key=True, index=True)
    empresa = Column(String)
    grupo_cotizacion = Column(String)
    fecha_inicio = Column(DateTime)
    fecha_fin = Column(DateTime, nullable=True)
    dias_alta = Column(Integer)
    salario_bruto = Column(Float, nullable=True)
    periodicidad = Column(String, nullable=True, default="M")  # M=mensual, A=anual
    irpf_pct = Column(Float, nullable=True, default=0.0)
    ss_pct = Column(Float, nullable=True, default=6.35)

class UserSettings(Base):
    __tablename__ = "user_settings"

    key = Column(String, primary_key=True, index=True)  # e.g. "birth_date"
    value = Column(String)  # Stored as string; parse at use site

class Card(Base):
    __tablename__ = "cards"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String)  # e.g. "Gold credit card"
    tipo = Column(String)  # Debit / credit
    banco = Column(String)
    limite = Column(Float, nullable=True)  # Credit cards only

class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String)  # e.g. "Netflix"
    monto = Column(Float)
    frecuencia = Column(String)  # Monthly / annual
    fecha_pago = Column(Integer)  # Day of month for charge
    mes = Column(Integer, nullable=True, default=1)  # Billing month (for annual frequency)
    bloque = Column(String, nullable=True)            # "necesidades"|"deseos"|null
    meses_excluidos = Column(String, nullable=True)  # JSON array of months to skip, e.g. "[8,9]"


class DebtPayment(Base):
    __tablename__ = "debt_payments"

    id = Column(Integer, primary_key=True, index=True)
    debt_id = Column(Integer, ForeignKey("debts.id"))
    monto = Column(Float)
    fecha = Column(String)  # ISO date string YYYY-MM-DD
    notas = Column(String, nullable=True)


class DebtInstallment(Base):
    """Scheduled installment from creditor payment plan (planilla)."""
    __tablename__ = "debt_installments"

    id = Column(Integer, primary_key=True, index=True)
    debt_id = Column(Integer, ForeignKey("debts.id"), nullable=False, index=True)
    numero_cuota = Column(Integer, nullable=False)
    fecha_vencimiento = Column(String, nullable=False)  # ISO YYYY-MM-DD
    capital = Column(Float, nullable=True)
    interes = Column(Float, nullable=True)
    cuota_total = Column(Float, nullable=False)
    saldo_pendiente = Column(Float, nullable=True)
    pagada = Column(Boolean, default=False)
    notas = Column(String, nullable=True)


class WishlistItem(Base):
    __tablename__ = "wishlist_items"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String)
    monto_estimado = Column(Float, nullable=True)
    prioridad = Column(String, default="media")  # "baja" | "media" | "alta"
    notas = Column(String, nullable=True)
    url = Column(String, nullable=True)
    comprado = Column(Boolean, default=False)
    archivado = Column(Boolean, default=False)
    recurring_entry_id = Column(Integer, ForeignKey("recurring_entries.id"), nullable=True)
    monto_real = Column(Float, nullable=True)
    fecha_compra = Column(DateTime, nullable=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=True)


class BankRequisition(Base):
    __tablename__ = "bank_requisitions"

    id = Column(Integer, primary_key=True, index=True)
    requisition_id = Column(String, unique=True, index=True)
    institution_id = Column(String)
    institution_name = Column(String, nullable=True)
    status = Column(String, default="CR")  # CR=Created, LN=Linked, EX=Expired, RJ=Rejected
    link = Column(String, nullable=True)   # Auth URL for the user to visit
    reference = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
