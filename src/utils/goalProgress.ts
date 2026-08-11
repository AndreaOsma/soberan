import type { Account, Debt, Goal, Investment, MonthlyBudget, RecurringEntry } from "../types";
import { destinoFromEntry, isAhorroInversionTipo } from "./budgetTipo";
import { recurringEntryAppliesToMonth } from "./subscriptionBudget";

export type GoalDestino =
  | { type: "cuenta"; accountId: number }
  | { type: "cartera"; cartera: string }
  | { type: "partidas" };

export type GoalProgressOptions = {
  debts?: Debt[];
  fondoBalances?: Record<number, number>;
};

export function goalDestino(goal: Goal): GoalDestino | null {
  if (goal.account_id) return { type: "cuenta", accountId: goal.account_id };
  const cartera = (goal.cartera_destino || "").trim();
  if (cartera) return { type: "cartera", cartera };
  return { type: "partidas" };
}

export function goalHasDestino(goal: Goal): boolean {
  return goalDestino(goal) !== null;
}

export function goalFundingKind(goal: Goal): "cuenta" | "cartera" | "partidas" {
  const d = goalDestino(goal);
  if (!d || d.type === "partidas") return "partidas";
  return d.type;
}

export function findGoalById(goals: Goal[], goalId?: number | null): Goal | undefined {
  if (!goalId) return undefined;
  return goals.find((g) => g.id === goalId);
}

export function findGoalForDestino(
  goals: Goal[],
  accountId?: number | null,
  cartera?: string | null,
): Goal | undefined {
  const c = (cartera || "").trim();
  if (accountId) {
    return goals.find((g) => g.account_id === accountId);
  }
  if (c) {
    return goals.find((g) => (g.cartera_destino || "").trim() === c);
  }
  return undefined;
}

export function findGoalForEntry(
  goals: Goal[],
  entry: Pick<RecurringEntry, "id" | "goal_id" | "cuenta_destino_id" | "cartera_destino" | "tipo_partida">,
): Goal | undefined {
  if (entry.goal_id) return findGoalById(goals, entry.goal_id);
  const destino = destinoFromEntry(entry);
  if (destino === "cuenta" && entry.cuenta_destino_id) {
    return findGoalForDestino(goals, entry.cuenta_destino_id, null);
  }
  if (destino === "cartera" && entry.cartera_destino?.trim()) {
    return findGoalForDestino(goals, null, entry.cartera_destino);
  }
  return undefined;
}

export function goalLinkedDebts(debts: Debt[], goalId: number): Debt[] {
  return debts.filter((d) => d.goal_id === goalId);
}

export function goalLinkedEntries(recurringEntries: RecurringEntry[], goalId: number): RecurringEntry[] {
  return recurringEntries.filter(
    (e) => e.goal_id === goalId && !e.es_ingreso && (e.es_puntual || e.es_fondo),
  );
}

export function carteraTotal(investments: Investment[], cartera: string): number {
  const key = cartera.trim();
  return investments
    .filter((i) => (i.cartera || "").trim() === key)
    .reduce((s, i) => s + Number(i.valor_actual || 0), 0);
}

function debtPaidAmount(debt: Debt): number {
  return Number(debt.monto_pagado_registrado ?? debt.monto_pagado ?? 0);
}

function accumulatedEntryBudget(
  entryId: number,
  monthlyBudgets: MonthlyBudget[],
  upToMonth: number,
  upToYear: number,
): number {
  return monthlyBudgets
    .filter((mb) => mb.recurring_entry_id === entryId && !mb.excluido)
    .filter((mb) => mb.anio < upToYear || (mb.anio === upToYear && mb.mes <= upToMonth))
    .reduce((s, mb) => s + Number(mb.monto_real || 0), 0);
}

export function goalPartidasCurrentAmount(
  goal: Goal,
  recurringEntries: RecurringEntry[],
  monthlyBudgets: MonthlyBudget[],
  month: number,
  year: number,
  opts: GoalProgressOptions = {},
): number {
  const debts = opts.debts ?? [];
  let total = 0;
  for (const debt of goalLinkedDebts(debts, goal.id)) {
    total += debtPaidAmount(debt);
  }
  for (const entry of goalLinkedEntries(recurringEntries, goal.id)) {
    if (entry.es_fondo) {
      total += opts.fondoBalances?.[entry.id] ?? 0;
    } else {
      total += accumulatedEntryBudget(entry.id, monthlyBudgets, month, year);
    }
  }
  return total;
}

export function goalCurrentAmount(
  goal: Goal,
  accounts: Account[],
  investments: Investment[],
  recurringEntries: RecurringEntry[] = [],
  monthlyBudgets: MonthlyBudget[] = [],
  month = 1,
  year = 2026,
  opts: GoalProgressOptions = {},
): number {
  const destino = goalDestino(goal);
  if (destino?.type === "cuenta") {
    const acc = accounts.find((a) => a.id === destino.accountId);
    return acc ? Number(acc.balance_actual || 0) : Number(goal.monto_actual || 0);
  }
  if (destino?.type === "cartera") {
    return carteraTotal(investments, destino.cartera);
  }
  const partidas = goalPartidasCurrentAmount(goal, recurringEntries, monthlyBudgets, month, year, opts);
  if (partidas > 0) return partidas;
  return Number(goal.monto_actual || 0);
}

