import type { Account, Debt, DebtInstallment, Goal, Investment, MonthlyBudget, RecurringEntry } from "../types";
import { destinoFromEntry, isAhorroInversionTipo } from "./budgetTipo";
import {
  installmentMatchesMonth,
  installmentPendingForDebt,
  parseInstallmentDate,
  remainingDebtPaymentSchedule,
} from "./debtInstallments";
import { addCalendarMonths, carteraTotal, findGoalForEntry } from "./goalProgress";
import {
  recurringEntryAppliesToMonth,
  subscriptionAmountForMonth,
  subscriptionMonthlyAmount,
} from "./subscriptionBudget";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function monthIndex(year: number, month: number): number {
  return year * 12 + month;
}

export function eachMonthInclusive(
  fromMonth: number,
  fromYear: number,
  toMonth: number,
  toYear: number,
): Array<{ month: number; year: number }> {
  const out: Array<{ month: number; year: number }> = [];
  let y = fromYear;
  let m = fromMonth;
  const end = monthIndex(toYear, toMonth);
  while (monthIndex(y, m) <= end) {
    out.push({ month: m, year: y });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 600) break;
  }
  return out;
}

function mbMapForMonth(monthlyBudgets: MonthlyBudget[], month: number, year: number): {
  amounts: Record<number, number>;
  excluded: Set<number>;
} {
  const amounts: Record<number, number> = {};
  const excluded = new Set<number>();
  for (const row of monthlyBudgets) {
    if (row.mes !== month || row.anio !== year) continue;
    if (row.excluido) {
      excluded.add(row.recurring_entry_id);
      continue;
    }
    amounts[row.recurring_entry_id] = row.monto_real;
  }
  return { amounts, excluded };
}

/** Importe planificado de una partida en un mes (override → historial/suscripción → estimado). */
export function plannedEntryAmountInMonth(
  entry: RecurringEntry,
  monthlyBudgets: MonthlyBudget[],
  month: number,
  year: number,
): number {
  if (!recurringEntryAppliesToMonth(entry, month, year)) return 0;
  const { amounts, excluded } = mbMapForMonth(monthlyBudgets, month, year);
  if (excluded.has(entry.id)) return 0;
  if (amounts[entry.id] !== undefined) return amounts[entry.id]!;
  if (entry.tipo_partida === "suscripcion") return subscriptionMonthlyAmount(entry, month, year);
  if (entry.historial_precios) return subscriptionAmountForMonth(entry, month, year);
  return Number(entry.monto_estimado || 0);
}

function entryBalanceNow(
  entry: RecurringEntry,
  accounts: Account[],
  investments: Investment[],
): number {
  const destino = destinoFromEntry(entry);
  if (destino === "cuenta" && entry.cuenta_destino_id) {
    const acc = accounts.find((a) => a.id === entry.cuenta_destino_id);
    return acc ? Number(acc.balance_actual || 0) : 0;
  }
  if (destino === "cartera" && entry.cartera_destino?.trim()) {
    return carteraTotal(investments, entry.cartera_destino);
  }
  return 0;
}

function movedThisMonthSet(monthlyBudgets: MonthlyBudget[], refMonth: number, refYear: number): Set<number> {
  return new Set(
    monthlyBudgets
      .filter((mb) => mb.mes === refMonth && mb.anio === refYear && mb.movido_a_cuenta && !mb.excluido)
      .map((mb) => mb.recurring_entry_id),
  );
}

export type AhorroProjectionRow = {
  entryId: number;
  nombre: string;
  balanceNow: number;
  /** Aportaciones planificadas desde el mes actual hasta el mes visto (inclusive). */
  plannedThroughView: number;
  projected: number;
  /** Igual que projected pero con interés compuesto — null si la partida no tiene rentabilidad_anual_pct. */
  projectedCompound: number | null;
};

export type AhorroProjectionSummary = {
  viewMonth: number;
  viewYear: number;
  /** false si el mes visto es anterior al mes de referencia (no hay predicción futura). */
  isFutureOrCurrent: boolean;
  rows: AhorroProjectionRow[];
  totalBalanceNow: number;
  totalPlannedThroughView: number;
  totalProjected: number;
  /** Suma de projectedCompound cuando existe, projected si no — idéntico a totalProjected si nadie tiene tasa. */
  totalProjectedCompound: number;
};

/**
 * Predicción de saldo ahorrado/invertido al mes de presupuesto visto:
 * saldo actual + aportaciones planificadas desde el mes de referencia hasta el visto.
 * Si una aportación del mes actual ya está marcada como movida, no se suma otra vez.
 */
