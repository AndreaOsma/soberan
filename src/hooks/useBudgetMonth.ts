import { useMemo } from "react";
import type { Debt, DebtInstallment, MonthlyBudget, RecurringEntry, SalaryBreakdown, Transaction, WorkHistory } from "../types";
import { isAhorroInversionTipo } from "../utils/budgetTipo";
import { budgetDebtRowsForTotal, dedupedBudgetDebtRows, recurringExpenseNames } from "../utils/debtInstallments";
import {
  incomeRealAmount,
  isPayrollIncomeEntry,
  payrollBudgetRows,
} from "../utils/budgetIncome";
import { split503020 } from "../utils/budgetTemplate";
import {
  recurringEntryAppliesToMonth,
  subscriptionAppliesToMonth,
  subscriptionMonthlyAmount,
} from "../utils/subscriptionBudget";
import { isRealExpense, isRealIncome } from "../utils/internalTransfer";
import { budgetExpenseAmount } from "../utils/expenseSplits";
import { normalizeCategory } from "../utils/expenseCategories";

const LIBRE_GASTO_NAME = "Libre";

function entryAppliesTo(entry: RecurringEntry, month: number, year: number): boolean {
  return recurringEntryAppliesToMonth(entry, month, year);
}

export function isLibrePlannedGasto(entry: Pick<RecurringEntry, "nombre" | "es_puntual" | "es_fondo">): boolean {
  return entry.nombre.trim().toLowerCase() === LIBRE_GASTO_NAME.toLowerCase()
    && Boolean(entry.es_puntual)
    && !entry.es_fondo;
}

type Params = {
  month: number;
  year: number;
  recurringEntries: RecurringEntry[];
  monthlyBudgets: MonthlyBudget[];
  workHistory: WorkHistory[];
  salaryBreakdowns: SalaryBreakdown[];
  debts: Debt[];
  debtInstallments: DebtInstallment[];
  monthlyTransactions: Transaction[];
};

