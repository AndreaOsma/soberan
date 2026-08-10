import type { Account, Transaction, TransactionCreate } from "../types";

export type PayrollCompanyConfig = Record<string, { account_id?: number; income_mode?: string } | unknown>;

export function payrollIncomeTxDescription(empresa: string, month: number, year: number): string {
  return `Nómina ${empresa} ${month}/${year}`;
}

export function otherIncomeTxDescription(nombre: string, month: number, year: number): string {
  return `Ingreso ${nombre} ${month}/${year}`;
}

export function resolveIncomeAccountId(
  accounts: Account[],
  opts?: { empresa?: string; payrollConfig?: PayrollCompanyConfig; preferredAccountId?: number | null },
): number | null {
  if (opts?.preferredAccountId != null) {
    const preferred = accounts.find((a) => a.id === opts.preferredAccountId && !a.archivada);
    if (preferred) return preferred.id;
  }
  const empresa = (opts?.empresa || "").trim().toLowerCase();
  if (empresa && opts?.payrollConfig) {
    const cfg = opts.payrollConfig[empresa] as { account_id?: number } | undefined;
    if (cfg?.account_id != null) {
      const fromCfg = accounts.find((a) => a.id === cfg.account_id && !a.archivada);
      if (fromCfg) return fromCfg.id;
    }
  }
  const firstActive = accounts.find((a) => !a.archivada);
  return firstActive?.id ?? null;
}

/** Día de cobro: 1 por defecto; "penultimate" = penúltimo día del mes. */
export function incomeTxDateIso(
  year: number,
  month: number,
  opts?: { incomeMode?: string; day?: number },
): string {
  const mode = opts?.incomeMode || "fixed";
  const lastDay = new Date(year, month, 0).getDate();
  let day = opts?.day && opts.day >= 1 ? Math.min(opts.day, lastDay) : 1;
  if (mode === "penultimate") {
    day = Math.max(1, lastDay - 1);
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function findIncomeTxByDescription(
  transactions: Transaction[],
  description: string,
): Transaction | undefined {
  return transactions.find((tx) => tx.description_raw === description && tx.amount > 0);
}

export type EnsureIncomeTxDeps = {
  createTransaction: (payload: TransactionCreate) => Promise<Transaction>;
  updateTransaction: (id: number, payload: TransactionCreate) => Promise<Transaction>;
};

export async function ensureIncomeTransaction(
  deps: EnsureIncomeTxDeps,
  params: {
    description: string;
    amount: number;
    accountId: number;
    category: string;
    date: string;
    existing: Transaction[];
  },
): Promise<"created" | "updated" | "skipped"> {
  if (params.amount <= 0.005) return "skipped";
  const found = findIncomeTxByDescription(params.existing, params.description);
  const payload: TransactionCreate = {
    account_id: params.accountId,
    amount: Math.round(params.amount * 100) / 100,
    category_anon: params.category || "Otros ingresos",
    description_raw: params.description,
    date: params.date,
  };
  if (found) {
    if (
      Math.abs(found.amount - payload.amount) < 0.005
      && found.account_id === payload.account_id
      && found.date.slice(0, 10) === payload.date
    ) {
      return "skipped";
    }
    await deps.updateTransaction(found.id, payload);
    return "updated";
  }
  await deps.createTransaction(payload);
  return "created";
}
