import type { Transaction } from "../types";

export const INTERNAL_TRANSFER_CATEGORY = "Transferencia interna";

export type BudgetRelevantTx = Pick<
  Transaction,
  "amount" | "es_interna" | "es_pending" | "category_anon" | "excluida_presupuesto"
>;

export function isInternalTransfer(
  tx: Pick<Transaction, "es_interna" | "category_anon">,
): boolean {
  if (tx.es_interna) return true;
  return (tx.category_anon || "").trim().toLowerCase() === INTERNAL_TRANSFER_CATEGORY.toLowerCase();
}

/** Excluded from budget KPIs: internal transfer, pending bank tx, or user omit. */
export function isOmittedFromBudget(
  tx: Pick<BudgetRelevantTx, "excluida_presupuesto">,
): boolean {
  const flag = tx.excluida_presupuesto as unknown;
  return flag === true || flag === 1 || flag === "1" || flag === "true";
}

export function isExcludedFromBudget(tx: BudgetRelevantTx): boolean {
  if (isInternalTransfer(tx) || tx.es_pending || isOmittedFromBudget(tx)) return true;
  return false;
}

export function isRealExpense(tx: BudgetRelevantTx): boolean {
  if (isExcludedFromBudget(tx)) return false;
  return Number(tx.amount) < 0;
}

export function isRealIncome(tx: BudgetRelevantTx): boolean {
  if (isExcludedFromBudget(tx)) return false;
  return Number(tx.amount) > 0;
}
