import type { Account } from "../types";

const STALE_MS = 24 * 60 * 60 * 1000;

export function isBankLinked(account: Pick<Account, "gocardless_account_id">): boolean {
  return Boolean(account.gocardless_account_id);
}

export function linkedBankAccounts(accounts: Account[]): Account[] {
  return accounts.filter(isBankLinked);
}

export function formatBankLastSync(lastSyncAt?: string | null): string {
  if (!lastSyncAt) return "Sin sincronizar";
  const date = new Date(lastSyncAt);
  if (Number.isNaN(date.getTime())) return "Sin sincronizar";
  return date.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function prettyInstitutionName(name?: string | null, institutionId?: string | null): string {
  const raw = (name || institutionId || "Banco").trim();
  if (!raw) return "Banco";
  if (raw.includes("_") && raw === raw.toUpperCase()) {
    const head = raw.split("_")[0];
    return head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();
  }
  return raw;
}

export function bankAccountDisplayName(
  remote: {
    name?: string | null;
    iban?: string | null;
    gocardless_account_id: string;
  },
  institutionName?: string | null,
): string {
  const bank = prettyInstitutionName(institutionName);
  const label = remote.name?.trim();
  if (label) return label;
  if (remote.iban) return `${bank} · Cuenta ·${remote.iban.slice(-4)}`;
  return `${bank} · Cuenta`;
}

export function isBankSyncStale(lastSyncAt?: string | null): boolean {
  if (!lastSyncAt) return true;
  const date = new Date(lastSyncAt);
  if (Number.isNaN(date.getTime())) return true;
  return Date.now() - date.getTime() > STALE_MS;
}

export function formatBankImportMessage(imported: number, transactionsCreated?: number): string {
  if (imported <= 0 && (transactionsCreated ?? 0) <= 0) return "";
  const parts: string[] = [];
  if (imported > 0) {
    parts.push(`${imported} cuenta${imported === 1 ? "" : "s"} importada${imported === 1 ? "" : "s"}`);
  }
  const tx = transactionsCreated ?? 0;
  if (tx > 0) {
    parts.push(`${tx} movimiento${tx === 1 ? "" : "s"} cargado${tx === 1 ? "" : "s"}`);
  }
  return `${parts.join(" · ")}.`;
}

export function formatBankSyncMessage(
  created?: number,
  updated?: number,
  errorCount?: number,
): string {
  const parts: string[] = [];
  const tx = created ?? 0;
  const upd = updated ?? 0;
  const errors = errorCount ?? 0;
  if (tx > 0) {
    parts.push(`${tx} movimiento${tx === 1 ? "" : "s"} nuevo${tx === 1 ? "" : "s"}`);
  }
  if (upd > 0) {
    parts.push(`${upd} actualizado${upd === 1 ? "" : "s"}`);
  }
  if (errors > 0) {
    const rateLimitedHint = " (límite de GoCardless: espera unos minutos o sync una cuenta)";
    if (parts.length > 0) {
      return `${parts.join(" · ")}. ${errors} cuenta${errors === 1 ? "" : "s"} con error${rateLimitedHint}.`;
    }
    return `${errors} cuenta${errors === 1 ? "" : "s"} no se pudieron sincronizar${rateLimitedHint}.`;
  }
  if (parts.length > 0) {
    return `${parts.join(" · ")} del banco. Saldo refrescado.`;
  }
  return "Saldos y movimientos bancarios actualizados.";
}