export function projectAhorroAtBudgetMonth(params: {
  viewMonth: number;
  viewYear: number;
  refMonth?: number;
  refYear?: number;
  recurringEntries: RecurringEntry[];
  monthlyBudgets: MonthlyBudget[];
  accounts: Account[];
  investments: Investment[];
}): AhorroProjectionSummary {
  const now = new Date();
  const refMonth = params.refMonth ?? now.getMonth() + 1;
  const refYear = params.refYear ?? now.getFullYear();
  const viewIdx = monthIndex(params.viewYear, params.viewMonth);
  const refIdx = monthIndex(refYear, refMonth);
  const isFutureOrCurrent = viewIdx >= refIdx;

  const entries = params.recurringEntries.filter(
    (e) => !e.es_ingreso && (isAhorroInversionTipo(e.tipo_partida) || e.bloque === "ahorro_inversion"),
  );

  const rows: AhorroProjectionRow[] = [];
  if (!isFutureOrCurrent) {
    return {
      viewMonth: params.viewMonth,
      viewYear: params.viewYear,
      isFutureOrCurrent: false,
      rows: [],
      totalBalanceNow: 0,
      totalPlannedThroughView: 0,
      totalProjected: 0,
      totalProjectedCompound: 0,
    };
  }

  const months = eachMonthInclusive(refMonth, refYear, params.viewMonth, params.viewYear);
  const movedThisMonth = movedThisMonthSet(params.monthlyBudgets, refMonth, refYear);

  for (const entry of entries) {
    const balanceNow = entryBalanceNow(entry, params.accounts, params.investments);
    const rate = Number(entry.rentabilidad_anual_pct || 0);
    const hasRate = rate > 0;
    const monthlyRate = rate / 100 / 12;
    let compoundValue = balanceNow;
    let plannedThroughView = 0;
    for (const { month, year } of months) {
      if (month === refMonth && year === refYear && movedThisMonth.has(entry.id)) continue;
      const contribution = plannedEntryAmountInMonth(entry, params.monthlyBudgets, month, year);
      plannedThroughView += contribution;
      if (hasRate) compoundValue = compoundValue * (1 + monthlyRate) + contribution;
    }
    plannedThroughView = round2(plannedThroughView);
    if (balanceNow <= 0.005 && plannedThroughView <= 0.005) continue;
    rows.push({
      entryId: entry.id,
      nombre: entry.nombre,
      balanceNow: round2(balanceNow),
      plannedThroughView,
      projected: round2(balanceNow + plannedThroughView),
      projectedCompound: hasRate ? round2(compoundValue) : null,
    });
  }

  rows.sort((a, b) => b.projected - a.projected || a.nombre.localeCompare(b.nombre, "es"));
  const totalBalanceNow = round2(rows.reduce((s, r) => s + r.balanceNow, 0));
  const totalPlannedThroughView = round2(rows.reduce((s, r) => s + r.plannedThroughView, 0));
  const totalProjected = round2(rows.reduce((s, r) => s + r.projected, 0));
  const totalProjectedCompound = round2(rows.reduce((s, r) => s + (r.projectedCompound ?? r.projected), 0));

  return {
    viewMonth: params.viewMonth,
    viewYear: params.viewYear,
    isFutureOrCurrent: true,
    rows,
    totalBalanceNow,
    totalPlannedThroughView,
    totalProjected,
    totalProjectedCompound,
  };
}

export type AhorroLongHorizonRow = {
  entryId: number;
  targetMonth: number;
  targetYear: number;
  horizonSource: "goal" | "objetivo_fecha" | "fallback";
  balanceNow: number;
  /** Saldo actual + aportaciones nominales hasta la fecha objetivo, sin interés. */
  totalContributed: number;
  projectedCompound: number;
  /** projectedCompound - totalContributed. */
  gains: number;
};

/**
 * Proyección a largo plazo (fecha objetivo del goal/partida, o un horizonte por defecto)
 * con interés compuesto. Solo genera fila para partidas con rentabilidad_anual_pct > 0.
 */
export function projectAhorroLongHorizon(params: {
  recurringEntries: RecurringEntry[];
  monthlyBudgets: MonthlyBudget[];
  accounts: Account[];
  investments: Investment[];
  goals: Goal[];
  refMonth?: number;
  refYear?: number;
  fallbackHorizonYears?: number;
}): AhorroLongHorizonRow[] {
  const now = new Date();
  const refMonth = params.refMonth ?? now.getMonth() + 1;
  const refYear = params.refYear ?? now.getFullYear();
  const refIdx = monthIndex(refYear, refMonth);
  const fallbackYears = params.fallbackHorizonYears ?? 10;

  const entries = params.recurringEntries.filter(
    (e) =>
      !e.es_ingreso &&
      (isAhorroInversionTipo(e.tipo_partida) || e.bloque === "ahorro_inversion") &&
      Number(e.rentabilidad_anual_pct || 0) > 0,
  );

  const movedThisMonth = movedThisMonthSet(params.monthlyBudgets, refMonth, refYear);
  const rows: AhorroLongHorizonRow[] = [];

  for (const entry of entries) {
    let targetMonth: number;
    let targetYear: number;
    let horizonSource: AhorroLongHorizonRow["horizonSource"];

    const goal = findGoalForEntry(params.goals, entry);
    if (goal?.fecha_limite) {
      const parsed = parseInstallmentDate(goal.fecha_limite);
      targetMonth = parsed.month;
      targetYear = parsed.year;
      horizonSource = "goal";
    } else if (entry.objetivo_fecha) {
      const parsed = parseInstallmentDate(entry.objetivo_fecha);
      targetMonth = parsed.month;
      targetYear = parsed.year;
      horizonSource = "objetivo_fecha";
    } else {
      const target = addCalendarMonths(refMonth, refYear, fallbackYears * 12);
      targetMonth = target.month;
      targetYear = target.year;
      horizonSource = "fallback";
    }

    if (monthIndex(targetYear, targetMonth) <= refIdx) continue;

    const balanceNow = entryBalanceNow(entry, params.accounts, params.investments);
    const monthlyRate = Number(entry.rentabilidad_anual_pct || 0) / 100 / 12;
    const months = eachMonthInclusive(refMonth, refYear, targetMonth, targetYear);

    let compoundValue = balanceNow;
    let totalContributed = balanceNow;
    for (const { month, year } of months) {
      if (month === refMonth && year === refYear && movedThisMonth.has(entry.id)) continue;
      const contribution = plannedEntryAmountInMonth(entry, params.monthlyBudgets, month, year);
      compoundValue = compoundValue * (1 + monthlyRate) + contribution;
      totalContributed += contribution;
    }

    rows.push({
      entryId: entry.id,
      targetMonth,
      targetYear,
      horizonSource,
      balanceNow: round2(balanceNow),
      totalContributed: round2(totalContributed),
      projectedCompound: round2(compoundValue),
      gains: round2(compoundValue - totalContributed),
    });
  }

  return rows;
}

