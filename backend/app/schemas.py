"""Pydantic request/response schemas for the Soberan API."""
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, field_validator

class AccountBase(BaseModel):
    alias_real: str
    alias_anonimo: Optional[str] = None
    tipo: str
    balance_actual: float = 0.0
    banco: str
    iban: Optional[str] = None
    archivada: bool = False
    oculta: bool = False
    last_sync_error: Optional[str] = None

class AccountCreate(AccountBase): pass
class Account(AccountBase):
    id: int
    gocardless_account_id: Optional[str] = None
    last_sync_at: Optional[datetime] = None
    class Config: from_attributes = True


class PayrollAccountHistoryEntry(BaseModel):
    account_id: int
    account_alias: str
    from_date: str
    to_date: Optional[str] = None


class PayrollAccountConfigResponse(BaseModel):
    empresa: str
    account_id: Optional[int] = None
    account_alias: Optional[str] = None
    income_mode: Optional[str] = "fixed"
    history: List[PayrollAccountHistoryEntry] = []


class PayrollAccountConfigSet(BaseModel):
    empresa: str
    account_id: int
    archive_previous_account: bool = False

class GoalBase(BaseModel):
    nombre: str
    monto_objetivo: float
    monto_actual: float = 0.0
    fecha_limite: Optional[datetime] = None
    account_id: Optional[int] = None
    cartera_destino: Optional[str] = None

class GoalCreate(GoalBase): pass
class Goal(GoalBase):
    id: int
    class Config: from_attributes = True

class DebtPaymentBase(BaseModel):
    monto: float
    fecha: str
    notas: Optional[str] = None

class DebtPaymentCreate(DebtPaymentBase): pass
class DebtPaymentOut(DebtPaymentBase):
    id: int
    debt_id: int
    class Config: from_attributes = True

class DebtInstallmentBase(BaseModel):
    numero_cuota: int
    fecha_vencimiento: str
    capital: Optional[float] = None
    interes: Optional[float] = None
    cuota_total: float
    saldo_pendiente: Optional[float] = None
    pagada: bool = False
    notas: Optional[str] = None

class DebtInstallmentCreate(DebtInstallmentBase): pass

class DebtInstallmentOut(DebtInstallmentBase):
    id: int
    debt_id: int
    class Config: from_attributes = True

class DebtInstallmentBulk(BaseModel):
    installments: List[DebtInstallmentCreate]

class WishlistItemBase(BaseModel):
    nombre: str
    monto_estimado: Optional[float] = None
    prioridad: str = "media"
    notas: Optional[str] = None
    url: Optional[str] = None
    comprado: bool = False
    archivado: bool = False
    recurring_entry_id: Optional[int] = None
    monto_real: Optional[float] = None
    fecha_compra: Optional[datetime] = None
    transaction_id: Optional[int] = None

class WishlistItemCreate(WishlistItemBase): pass
class WishlistItemOut(WishlistItemBase):
    id: int
    class Config: from_attributes = True

class WishlistPurchaseBody(BaseModel):
    monto_real: float
    account_id: int
    fecha: Optional[datetime] = None

class TransactionBase(BaseModel):
    account_id: Optional[int] = None
    amount: float
    category_anon: str
    description_raw: str
    tipo_meta: Optional[str] = None
    date: Optional[datetime] = None

class TransactionCreate(TransactionBase):
    account_id: int


class TransactionUpdate(BaseModel):
    account_id: Optional[int] = None
    amount: float
    category_anon: str = ""
    description_raw: str = ""
    tipo_meta: Optional[str] = None
    date: Optional[datetime] = None


class TransactionSplitBase(BaseModel):
    person_name: str = ""
    amount: float
    is_me: bool = False
    settled: bool = False


class TransactionSplitCreate(TransactionSplitBase):
    pass


class TransactionSplitOut(TransactionSplitBase):
    id: int
    transaction_id: int

    class Config:
        from_attributes = True


class TransactionSplitBulk(BaseModel):
    splits: List[TransactionSplitCreate]


