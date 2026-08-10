import type { Debt, DebtInstallment, MonthlyBudget, RecurringEntry, SalaryBreakdown, WorkHistory } from "../types";
import { incomeRealAmount, isPayrollIncomeEntry, payrollBudgetRows } from "./budgetIncome";
import { isAhorroInversionTipo } from "./budgetTipo";
import { computeMonthlyBudgetTotals } from "./budgetTotals";
import { budgetDebtRowsForTotal, dedupedBudgetDebtRows, recurringExpenseNames } from "./debtInstallments";
import {
  recurringEntryAppliesToMonth,
  subscriptionAppliesToMonth,
  subscriptionMonthlyAmount,
} from "./subscriptionBudget";

export const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"] as const;

export type AnnualBudgetLineGroup = "income" | "fondos" | "puntual" | "subs" | "debt" | "ahorro";

export type AnnualBudgetLineItem = {
  key: string;
  label: string;
  amount: number;
  group: AnnualBudgetLineGroup;
};

export const ANNUAL_BUDGET_LINE_GROUP_LABELS: Record<AnnualBudgetLineGroup, string> = {
  income: "Ingresos",
  fondos: "Fondos",
  puntual: "Gastos planificados",
  subs: "Suscripciones y facturas",
  debt: "Deudas",
  ahorro: "Ahorro e inversión",
};

export type AnnualBudgetMonthRow = {
  month: number;
  label: string;
  income: number;
  consumption: number;
  fondos: number;
  puntual: number;
  subs: number;
  debt: number;
  savings: number;
  expense: number;
  isCurrent: boolean;
  lines: AnnualBudgetLineItem[];
};

function entryAmount(entry: RecurringEntry, mbMap: Record<number, number>): number {
  return mbMap[entry.id] ?? Number(entry.monto_estimado || 0);
}

function buildMonthlyBudgetLines(params: {
  recurringEntries: RecurringEntry[];
  month: number;
  year: number;
  workHistory: WorkHistory[];
  salaryBreakdowns: SalaryBreakdown[];
  monthlyBudgets: MonthlyBudget[];
  debts: Debt[];
  debtInstallments: DebtInstallment[];
}): AnnualBudgetLineItem[] {
  const {
    recurringEntries,
    month,
    year,
    workHistory,
    salaryBreakdowns,
    monthlyBudgets,
    debts,
    debtInstallments,
  } = params;

  const excludedIds = new Set(
    monthlyBudgets.filter((row) => row.excluido).map((row) => row.recurring_entry_id),
  );
  const mbMap: Record<number, number> = {};
  for (const row of monthlyBudgets) {
    if (!row.excluido) mbMap[row.recurring_entry_id] = row.monto_real;
  }

  const applies = (entry: RecurringEntry) => recurringEntryAppliesToMonth(entry, month, year);
  const lines: AnnualBudgetLineItem[] = [];

  for (const row of payrollBudgetRows(workHistory, salaryBreakdowns, recurringEntries, month, year)) {
    const amount = incomeRealAmount(row.expected, row.recurringEntryId, mbMap);
    if (amount <= 0) continue;
    lines.push({
      key: row.key,
      label: `Nómina ${row.empresa}`,
      amount,
      group: "income",
    });
  }

  for (const entry of recurringEntries) {
    if (!entry.es_ingreso || isPayrollIncomeEntry(entry) || excludedIds.has(entry.id) || !applies(entry)) continue;
    const amount = incomeRealAmount(entry.monto_estimado, entry.id, mbMap);
    if (amount <= 0) continue;
    lines.push({ key: `income-${entry.id}`, label: entry.nombre, amount, group: "income" });
  }

  const gastoEntries = recurringEntries.filter(
    (entry) =>
      !entry.es_ingreso
      && (entry.tipo_partida ?? "gasto") === "gasto"
      && !excludedIds.has(entry.id)
      && applies(entry),
  );

  for (const entry of gastoEntries.filter((e) => e.es_fondo)) {
    const amount = entryAmount(entry, mbMap);
    if (amount <= 0) continue;
    lines.push({ key: `fondo-${entry.id}`, label: entry.nombre, amount, group: "fondos" });
  }

  for (const entry of gastoEntries.filter((e) => e.es_puntual && !e.es_fondo)) {
    const amount = entryAmount(entry, mbMap);
    if (amount <= 0) continue;
    lines.push({ key: `puntual-${entry.id}`, label: entry.nombre, amount, group: "puntual" });
  }

  for (const entry of recurringEntries) {
    if (entry.tipo_partida !== "suscripcion" || excludedIds.has(entry.id)) continue;
    if (!subscriptionAppliesToMonth(entry, month, year)) continue;
    const amount = subscriptionMonthlyAmount(entry, month, year);
    if (amount <= 0) continue;
    lines.push({ key: `sub-${entry.id}`, label: entry.nombre, amount, group: "subs" });
  }

  for (const row of budgetDebtRowsForTotal(
    dedupedBudgetDebtRows(debts, debtInstallments, month, year, recurringExpenseNames(recurringEntries)),
  )) {
    if (row.assigned <= 0) continue;
    lines.push({
      key: `debt-${row.debtId}-${row.installmentId}`,
      label: row.nombre,
      amount: row.assigned,
      group: "debt",
    });
  }

  const ahorroEntries = recurringEntries.filter(
    (entry) =>
      !entry.es_ingreso
      && isAhorroInversionTipo(entry.tipo_partida)
      && !excludedIds.has(entry.id)
      && applies(entry),
  );
  for (const entry of ahorroEntries) {
    const amount = entryAmount(entry, mbMap);
    if (amount <= 0) continue;
    lines.push({ key: `ahorro-${entry.id}`, label: entry.nombre, amount, group: "ahorro" });
  }
  for (const entry of gastoEntries.filter((e) => e.bloque === "ahorro_inversion")) {
    const amount = entryAmount(entry, mbMap);
    if (amount <= 0) continue;
    lines.push({ key: `ahorro-gasto-${entry.id}`, label: entry.nombre, amount, group: "ahorro" });
  }

  return lines.sort((a, b) => {
    const groupOrder: AnnualBudgetLineGroup[] = ["income", "fondos", "puntual", "subs", "debt", "ahorro"];
    const ga = groupOrder.indexOf(a.group);
    const gb = groupOrder.indexOf(b.group);
    if (ga !== gb) return ga - gb;
    return a.label.localeCompare(b.label, "es");
  });
}