export function goalProgressPct(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, (current / target) * 100));
}

export function goalBudgetEntries(
  goal: Goal,
  recurringEntries: RecurringEntry[],
): RecurringEntry[] {
  const destino = goalDestino(goal);
  if (!destino || destino.type === "partidas") {
    return goalLinkedEntries(recurringEntries, goal.id);
  }
  return recurringEntries.filter((entry) => {
    if (entry.es_ingreso || !isAhorroInversionTipo(entry.tipo_partida)) return false;
    if (destino.type === "cuenta") {
      return entry.cuenta_destino_id === destino.accountId;
    }
    return (entry.cartera_destino || "").trim() === destino.cartera;
  });
}

export function goalMonthlyContribution(
  goal: Goal,
  recurringEntries: RecurringEntry[],
  monthlyBudgets: MonthlyBudget[],
  month: number,
  year: number,
  opts: GoalProgressOptions = {},
): number {
  const mbMap: Record<number, number> = {};
  for (const mb of monthlyBudgets) {
    if (mb.mes === month && mb.anio === year && !mb.excluido) {
      mbMap[mb.recurring_entry_id] = mb.monto_real;
    }
  }
  const excluded = new Set(
    monthlyBudgets
      .filter((mb) => mb.mes === month && mb.anio === year && mb.excluido)
      .map((mb) => mb.recurring_entry_id),
  );

  let total = goalBudgetEntries(goal, recurringEntries).reduce((sum, entry) => {
    if (excluded.has(entry.id)) return sum;
    if (!recurringEntryAppliesToMonth(entry, month, year)) return sum;
    return sum + (mbMap[entry.id] ?? Number(entry.monto_estimado || 0));
  }, 0);

  const debts = opts.debts ?? [];
  for (const debt of goalLinkedDebts(debts, goal.id)) {
    if (debt.archivada) continue;
    total += Number(debt.cuota_mensual || 0);
  }

  return total;
}

export function estimateGoalMonthsRemaining(remaining: number, monthlyContribution: number): number | null {
  if (remaining <= 0) return 0;
  if (monthlyContribution <= 0) return null;
  return Math.ceil(remaining / monthlyContribution);
}

export function addCalendarMonths(month: number, year: number, delta: number): { month: number; year: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function formatMonthYear(month: number, year: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("es", { month: "short", year: "numeric" });
}

export function formatGoalEta(monthsRemaining: number | null, fromMonth: number, fromYear: number): string | null {
  if (monthsRemaining === null) return null;
  if (monthsRemaining <= 0) return "Objetivo alcanzado";
  const target = addCalendarMonths(fromMonth, fromYear, monthsRemaining);
  const label = formatMonthYear(target.month, target.year);
  const meses = monthsRemaining === 1 ? "1 mes" : `${monthsRemaining} meses`;
  return `~${meses} · ${label}`;
}

export type GoalProgressSnapshot = {
  goal: Goal;
  current: number;
  target: number;
  pct: number;
  remaining: number;
  monthlyContribution: number;
  monthsRemaining: number | null;
  etaLabel: string | null;
  isComplete: boolean;
  fundingKind: "cuenta" | "cartera" | "partidas";
  linkedDebtsCount: number;
  linkedEntriesCount: number;
};

export function buildGoalProgressSnapshot(
  goal: Goal,
  accounts: Account[],
  investments: Investment[],
  recurringEntries: RecurringEntry[],
  monthlyBudgets: MonthlyBudget[],
  month: number,
  year: number,
  opts: GoalProgressOptions = {},
): GoalProgressSnapshot {
  const current = goalCurrentAmount(goal, accounts, investments, recurringEntries, monthlyBudgets, month, year, opts);
  const target = Number(goal.monto_objetivo || 0);
  const remaining = Math.max(0, target - current);
  const monthlyContribution = goalMonthlyContribution(goal, recurringEntries, monthlyBudgets, month, year, opts);
  const monthsRemaining = estimateGoalMonthsRemaining(remaining, monthlyContribution);
  return {
    goal,
    current,
    target,
    pct: goalProgressPct(current, target),
    remaining,
    monthlyContribution,
    monthsRemaining,
    etaLabel: formatGoalEta(monthsRemaining, month, year),
    isComplete: current >= target && target > 0,
    fundingKind: goalFundingKind(goal),
    linkedDebtsCount: goalLinkedDebts(opts.debts ?? [], goal.id).length,
    linkedEntriesCount: goalLinkedEntries(recurringEntries, goal.id).length,
  };
}

export function goalProgressLabel(snapshot: GoalProgressSnapshot): string {
  if (snapshot.fundingKind === "cuenta") return "saldo en cuenta";
  if (snapshot.fundingKind === "cartera") return "valor en cartera";
  const parts: string[] = [];
  if (snapshot.linkedDebtsCount > 0) parts.push(`${snapshot.linkedDebtsCount} deuda${snapshot.linkedDebtsCount === 1 ? "" : "s"}`);
  if (snapshot.linkedEntriesCount > 0) {
    parts.push(`${snapshot.linkedEntriesCount} partida${snapshot.linkedEntriesCount === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "sin partidas vinculadas";
}