class Transaction(TransactionBase):
    id: int
    date: datetime
    es_interna: bool = False
    transfer_pair_id: Optional[int] = None
    es_pending: bool = False
    excluida_presupuesto: bool = False
    splits: List[TransactionSplitOut] = []

    class Config:
        from_attributes = True


class DebtBase(BaseModel):
    nombre: Optional[str] = None
    acreedor: str
    monto_total: float
    monto_pagado: float = 0.0
    tipo: str
    fecha_vencimiento: Optional[datetime] = None
    cuota_mensual: Optional[float] = None
    tasa_anual: Optional[float] = None
    notas: Optional[str] = None
    dia_cargo_mensual: Optional[int] = None
    archivada: bool = False
    goal_id: Optional[int] = None

class DebtCreate(DebtBase): pass
class Debt(DebtBase):
    id: int
    monto_pagado_registrado: float = 0.0
    class Config: from_attributes = True

class PropertyBase(BaseModel):
    nombre: str
    valor_estimado: float
    tipo: str
    marca: Optional[str] = None
    modelo: Optional[str] = None
    anio: Optional[int] = None
    matricula: Optional[str] = None
    bastidor: Optional[str] = None
    color: Optional[str] = None
    km: Optional[int] = None
    estado_notas: Optional[str] = None
    valor_actualizado_en: Optional[str] = None

class PropertyCreate(PropertyBase): pass
class Property(PropertyBase):
    id: int
    valoracion_json: Optional[str] = None
    class Config: from_attributes = True

class InvestmentBase(BaseModel):
    nombre: str
    monto_invertido: float
    valor_actual: float
    tipo: str
    cartera: Optional[str] = ""
    fecha_inicio: Optional[str] = None

    @field_validator("fecha_inicio", mode="before")
    @classmethod
    def coerce_fecha_inicio(cls, v):
        if v is None:
            return v
        if hasattr(v, "isoformat"):
            return v.isoformat()
        return str(v)

class InvestmentCreate(InvestmentBase): pass
class Investment(InvestmentBase):
    id: int
    class Config: from_attributes = True

class WorkHistoryBase(BaseModel):
    empresa: str
    grupo_cotizacion: str
    fecha_inicio: datetime
    fecha_fin: Optional[datetime] = None
    dias_alta: int = 0
    salario_bruto: Optional[float] = None
    periodicidad: Optional[str] = "M"   # M = mensual, A = anual
    irpf_pct: Optional[float] = 0.0
    ss_pct: Optional[float] = 6.35

class WorkHistoryCreate(WorkHistoryBase): pass
class WorkHistory(WorkHistoryBase):
    id: int
    class Config: from_attributes = True

class CardBase(BaseModel):
    nombre: str
    tipo: str
    banco: str
    limite: Optional[float] = None

class CardCreate(CardBase): pass
class Card(CardBase):
    id: int
    class Config: from_attributes = True

class SubscriptionBase(BaseModel):
    nombre: str
    monto: float
    frecuencia: str
    fecha_pago: int
    mes: Optional[int] = 1
    bloque: Optional[str] = None
    meses_excluidos: Optional[str] = None  # JSON list of months to skip, e.g. "[8,9]"

class SubscriptionCreate(SubscriptionBase): pass
class Subscription(SubscriptionBase):
    id: int
    class Config: from_attributes = True

class MoneyOwedBase(BaseModel):
    deudor: str
    monto: float
    descripcion: str
    pagado: bool = False
    tasa_anual: Optional[float] = None
    fecha_inicio: Optional[str] = None

class MoneyOwedCreate(MoneyOwedBase): pass
class MoneyOwed(MoneyOwedBase):
    id: int
    class Config: from_attributes = True

class SettingBase(BaseModel):
    key: str
    value: str

class AgentTransactionCreate(BaseModel):
    cuenta_alias: str
    monto: float
    categoria: str
    descripcion: str

class AgentCommandRequest(BaseModel):
    command: str
    payload: Optional[Dict[str, Any]] = None

class AgentCommandResponse(BaseModel):
    ok: bool
    command: str
    result: Dict[str, Any]

