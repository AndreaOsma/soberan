export type Account = {
  id: number;
  alias_real: string;
  alias_anonimo?: string | null;
  tipo: string;
  balance_actual: number;
  banco: string;
  iban?: string | null;
  gocardless_account_id?: string | null;
  last_sync_at?: string | null;
  archivada?: boolean;
  oculta?: boolean;
  last_sync_error?: string | null;
};

export type Goal = {
  id: number;
  nombre: string;
  monto_objetivo: number;
  monto_actual: number;
  fecha_limite?: string | null;
  account_id?: number | null;
  cartera_destino?: string | null;
};

export type TransactionSplit = {
  id?: number;
  transaction_id?: number;
  person_name: string;
  amount: number;
  is_me: boolean;
  settled: boolean;
};

export type Transaction = {
  id: number;
  account_id?: number | null;
  amount: number;
  category_anon: string;
  description_raw: string;
  tipo_meta?: string | null;
  date: string;
  es_interna?: boolean;
  transfer_pair_id?: number | null;
  es_pending?: boolean;
  excluida_presupuesto?: boolean;
  splits?: TransactionSplit[];
};

export type Debt = {
  id: number;
  nombre?: string | null;
  acreedor: string;
  monto_total: number;
  monto_pagado: number;
  /** Suma de pagos reales registrados (DebtPayment); fuente de verdad para cuotas pagadas. */
  monto_pagado_registrado?: number;
  tipo: string;
  fecha_vencimiento?: string | null;
  cuota_mensual?: number | null;
  tasa_anual?: number | null;
  notas?: string | null;
  dia_cargo_mensual?: number | null;
  /** True cuando el saldo pendiente llega a ~0€ (auto). */
  archivada?: boolean;
  goal_id?: number | null;
};

export type Property = {
  id: number;
  nombre: string;
  valor_estimado: number;
  tipo: string;
  marca?: string | null;
  modelo?: string | null;
  anio?: number | null;
  matricula?: string | null;
  bastidor?: string | null;
  color?: string | null;
  km?: number | null;
  estado_notas?: string | null;
  valor_actualizado_en?: string | null;
  valoracion_json?: string | null;
};

export type Investment = {
  id: number;
  nombre: string;
  monto_invertido: number;
  valor_actual: number;
  tipo: string;
  cartera?: string | null;
  fecha_inicio?: string | null;
};

export type WorkHistory = {
  id: number;
  empresa: string;
  grupo_cotizacion: string;
  fecha_inicio: string;
  fecha_fin?: string | null;
  dias_alta: number;
  salario_bruto?: number | null;
  periodicidad?: string | null;  // M = mensual, A = anual
  irpf_pct?: number | null;
  ss_pct?: number | null;
};

export type Card = {
  id: number;
  nombre: string;
  tipo: string;
  banco: string;
  limite?: number | null;
};

export type Subscription = {
  id: number;
  nombre: string;
  monto: number;
  frecuencia: string;
  fecha_pago: number;
  mes?: number | null;
  bloque?: "necesidades" | "deseos" | null;
  meses_excluidos?: string | null;
};

export type MoneyOwed = {
  id: number;
  deudor: string;
  monto: number;
  descripcion: string;
  pagado: boolean;
  tasa_anual?: number | null;
  fecha_inicio?: string | null;
};

export type RecurringEntry = {
  id: number;
  nombre: string;
  monto_estimado: number;
  es_ingreso: boolean;
  es_fijo: boolean;
  categoria: string;
  empresa?: string | null;
  tipo_partida?: "gasto" | "ahorro_inversion" | "ahorro" | "inversion" | "suscripcion" | null;
  cuenta_destino_id?: number | null;
  cartera_destino?: string | null;
  bloque?: "necesidades" | "deseos" | "ahorro_inversion" | null;
  objetivo_monto?: number | null;
  objetivo_fecha?: string | null;
  rentabilidad_anual_pct?: number | null;
  mes_inicio?: number | null;
  anio_inicio?: number | null;
  mes_fin?: number | null;
  anio_fin?: number | null;
  es_puntual?: boolean;
  es_fondo?: boolean;
  frecuencia?: string | null;
  fecha_pago?: number | null;
  mes_cobro?: number | null;
  meses_excluidos?: string | null;
  historial_precios?: string | null;
  goal_id?: number | null;
};

export type DebtPayment = {
  id: number;
  debt_id: number;
  monto: number;
  fecha: string;
  notas?: string | null;
};

export type DebtPaymentCreate = Omit<DebtPayment, "id" | "debt_id">;

export type DebtInstallment = {
  id: number;
  debt_id: number;
  numero_cuota: number;
  fecha_vencimiento: string;
  capital?: number | null;
  interes?: number | null;
  cuota_total: number;
  saldo_pendiente?: number | null;
  pagada: boolean;
  notas?: string | null;
};

export type DebtInstallmentCreate = Omit<DebtInstallment, "id" | "debt_id">;

export type WishlistItem = {
  id: number;
  nombre: string;
  monto_estimado?: number | null;
  prioridad: "baja" | "media" | "alta";
  notas?: string | null;
  url?: string | null;
  comprado: boolean;
  archivado?: boolean;
  recurring_entry_id?: number | null;
  monto_real?: number | null;
  fecha_compra?: string | null;
  transaction_id?: number | null;
};

export type WishlistItemCreate = Omit<WishlistItem, "id">;

export type MonthlyBudget = {
  id: number;
  recurring_entry_id: number;
  mes: number;
  anio: number;
  monto_real: number;
  excluido?: boolean;
  cuenta_gestion_id?: number | null;
  movido_a_cuenta?: boolean;
  movido_checked_at?: string | null;
};

export type SalaryBreakdown = {
  id: number;
  mes: number;
  anio: number;
  bruto: number;
  irpf: number;
  ss: number;
  neto: number;
  empresa: string;
  account_id?: number | null;
};

export type CalendarEvent = {
  tipo: string;
  titulo: string;
  monto: number;
  fecha: string;
  id?: number;
  seccion?: string | null;
};

export type AlertItem = {
  tipo: string;
  severidad: "alta" | "media" | "baja";
  mensaje: string;
  id?: number | null;
};

export type SankeyData = {
  nodes: string[];
  links: {
    source: number[];
    target: number[];
    value: number[];
  };
};

export type AccountCreate = Omit<Account, "id">;
export type GoalCreate = Omit<Goal, "id">;
export type TransactionCreate = Omit<Transaction, "id" | "date"> & {
  date?: string;
};
export type DebtCreate = Omit<Debt, "id">;
export type PropertyCreate = Omit<Property, "id">;
export type InvestmentCreate = Omit<Investment, "id">;
export type WorkHistoryCreate = Omit<WorkHistory, "id">;
export type CardCreate = Omit<Card, "id">;
export type SubscriptionCreate = Omit<Subscription, "id">;
export type MoneyOwedCreate = Omit<MoneyOwed, "id">;
export type RecurringEntryCreate = Omit<RecurringEntry, "id">;
export type SalaryBreakdownCreate = Omit<SalaryBreakdown, "id">;
