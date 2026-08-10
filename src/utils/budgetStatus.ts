export type BudgetStatus = "ok" | "warn" | "crit";

/** Gasto: por debajo del objetivo = ok */
export function expenseGaugeStatus(pct: number, target: number): BudgetStatus {
  if (pct <= target) return "ok";
  if (pct > target * 1.1) return "crit";
  return "warn";
}

/** Ahorro/inversión: por encima del objetivo = ok */
export function savingsGaugeStatus(pct: number, target = 20): BudgetStatus {
  if (pct >= target) return "ok";
  if (pct >= target * 0.5) return "warn";
  return "crit";
}

export function statusClass(prefix: string, status: BudgetStatus): string {
  return `${prefix}--${status}`;
}