class RecurringEntryBase(BaseModel):
    nombre: str
    monto_estimado: float
    es_ingreso: bool
    es_fijo: bool
    categoria: str
    empresa: Optional[str] = None
    tipo_partida: Optional[str] = None
    cuenta_destino_id: Optional[int] = None
    cartera_destino: Optional[str] = None
    bloque: Optional[str] = None
    objetivo_monto: Optional[float] = None
    objetivo_fecha: Optional[str] = None
    rentabilidad_anual_pct: Optional[float] = None
    mes_inicio: Optional[int] = None
    anio_inicio: Optional[int] = None
    mes_fin: Optional[int] = None
    anio_fin: Optional[int] = None
    es_puntual: bool = False
    es_fondo: bool = False
    frecuencia: Optional[str] = None
    fecha_pago: Optional[int] = None
    mes_cobro: Optional[int] = None
    meses_excluidos: Optional[str] = None
    historial_precios: Optional[str] = None
    goal_id: Optional[int] = None

class RecurringEntryCreate(RecurringEntryBase): pass
class RecurringEntry(RecurringEntryBase):
    id: int
    class Config: from_attributes = True

class MonthlyBudgetBase(BaseModel):
    recurring_entry_id: int
    mes: int
    anio: int
    monto_real: float
    excluido: bool = False
    cuenta_gestion_id: Optional[int] = None
    movido_a_cuenta: bool = False
    movido_checked_at: Optional[datetime] = None

class MonthlyBudgetCreate(MonthlyBudgetBase): pass
class MonthlyBudget(MonthlyBudgetBase):
    id: int
    class Config: from_attributes = True

class BudgetCopyRequest(BaseModel):
    from_mes: int
    from_anio: int
    to_mes: int
    to_anio: int

class SalaryBreakdownBase(BaseModel):
    mes: int
    anio: int
    bruto: float
    irpf: float
    ss: float
    neto: float
    empresa: str
    account_id: Optional[int] = None

class PayrollEstimateRequest(BaseModel):
    bruto_mensual: float
    pagas: Optional[int] = 14
    ss_pct: Optional[float] = None
    contract_type: Optional[str] = "indefinido"
    personal_minimum: Optional[float] = 5550.0
    work_expense: Optional[float] = 2000.0
    irpf_pct_override: Optional[float] = None


class IrpfDependentIn(BaseModel):
    kind: str = "descendant"  # descendant | ascendant
    age: int = 0
    disability: str = "none"  # none | 33_64 | 65_plus
    shared_custody: bool = False
    mobility_reduced: bool = False


class IrpfModelo145Request(BaseModel):
    """Inputs mirroring Modelo 145 + economic data for AEAT withholding calc."""
    annual_gross: float
    age: int
    family_situation: str = "3"  # 1 | 2 | 3
    disability: str = "none"
    mobility_reduced: bool = False
    geographic_mobility: bool = False
    contract_type: str = "indefinido"  # indefinido | temporal | especial
    pagas: Optional[int] = 14
    ss_pct: Optional[float] = None
    dependents: Optional[List[IrpfDependentIn]] = None


class SalaryBreakdownCreate(SalaryBreakdownBase): pass
class SalaryBreakdown(SalaryBreakdownBase):
    id: int
    class Config: from_attributes = True

class SalaryReconcileMark(BaseModel):
    mes: int
    anio: int
    empresa: str
    transaction_id: int

class RequisitionCreate(BaseModel):
    institution_id: str
    redirect_url: str
    institution_name: Optional[str] = None

class AccountLinkRequest(BaseModel):
    soberan_account_id: int
    gocardless_account_id: str
    institution_name: Optional[str] = None

class BankSyncRequest(BaseModel):
    account_id: Optional[int] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None

class LearnCategoryRuleBody(BaseModel):
    pattern: str
    category: str


class LearnMerchantNameBody(BaseModel):
    pattern: str
    name: str


class SmartCleanExpensesBody(BaseModel):
    mes: Optional[int] = None
    anio: Optional[int] = None


class MarkInternalBody(BaseModel):
    other_transaction_id: Optional[int] = None

