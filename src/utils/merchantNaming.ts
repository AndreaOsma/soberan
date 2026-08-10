/** Helpers to learn short merchant display names from bank descriptions. */

const DENY = new Set([
  "compra", "compras", "pago", "pagos", "cargo", "cargos", "bizum",
  "transfer", "transferencia", "traspaso", "recibo", "adeudo", "abono",
  "tarjeta", "visa", "mastercard", "importado", "gocardless",
]);

const PLACEHOLDERS = new Set([
  "",
  "—",
  "-",
  "importado gocardless",
  "importado",
  "movimiento bancario",
]);

export function learnableMerchantToken(description: string): string | null {
  const parts = description.trim().split(/[\s—\-|,;/·]+/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower.length >= 4 && !DENY.has(lower) && !/^\d+$/.test(lower)) return lower;
  }
  return null;
}

export function looksLikeBankRawDescription(description: string): boolean {
  const d = description.trim();
  if (PLACEHOLDERS.has(d.toLowerCase())) return true;
  if (d.includes(" — ") || d.includes(" · ")) return true;
  if (/\bMCC\s*\d+\b/i.test(d)) return true;
  if (d.includes("…") || /\bES\d{2}/i.test(d)) return true;
  if (d.length > 60) return true;
  return false;
}

export function looksLikeUserCleanName(description: string): boolean {
  const d = description.trim();
  if (!d || PLACEHOLDERS.has(d.toLowerCase())) return false;
  if (looksLikeBankRawDescription(d)) return false;
  if (d.length > 40) return false;
  return learnableMerchantToken(d) !== null;
}

/** Learn token→name when user renames an expense to a clean label. Failures are ignored. */
export async function maybeLearnMerchantName(opts: {
  amount: number;
  previousDescription: string;
  newDescription: string;
  learn: (pattern: string, name: string) => Promise<unknown>;
}): Promise<void> {
  if (opts.amount >= 0) return;
  const newName = opts.newDescription.trim();
  if (!looksLikeUserCleanName(newName)) return;
  const token = learnableMerchantToken(opts.previousDescription);
  if (!token) return;
  try {
    await opts.learn(token, newName);
  } catch {
    // optional learning
  }
}
