export type SimpleInstallmentRow = {
  numero_cuota: number;
  fecha_vencimiento: string;
  cuota_total: number;
};

export type ProjectedDebtPayment = {
  month: number;
  year: number;
  amount: number;
  fechaVencimiento: string;
};

export type BudgetDebtRow = {
  id: number;
  debtId: number;
  installmentId: number;
  numeroCuota: number;
  nombre: string;
  acreedor: string;
  assigned: number;
  fechaVencimiento: string;
  /** Ya contabilizada como gasto fijo recurrente (Cuota X). */
  excludedFromTotal?: boolean;
  /** Cuota del mes ya liquidada — visible en lista con badge Pagada. */
  paidInMonth?: boolean;
};

export type NextDebtPayment = {
  label: string;
  amount: number;
  date: string;
  debtId: number;
  installmentId: number;
};

export type AmortizationScheduleRow = {
  numero_cuota: number;
  fecha_vencimiento: string;
  capital: number;
  interes: number;
  cuota_total: number;
  saldo_pendiente: number;
  pagada: boolean;
};

export type GenerateScheduleOptions = {
  maxMonths?: number;
  /** ISO YYYY-MM-DD — fecha de la primera cuota */
  startDate?: string;
  /** Fecha de referencia para marcar cuotas pagadas (default: hoy) */
  referenceDate?: Date;
  /** Número de cuotas acordado; la última ajusta el saldo restante. */
  paymentCount?: number;
};

export const DEBT_TIPO_OPTIONS = ["Préstamo personal", "Hipoteca", "Tarjeta", "Otro"] as const;
