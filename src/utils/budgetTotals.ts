import type { Debt, DebtInstallment, MonthlyBudget, RecurringEntry, SalaryBreakdown, WorkHistory } from "../types";
import { incomeRealAmount, isPayrollIncomeEntry, payrollBudgetRows } from "./budgetIncome";
import { isAhorroInversionTipo, monthlySavingsAmount } from "./budgetTipo";
import { monthlyDebtObligation, recurringExpenseNames } from "./debtInstallments";
import {
  recurringEntryAppliesToMonth,
  subscriptionAppliesToMonth,
  subscriptionMonthlyAmount,
} from "./subscriptionBudget";

export type MonthlyBudgetTotals = {
  monthlyIncome: number;
  monthlyConsumption: number;
  /** Desglose de monthlyConsumption (fondos + planificados + suscripciones). */
  monthlyFondos: number;
  monthlyPuntual: number;
  monthlySubs: number;
  monthlyAhorroInversion: number;
  /** Aportaciones a cartera/inversión externa — salen de la liquidez en cuentas. */
  monthlyAhorroToCartera: number;
  monthlyDebtPayments: number;
  monthlyExpense: number;
  /** Consumo + deuda + aportaciones a cartera (no traspasos entre cuentas). */
  monthlyLiquidityOutflows: number;
  monthlySavings: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function entryAmount(entry: RecurringEntry, mbMap: Record<number, number>): number {
  return mbMap[entry.id] ?? Number(entry.monto_estimado || 0);
}

function sumEntries(entries: RecurringEntry[], mbMap: Record<number, number>): number {
  return entries.reduce((sum, entry) => sum + entryAmount(entry, mbMap), 0);
}

/** Totales mensuales alineados con Presupuesto: mismas partidas que «Gastos asignados» + deudas. */
export function computeMonthlyBudgetTotals(params: {
  recurringEntries: RecurringEntry[];
  month: number;
  year: number;
  workHistory?: WorkHistory[];
  salaryBreakdowns?: SalaryBreakdown[];
  monthlyBudgets?: MonthlyBudget[];
  debts?: Debt[];
  debtInstallments?: DebtInstallment[];
}): MonthlyBudgetTotals {
  const {
    recurringEntries,
    month,
    year,
    workHistory = [],
    salaryBreakdowns = [],
    monthlyBudgets = [],
    debts = [],
    debtInstallments = [],
  } = params;

  const excludedIds = new Set(
    monthlyBudgets.filter((row) => row.excluido).map((row) => row.recurring_entry_id),
  );

  const mbMap: Record<number, number> = {};
  for (const row of monthlyBudgets) {
    if (!row.excluido) {
      mbMap[row.recurring_entry_id] = row.monto_real;
    }
  }

  const applies = (entry: RecurringEntry) => recurringEntryAppliesToMonth(entry, month, year);

  const payrollRows = payrollBudgetRows(workHistory, salaryBreakdowns, recurringEntries, month, year);
  const payrollIncome = payrollRows.reduce(
    (sum, row) => sum + incomeRealAmount(row.expected, row.recurringEntryId, mbMap),
    0,
  );

  const otherIncome = recurringEntries
    .filter(
      (entry) =>
        entry.es_ingreso
        && !isPayrollIncomeEntry(entry)
        && !excludedIds.has(entry.id)
        && applies(entry),
    )
    .reduce((sum, entry) => sum + entryAmount(entry, mbMap), 0);

  const monthlyIncome = round2(payrollIncome + otherIncome);

  const gastoEntries = recurringEntries.filter(
    (entry) =>
      !entry.es_ingreso
      && (entry.tipo_partida ?? "gasto") === "gasto"
      && !excludedIds.has(entry.id)
      && applies(entry),
  );

  const fondoEntries = gastoEntries.filter((entry) => entry.es_fondo);
  const puntualGastoEntries = gastoEntries.filter((entry) => entry.es_puntual && !entry.es_fondo);

  const activeSubscriptions = recurringEntries.filter(
    (entry) =>
      entry.tipo_partida === "suscripcion"
      && !excludedIds.has(entry.id)
      && subscriptionAppliesToMonth(entry, month, year),
  );

  const ahorroInversionEntries = recurringEntries.filter(
    (entry) =>
      !entry.es_ingreso
      && isAhorroInversionTipo(entry.tipo_partida)
      && !excludedIds.has(entry.id)
      && applies(entry),
  );

  const totalFondos = sumEntries(fondoEntries, mbMap);
  const totalPuntual = sumEntries(puntualGastoEntries, mbMap);
  const totalSubs = activeSubscriptions.reduce(
    (sum, sub) => sum + subscriptionMonthlyAmount(sub, month, year),
    0,
  );

  const ahorroFromTipo = sumEntries(ahorroInversionEntries, mbMap);
  const ahorroFromGastoBloque = gastoEntries
    .filter((entry) => entry.bloque === "ahorro_inversion")
    .reduce((sum, entry) => sum + entryAmount(entry, mbMap), 0);

  let monthlyAhorroToCartera = 0;
  for (const entry of ahorroInversionEntries) {
    if (entry.cartera_destino?.trim()) {
      monthlyAhorroToCartera += entryAmount(entry, mbMap);
    }
  }
  for (const entry of gastoEntries.filter((e) => e.bloque === "ahorro_inversion" && e.cartera_destino?.trim())) {
    monthlyAhorroToCartera += entryAmount(entry, mbMap);
  }

  const monthlyAhorroInversion = round2(ahorroFromTipo + ahorroFromGastoBloque);
  const monthlyConsumption = round2(totalFondos + totalPuntual + totalSubs);

  const monthlyDebtPayments = monthlyDebtObligation(
    debts,
    debtInstallments,
    month,
    year,
    recurringExpenseNames(recurringEntries),
  );

  const monthlyExpense = round2(monthlyConsumption + monthlyDebtPayments);
  const monthlyLiquidityOutflows = round2(monthlyConsumption + monthlyDebtPayments + round2(monthlyAhorroToCartera));

  return {
    monthlyIncome,
    monthlyConsumption,
    monthlyFondos: round2(totalFondos),
    monthlyPuntual: round2(totalPuntual),
    monthlySubs: round2(totalSubs),
    monthlyAhorroInversion,
    monthlyAhorroToCartera: round2(monthlyAhorroToCartera),
    monthlyDebtPayments,
    monthlyExpense,
    monthlyLiquidityOutflows,
    monthlySavings: monthlySavingsAmount(
      monthlyIncome,
      monthlyConsumption,
      monthlyDebtPayments,
      monthlyAhorroInversion,
    ),
  };
}

/** Proyección de patrimonio neto: el ahorro/inversión planificado suma, no resta. */
export type NetWorthProjectionOptions = {
  contingencyPct?: number;
  /** Tasa anual compuesta sobre inversiones actuales (0 = desactivado). */
  annualReturnPct?: number;
  investmentsNow?: number;
};

function projectNetWorthBalanceLinear(
  netWorthNow: number,
  monthlyWealthBuild: number,
  months: number,
  contingencyPct = 0.05,
): number {
  if (monthlyWealthBuild >= 0) {
    return round2(netWorthNow + monthlyWealthBuild * (1 - contingencyPct) * months);
  }
  return round2(netWorthNow + monthlyWealthBuild * (1 + contingencyPct) * months);
}

export function projectNetWorthBalance(
  netWorthNow: number,
  monthlyWealthBuild: number,
  months: number,
  options: NetWorthProjectionOptions | number = {},
): number {
  const opts: NetWorthProjectionOptions = typeof options === "number"
    ? { contingencyPct: options }
    : options;
  const contingencyPct = opts.contingencyPct ?? 0.05;
  const base = projectNetWorthBalanceLinear(netWorthNow, monthlyWealthBuild, months, contingencyPct);

  const annualReturnPct = opts.annualReturnPct ?? 0;
  const investmentsNow = Math.max(0, opts.investmentsNow ?? 0);
  if (annualReturnPct <= 0 || investmentsNow <= 0.01 || months <= 0) {
    return base;
  }

  const monthlyRate = annualReturnPct / 100 / 12;
  const revaluation = investmentsNow * (Math.pow(1 + monthlyRate, months) - 1);
  return round2(base + revaluation);
}

/** Proyección de saldo en cuentas (liquidez), incluye aportaciones a cartera. */
export function projectAccountCashBalance(
  balanceNow: number,
  incomeMonthly: number,
  liquidityOutflowsMonthly: number,
  months: number,
  contingencyPct = 0.05,
): number {
  const conservativeOutflows = liquidityOutflowsMonthly * (1 + contingencyPct);
  return round2(balanceNow + (incomeMonthly - conservativeOutflows) * months);
}

export const PROJECTION_HORIZONS = [
  { months: 1, label: "1 mes" },
  { months: 3, label: "3 meses" },
  { months: 6, label: "6 meses" },
  { months: 12, label: "12 meses" },
] as const;

export type ProjectionHorizonRow = {
  months: number;
  label: string;
  netWorth: number;
  cash: number;
  delta: number;
};

export type BudgetScheduleInput = Omit<
  Parameters<typeof computeMonthlyBudgetTotals>[0],
  "month" | "year"
>;

function shiftCalendarMonth(month: number, year: number, delta: number): { month: number; year: number } {
  const d = new Date(year, month - 1 + delta, 1);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

/** Suma ahorro y delta de liquidez mes a mes (planilla de deudas + presupuesto por mes). */
export function cumulativeBudgetProjection(
  startMonth: number,
  startYear: number,
  horizonMonths: number,
  budgetSchedule: BudgetScheduleInput,
  contingencyPct = 0.05,
): { savingsSum: number; cashDelta: number } {
  let savingsSum = 0;
  let cashDelta = 0;

  for (let i = 0; i < horizonMonths; i++) {
    const { month, year } = shiftCalendarMonth(startMonth, startYear, i);
    const totals = computeMonthlyBudgetTotals({ ...budgetSchedule, month, year });
    const savings = totals.monthlySavings;
    if (savings >= 0) {
      savingsSum += savings * (1 - contingencyPct);
    } else {
      savingsSum += savings * (1 + contingencyPct);
    }
    const outflows = totals.monthlyLiquidityOutflows * (1 + contingencyPct);
    cashDelta += totals.monthlyIncome - outflows;
  }

  return { savingsSum: round2(savingsSum), cashDelta: round2(cashDelta) };
}

export function buildNetWorthProjections(params: {
  netWorthNow: number;
  cashNow: number;
  month: number;
  year: number;
  budgetSchedule: BudgetScheduleInput;
  options?: NetWorthProjectionOptions;
  horizons?: ReadonlyArray<{ months: number; label: string }>;
}): ProjectionHorizonRow[] {
  const {
    netWorthNow,
    cashNow,
    month,
    year,
    budgetSchedule,
    options = {},
    horizons = PROJECTION_HORIZONS,
  } = params;
  const contingencyPct = options.contingencyPct ?? 0.05;
  const annualReturnPct = options.annualReturnPct ?? 0;
  const investmentsNow = Math.max(0, options.investmentsNow ?? 0);

  return horizons.map(({ months: horizon, label }) => {
    const { savingsSum, cashDelta } = cumulativeBudgetProjection(
      month,
      year,
      horizon,
      budgetSchedule,
      contingencyPct,
    );

    let netWorth = round2(netWorthNow + savingsSum);
    if (annualReturnPct > 0 && investmentsNow > 0.01 && horizon > 0) {
      const monthlyRate = annualReturnPct / 100 / 12;
      const revaluation = investmentsNow * (Math.pow(1 + monthlyRate, horizon) - 1);
      netWorth = round2(netWorth + revaluation);
    }

    const cash = round2(cashNow + cashDelta);
    return {
      months: horizon,
      label,
      netWorth,
      cash,
      delta: round2(netWorth - netWorthNow),
    };
  });
}
