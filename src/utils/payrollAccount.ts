import type { Account } from "../types";

export type PayrollAccountHistoryEntry = {
  account_id: number;
  account_alias: string;
  from_date: string;
  to_date?: string | null;
};

export type PayrollAccountConfig = {
  empresa: string;
  account_id?: number | null;
  account_alias?: string | null;
  income_mode?: string;
  history: PayrollAccountHistoryEntry[];
};

export function activeAccounts(accounts: Account[]): Account[] {
  return accounts.filter((account) => !account.archivada);
}

/** Cuentas visibles en la lista de Cuentas (activas y no ocultas). */
export function listVisibleAccounts(accounts: Account[]): Account[] {
  return activeAccounts(accounts).filter((account) => !account.oculta);
}

export function hiddenAccounts(accounts: Account[]): Account[] {
  return activeAccounts(accounts).filter((account) => account.oculta);
}

export function formatPayrollHistoryRange(entry: PayrollAccountHistoryEntry): string {
  const from = entry.from_date ? new Date(entry.from_date).toLocaleDateString("es-ES") : "—";
  const to = entry.to_date ? new Date(entry.to_date).toLocaleDateString("es-ES") : "actual";
  return `${from} → ${to}`;
}
