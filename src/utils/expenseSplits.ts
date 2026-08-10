import type { Transaction, TransactionSplit } from "../types";
import { isExcludedFromBudget, isRealExpense, type BudgetRelevantTx } from "./internalTransfer";

export type SplitRelevantTx = BudgetRelevantTx & {
  splits?: TransactionSplit[] | null;
};

/** Positive amount that counts in budget spent (my share when split). */
export function budgetExpenseAmount(tx: SplitRelevantTx): number {
  if (!isRealExpense(tx)) return 0;
  const splits = tx.splits ?? [];
  if (splits.length === 0) return Math.abs(Number(tx.amount));
  const me = splits.find((s) => s.is_me);
  if (!me) return Math.abs(Number(tx.amount));
  return Math.max(0, Number(me.amount) || 0);
}

export function hasExpenseSplits(tx: Pick<Transaction, "splits" | "amount">): boolean {
  return Number(tx.amount) < 0 && (tx.splits?.length ?? 0) > 0;
}

export function unsettledOwedByPerson(transactions: Transaction[]): Array<{ person_name: string; amount: number }> {
  const map = new Map<string, number>();
  for (const tx of transactions) {
    if (Number(tx.amount) >= 0) continue;
    if (isExcludedFromBudget(tx)) {
      // Still track debts even if omitted? Prefer tracking — user still is owed money.
    }
    for (const split of tx.splits ?? []) {
      if (split.is_me || split.settled) continue;
      const name = (split.person_name || "").trim() || "Sin nombre";
      map.set(name, (map.get(name) || 0) + Number(split.amount || 0));
    }
  }
  return [...map.entries()]
    .map(([person_name, amount]) => ({ person_name, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount || a.person_name.localeCompare(b.person_name));
}

/** Suggest equal split among N people including me. */
export function equalSplitDraft(totalAbs: number, personNames: string[]): Array<{
  person_name: string;
  amount: number;
  is_me: boolean;
  settled: boolean;
}> {
  const names = personNames.map((n) => n.trim()).filter(Boolean);
  const count = names.length + 1; // + me
  if (count < 2 || totalAbs <= 0) return [];
  const cents = Math.round(totalAbs * 100);
  const base = Math.floor(cents / count);
  let rem = cents - base * count;
  const amounts: number[] = [];
  for (let i = 0; i < count; i++) {
    const extra = rem > 0 ? 1 : 0;
    if (rem > 0) rem -= 1;
    amounts.push((base + extra) / 100);
  }
  return [
    { person_name: "Yo", amount: amounts[0], is_me: true, settled: false },
    ...names.map((person_name, i) => ({
      person_name,
      amount: amounts[i + 1],
      is_me: false,
      settled: false,
    })),
  ];
}
