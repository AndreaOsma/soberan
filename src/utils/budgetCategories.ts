import type { RecurringEntry, Transaction } from "../types";
import {
  SUBSCRIPTION_CATEGORY,
  budgetExpenseCategoryOptions,
  categoryOptionsForAmount,
  normalizeCategory,
} from "./expenseCategories";

/** Categorías de partidas del presupuesto, normalizadas a la taxonomía. */
export function budgetCategories(recurringEntries: RecurringEntry[]): string[] {
  const cats = new Set<string>();
  for (const entry of recurringEntries) {
    if (entry.tipo_partida === "suscripcion") {
      cats.add(SUBSCRIPTION_CATEGORY);
      continue;
    }
    const cat = normalizeCategory(entry.categoria) || (entry.categoria || "").trim();
    if (cat) cats.add(cat);
  }
  return [...cats].sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * Opciones de categoría para transacciones: taxonomía fija según signo.
 * Si amount es null, mezcla gasto+ingreso (filtros globales).
 * Incluye categoría legacy actual de cada tx solo si se pasa currentVia transactions
 * y no está en la taxonomía (para no perder el valor en el select).
 */
export function transactionCategoryOptions(
  _recurringEntries: RecurringEntry[],
  transactions: Transaction[] = [],
  amount?: number | null,
): string[] {
  if (amount != null && Number.isFinite(amount)) {
    const currents = transactions
      .filter((t) => Number(t.amount) === amount || Math.sign(Number(t.amount)) === Math.sign(amount) || amount === 0)
      .map((t) => t.category_anon);
    // Prefer options for this amount; include any legacy from related txs
    const opts = new Set(categoryOptionsForAmount(amount));
    for (const c of currents) {
      const trimmed = (c || "").trim();
      if (trimmed) opts.add(trimmed);
    }
    return [...opts].sort((a, b) => a.localeCompare(b, "es"));
  }

  // Filter / global list: all expense + income
  const opts = new Set([
    ...categoryOptionsForAmount(-1),
    ...categoryOptionsForAmount(1),
  ]);
  for (const tx of transactions) {
    const cat = (tx.category_anon || "").trim();
    if (cat) opts.add(cat);
  }
  return [...opts].sort((a, b) => a.localeCompare(b, "es"));
}

export { budgetExpenseCategoryOptions, categoryOptionsForAmount, normalizeCategory, SUBSCRIPTION_CATEGORY };