export type DebtProjectionRow = {
  debtId: number;
  nombre: string;
  remainingNow: number;
  plannedPaymentsThroughView: number;
  projectedRemaining: number;
};

export type DebtProjectionSummary = {
  viewMonth: number;
  viewYear: number;
  isFutureOrCurrent: boolean;
  rows: DebtProjectionRow[];
  totalRemainingNow: number;
  totalPlannedPayments: number;
  totalProjectedRemaining: number;
};

/**
 * Predicción de saldo pendiente de deudas al mes de presupuesto visto:
 * pendiente actual − cuotas planificadas no pagadas desde el mes de referencia hasta el visto.
 */
export function projectDebtAtBudgetMonth(params: {
  viewMonth: number;
  viewYear: number;
  refMonth?: number;
  refYear?: number;
  debts: Debt[];
  debtInstallments: DebtInstallment[];
  refDate?: Date;
}): DebtProjectionSummary {
  const now = params.refDate ?? new Date();
  const refMonth = params.refMonth ?? now.getMonth() + 1;
  const refYear = params.refYear ?? now.getFullYear();
  const viewIdx = monthIndex(params.viewYear, params.viewMonth);
  const refIdx = monthIndex(refYear, refMonth);
  const isFutureOrCurrent = viewIdx >= refIdx;

  if (!isFutureOrCurrent) {
    return {
      viewMonth: params.viewMonth,
      viewYear: params.viewYear,
      isFutureOrCurrent: false,
      rows: [],
      totalRemainingNow: 0,
      totalPlannedPayments: 0,
      totalProjectedRemaining: 0,
    };
  }

  const months = eachMonthInclusive(refMonth, refYear, params.viewMonth, params.viewYear);
  const rows: DebtProjectionRow[] = [];

  for (const debt of params.debts) {
    if (debt.archivada) continue;
    const remainingNow = round2(Math.max(0, Number(debt.monto_total) - Number(debt.monto_pagado || 0)));
    if (remainingNow <= 0.01) continue;

    const planilla = params.debtInstallments.filter((i) => i.debt_id === debt.id);
    let plannedPayments = 0;

    for (const { month, year } of months) {
      if (planilla.length > 0) {
        for (const inst of planilla) {
          if (!installmentMatchesMonth(inst, month, year)) continue;
          if (!installmentPendingForDebt(inst, debt, planilla)) continue;
          plannedPayments += Number(inst.cuota_total || 0);
        }
      } else {
        const schedule = remainingDebtPaymentSchedule(debt, now);
        for (const pay of schedule) {
          if (pay.month === month && pay.year === year) plannedPayments += pay.amount;
        }
      }
    }

    plannedPayments = round2(Math.min(plannedPayments, remainingNow));
    rows.push({
      debtId: debt.id,
      nombre: debt.nombre || debt.acreedor,
      remainingNow,
      plannedPaymentsThroughView: plannedPayments,
      projectedRemaining: round2(Math.max(0, remainingNow - plannedPayments)),
    });
  }

  rows.sort((a, b) => b.projectedRemaining - a.projectedRemaining || a.nombre.localeCompare(b.nombre, "es"));
  const totalRemainingNow = round2(rows.reduce((s, r) => s + r.remainingNow, 0));
  const totalPlannedPayments = round2(rows.reduce((s, r) => s + r.plannedPaymentsThroughView, 0));
  const totalProjectedRemaining = round2(rows.reduce((s, r) => s + r.projectedRemaining, 0));

  return {
    viewMonth: params.viewMonth,
    viewYear: params.viewYear,
    isFutureOrCurrent: true,
    rows,
    totalRemainingNow,
    totalPlannedPayments,
    totalProjectedRemaining,
  };
}
