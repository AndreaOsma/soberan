export function parseNum(v: string) {
  return parseFloat(v.replace(",", ".")) || 0;
}

export function formatEUR(value: number) {
  return `${value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00a0€`;
}

export function parseJsonValue<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Normalize API/ISO datetimes to `YYYY-MM-DD` for `<input type="date">` (Safari-safe). */
export function toDateOnly(iso?: string | null): string {
  if (!iso) return "";
  const match = String(iso).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

/** ISO date (YYYY-MM-DD) in calendar month — avoids UTC shift from `new Date("YYYY-MM-DD")`. */
export function transactionInCalendarMonth(txDate: string, month: number, year: number): boolean {
  const ym = txDate.slice(0, 7);
  return ym === `${year}-${String(month).padStart(2, "0")}`;
}