export function useBudgetMonth({
  month,
  year,
  recurringEntries,
  monthlyBudgets,
  workHistory,
  salaryBreakdowns,
  debts,
  debtInstallments,
  monthlyTransactions,
}: Params) {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const hasOverrides = monthlyBudgets.length > 0;

  const prevMonthHasBudget = useMemo(
    () => monthlyBudgets.some((mb) => mb.mes === prevMonth && mb.anio === prevYear && !mb.excluido),
    [monthlyBudgets, prevMonth, prevYear],
  );

  const excludedIds = useMemo(
    () => new Set(monthlyBudgets.filter((mb) => mb.excluido).map((mb) => mb.recurring_entry_id)),
    [monthlyBudgets],
  );

  const mbMap = useMemo(() => {
    const m: Record<number, number> = {};
    for (const mb of monthlyBudgets) {
      if (!mb.excluido) m[mb.recurring_entry_id] = mb.monto_real;
    }
    return m;
  }, [monthlyBudgets]);

  const otherIncomeEntries = useMemo(
    () => recurringEntries.filter(
      (r) => r.es_ingreso && !isPayrollIncomeEntry(r) && !excludedIds.has(r.id) && entryAppliesTo(r, month, year),
    ),
    [recurringEntries, excludedIds, month, year],
  );

  const payrollRows = useMemo(
    () => payrollBudgetRows(workHistory, salaryBreakdowns, recurringEntries, month, year),
    [workHistory, salaryBreakdowns, recurringEntries, month, year],
  );

  const allSubscriptions = useMemo(
    () => recurringEntries.filter((r) => r.tipo_partida === "suscripcion"),
    [recurringEntries],
  );

  const activeSubscriptions = useMemo(
    () => allSubscriptions.filter(
      (sub) => !excludedIds.has(sub.id) && subscriptionAppliesToMonth(sub, month, year),
    ),
    [allSubscriptions, excludedIds, month, year],
  );

  const gastoEntries = useMemo(
    () => recurringEntries.filter(
      (r) => !r.es_ingreso && (r.tipo_partida ?? "gasto") === "gasto" && !excludedIds.has(r.id) && entryAppliesTo(r, month, year),
    ),
    [recurringEntries, excludedIds, month, year],
  );

  const fondoEntries = useMemo(() => gastoEntries.filter((e) => e.es_fondo), [gastoEntries]);
  const puntualGastoEntries = useMemo(() => gastoEntries.filter((e) => e.es_puntual && !e.es_fondo), [gastoEntries]);

  const ahorroInversionEntries = useMemo(
    () => recurringEntries.filter(
      (r) => !r.es_ingreso && isAhorroInversionTipo(r.tipo_partida) && !excludedIds.has(r.id) && entryAppliesTo(r, month, year),
    ),
    [recurringEntries, excludedIds, month, year],
  );

  const excludedEntries = useMemo(
    () => recurringEntries.filter((r) => excludedIds.has(r.id) && entryAppliesTo(r, month, year)),
    [recurringEntries, excludedIds, month, year],
  );

  const totalIncomeExpected = useMemo(() => {
    const payroll = payrollRows.reduce((s, r) => s + r.expected, 0);
    const other = otherIncomeEntries.reduce((s, e) => s + e.monto_estimado, 0);
    return payroll + other;
  }, [payrollRows, otherIncomeEntries]);

  const totalIncomeReal = useMemo(() => {
    const payroll = payrollRows.reduce(
      (s, r) => s + incomeRealAmount(r.expected, r.recurringEntryId, mbMap),
      0,
    );
    const other = otherIncomeEntries.reduce(
      (s, e) => s + incomeRealAmount(e.monto_estimado, e.id, mbMap),
      0,
    );
    return payroll + other;
  }, [payrollRows, otherIncomeEntries, mbMap]);

  const totalIncomeFromTx = useMemo(
    () => monthlyTransactions.filter(isRealIncome).reduce((s, tx) => s + tx.amount, 0),
    [monthlyTransactions],
  );

  /** Ingresos reales registrados en Movimientos (sin omitidos), para listarlos junto a las fuentes planificadas. */
  const realIncomeTx = useMemo(
    () => [...monthlyTransactions].filter(isRealIncome).sort((a, b) => b.date.localeCompare(a.date)),
    [monthlyTransactions],
  );

  const spentByCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const tx of monthlyTransactions) {
      if (!isRealExpense(tx)) continue;
      const cat = normalizeCategory(tx.category_anon) || "Sin categoría";
      m[cat] = (m[cat] || 0) + budgetExpenseAmount(tx);
    }
    return m;
  }, [monthlyTransactions]);

  const debtItems = useMemo(
    () => dedupedBudgetDebtRows(debts, debtInstallments, month, year, recurringExpenseNames(recurringEntries)),
    [debts, debtInstallments, month, year, recurringEntries],
  );

  const activeDebts = useMemo(
    () => debts.filter((d) => d.monto_total - d.monto_pagado > 0.01),
    [debts],
  );

  const totalFondosAssigned = useMemo(
    () => fondoEntries.reduce((s, e) => s + (mbMap[e.id] ?? e.monto_estimado), 0),
    [fondoEntries, mbMap],
  );
  const totalPuntualAssigned = useMemo(
    () => puntualGastoEntries.reduce((s, e) => s + (mbMap[e.id] ?? e.monto_estimado), 0),
    [puntualGastoEntries, mbMap],
  );
  const totalDeudasAssigned = useMemo(
    () => budgetDebtRowsForTotal(debtItems).reduce((s, d) => s + d.assigned, 0),
    [debtItems],
  );
  const totalSubsAssigned = useMemo(
    () => activeSubscriptions.reduce((s, sub) => {
      if (mbMap[sub.id] !== undefined) return s + mbMap[sub.id];
      return s + subscriptionMonthlyAmount(sub, month, year);
    }, 0),
    [activeSubscriptions, mbMap, month, year],
  );
  const totalGastosAssigned = totalFondosAssigned + totalPuntualAssigned + totalDeudasAssigned + totalSubsAssigned;
  const totalAhorroInversionAssigned = useMemo(
    () => ahorroInversionEntries.reduce((s, e) => s + (mbMap[e.id] ?? e.monto_estimado), 0),
    [ahorroInversionEntries, mbMap],
  );
  const totalAssigned = totalGastosAssigned + totalAhorroInversionAssigned;
  const availableToAssign = totalIncomeReal - totalAssigned;

  const incomeTxMismatchPct = useMemo(() => {
    if (totalIncomeReal <= 0.01 || totalIncomeFromTx <= 0.01) return 0;
    return Math.abs(totalIncomeFromTx - totalIncomeReal) / totalIncomeReal;
  }, [totalIncomeFromTx, totalIncomeReal]);

  const showIncomeReconcileBanner = incomeTxMismatchPct > 0.05;
  const budgetOverAssigned = availableToAssign < -0.01;

  const activeExpenseEntries = useMemo(
    () => recurringEntries.filter((r) => !r.es_ingreso && !excludedIds.has(r.id) && entryAppliesTo(r, month, year)),
    [recurringEntries, excludedIds, month, year],
  );
  const hasLibreEntry = activeExpenseEntries.some((e) => isLibrePlannedGasto(e));
  const hasAhorroEntry = activeExpenseEntries.some((e) => isAhorroInversionTipo(e.tipo_partida));
  const showFirstMonthAssistant = !prevMonthHasBudget && totalIncomeExpected > 0.01 && (!hasLibreEntry || !hasAhorroEntry);
  const templateSplit = split503020(totalIncomeExpected);

  const bloqueNecesidades = useMemo(() => {
    const fromEntries = gastoEntries.filter((e) => e.bloque === "necesidades").reduce((s, e) => s + (mbMap[e.id] ?? e.monto_estimado), 0);
    const fromSubs = activeSubscriptions.filter((s) => s.bloque === "necesidades").reduce((s, sub) => s + subscriptionMonthlyAmount(sub, month, year), 0);
    return fromEntries + fromSubs;
  }, [gastoEntries, activeSubscriptions, mbMap, month, year]);

  const bloqueDeseos = useMemo(() => {
    const fromEntries = gastoEntries.filter((e) => e.bloque === "deseos").reduce((s, e) => s + (mbMap[e.id] ?? e.monto_estimado), 0);
    const fromSubs = activeSubscriptions.filter((s) => s.bloque === "deseos").reduce((s, sub) => s + subscriptionMonthlyAmount(sub, month, year), 0);
    return fromEntries + fromSubs;
  }, [gastoEntries, activeSubscriptions, mbMap, month, year]);

  const bloqueAhorroInversion = useMemo(() => {
    const fromEntries = ahorroInversionEntries.reduce((s, e) => s + (mbMap[e.id] ?? e.monto_estimado), 0);
    const fromGastoBloque = gastoEntries.filter((e) => e.bloque === "ahorro_inversion").reduce((s, e) => s + (mbMap[e.id] ?? e.monto_estimado), 0);
    return fromEntries + fromGastoBloque;
  }, [ahorroInversionEntries, gastoEntries, mbMap]);

  const hasBloqueEntries = gastoEntries.some((e) => !!e.bloque) || activeSubscriptions.some((s) => !!s.bloque);

  return {
    prevMonth,
    prevYear,
    hasOverrides,
    prevMonthHasBudget,
    excludedIds,
    mbMap,
    otherIncomeEntries,
    payrollRows,
    allSubscriptions,
    activeSubscriptions,
    gastoEntries,
    fondoEntries,
    puntualGastoEntries,
    ahorroInversionEntries,
    excludedEntries,
    totalIncomeExpected,
    totalIncomeReal,
    totalIncomeFromTx,
    realIncomeTx,
    spentByCat,
    debtItems,
    activeDebts,
    totalFondosAssigned,
    totalPuntualAssigned,
    totalDeudasAssigned,
    totalSubsAssigned,
    totalGastosAssigned,
    totalAhorroInversionAssigned,
    totalAssigned,
    availableToAssign,
    incomeTxMismatchPct,
    showIncomeReconcileBanner,
    budgetOverAssigned,
    activeExpenseEntries,
    hasLibreEntry,
    hasAhorroEntry,
    showFirstMonthAssistant,
    templateSplit,
    bloqueNecesidades,
    bloqueDeseos,
    bloqueAhorroInversion,
    hasBloqueEntries,
  };
}