export type AnnualBudgetSummary = {
  months: AnnualBudgetMonthRow[];
  totals: {
    income: number;
    consumption: number;
    fondos: number;
    puntual: number;
    subs: number;
    debt: number;
    savings: number;
    expense: number;
  };
};

export function buildAnnualBudgetSummary(params: {
  year: number;
  recurringEntries: RecurringEntry[];
  workHistory: WorkHistory[];
  salaryBreakdowns: SalaryBreakdown[];
  monthlyBudgetsByMonth: Record<number, MonthlyBudget[]>;
  debts: Debt[];
  debtInstallments: DebtInstallment[];
  currentMonth?: number;
  currentYear?: number;
}): AnnualBudgetSummary {
  const {
    year,
    recurringEntries,
    workHistory,
    salaryBreakdowns,
    monthlyBudgetsByMonth,
    debts,
    debtInstallments,
    currentMonth = new Date().getMonth() + 1,
    currentYear = new Date().getFullYear(),
  } = params;

  const months: AnnualBudgetMonthRow[] = [];
  let income = 0;
  let consumption = 0;
  let fondos = 0;
  let puntual = 0;
  let subs = 0;
  let debt = 0;
  let savings = 0;
  let expense = 0;

  for (let m = 1; m <= 12; m++) {
    const breakdowns = salaryBreakdowns.filter((b) => b.mes === m && b.anio === year);
    const totals = computeMonthlyBudgetTotals({
      recurringEntries,
      month: m,
      year,
      workHistory,
      salaryBreakdowns: breakdowns,
      monthlyBudgets: monthlyBudgetsByMonth[m] ?? [],
      debts,
      debtInstallments,
    });
    const monthlyBudgets = monthlyBudgetsByMonth[m] ?? [];
    months.push({
      month: m,
      label: MONTH_SHORT[m - 1]!,
      income: totals.monthlyIncome,
      consumption: totals.monthlyConsumption,
      fondos: totals.monthlyFondos,
      puntual: totals.monthlyPuntual,
      subs: totals.monthlySubs,
      debt: totals.monthlyDebtPayments,
      savings: totals.monthlySavings,
      expense: totals.monthlyExpense,
      isCurrent: m === currentMonth && year === currentYear,
      lines: buildMonthlyBudgetLines({
        recurringEntries,
        month: m,
        year,
        workHistory,
        salaryBreakdowns: breakdowns,
        monthlyBudgets,
        debts,
        debtInstallments,
      }),
    });
    income += totals.monthlyIncome;
    consumption += totals.monthlyConsumption;
    fondos += totals.monthlyFondos;
    puntual += totals.monthlyPuntual;
    subs += totals.monthlySubs;
    debt += totals.monthlyDebtPayments;
    savings += totals.monthlySavings;
    expense += totals.monthlyExpense;
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    months,
    totals: {
      income: round2(income),
      consumption: round2(consumption),
      fondos: round2(fondos),
      puntual: round2(puntual),
      subs: round2(subs),
      debt: round2(debt),
      savings: round2(savings),
      expense: round2(expense),
    },
  };
}

export type AnnualNameTotal = { label: string; amount: number };

/** Suma anual por nombre de partida dentro de los grupos indicados. */
export function sumAnnualLinesByName(
  months: AnnualBudgetMonthRow[],
  groups: AnnualBudgetLineGroup[],
): AnnualNameTotal[] {
  const allowed = new Set(groups);
  const map = new Map<string, number>();
  for (const month of months) {
    for (const line of month.lines) {
      if (!allowed.has(line.group) || line.amount <= 0) continue;
      const key = line.label.trim() || "Sin nombre";
      map.set(key, (map.get(key) ?? 0) + line.amount);
    }
  }
  return [...map.entries()]
    .map(([label, amount]) => ({ label, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "es"));
}
