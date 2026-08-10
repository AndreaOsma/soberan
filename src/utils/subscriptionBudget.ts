import type { RecurringEntry } from "../types";

export type SubscriptionLike = Pick<
  RecurringEntry,
  "mes_inicio" | "anio_inicio" | "mes_fin" | "anio_fin" | "meses_excluidos" | "frecuencia" | "mes_cobro"
>;

export type SubscriptionAmountLike = Pick<
  RecurringEntry,
  "monto_estimado" | "historial_precios" | "mes_inicio" | "anio_inicio" | "frecuencia"
>;

export type RecurringScopeLike = Pick<
  RecurringEntry,
  "mes_inicio" | "anio_inicio" | "mes_fin" | "anio_fin" | "es_puntual"
>;

export type PriceTier = {
  desde_mes: number;
  desde_anio: number;
  monto: number;
};

/** Frecuencia normalizada (legacy EN/ES). */
export function normalizeSubscriptionFrequency(frecuencia: string | null | undefined): "mensual" | "anual" {
  const f = (frecuencia || "mensual").trim().toLowerCase();
  if (f === "anual" || f === "annual" || f === "a" || f === "yearly" || f === "year") return "anual";
  return "mensual";
}

export function isAnnualSubscription(frecuencia: string | null | undefined): boolean {
  return normalizeSubscriptionFrequency(frecuencia) === "anual";
}

function monthIndex(year: number, month: number): number {
  return year * 12 + month;
}

/** Last calendar month (inclusive) before the given month — used when cancelling from a month. */
export function lastActiveMonthBefore(month: number, year: number): { mes_fin: number; anio_fin: number } {
  if (month <= 1) return { mes_fin: 12, anio_fin: year - 1 };
  return { mes_fin: month - 1, anio_fin: year };
}

/** True if the entry could already have applied to months before (month, year). */
export function entryAppliesBeforeMonth(
  entry: Pick<RecurringEntry, "mes_inicio" | "anio_inicio" | "es_puntual">,
  month: number,
  year: number,
): boolean {
  if (entry.es_puntual) return false;
  const { mes_inicio, anio_inicio } = entry;
  if (!mes_inicio || !anio_inicio) return true;
  return monthIndex(anio_inicio, mes_inicio) < monthIndex(year, month);
}

export function parsePriceHistory(entry: Pick<RecurringEntry, "historial_precios">): PriceTier[] {
  if (!entry.historial_precios) return [];
  try {
    const parsed = JSON.parse(entry.historial_precios) as PriceTier[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && Number.isFinite(t.desde_mes) && Number.isFinite(t.desde_anio) && Number.isFinite(t.monto))
      .sort((a, b) => monthIndex(a.desde_anio, a.desde_mes) - monthIndex(b.desde_anio, b.desde_mes));
  } catch {
    return [];
  }
}

/** Importe de suscripción vigente en un mes (mensual o anual según frecuencia). */
export function subscriptionAmountForMonth(entry: SubscriptionAmountLike, month: number, year: number): number {
  const tiers = parsePriceHistory(entry);
  if (tiers.length === 0) return entry.monto_estimado;
  const cur = monthIndex(year, month);
  let applicable = entry.monto_estimado;
  for (const tier of tiers) {
    if (monthIndex(tier.desde_anio, tier.desde_mes) <= cur) {
      applicable = tier.monto;
    } else {
      break;
    }
  }
  return applicable;
}

/** Importe prorrateado mensual para presupuesto (anual ÷ 12). */
export function subscriptionMonthlyAmount(entry: SubscriptionAmountLike, month: number, year: number): number {
  const amount = subscriptionAmountForMonth(entry, month, year);
  return isAnnualSubscription(entry.frecuencia) ? amount / 12 : amount;
}

/**
 * Registra cambio de precio desde el mes visible: meses anteriores conservan el importe previo.
 * Devuelve JSON serializado o null si no hay historial.
 */
export function applySubscriptionPriceChange(
  entry: Pick<RecurringEntry, "monto_estimado" | "historial_precios" | "mes_inicio" | "anio_inicio">,
  newAmount: number,
  fromMonth: number,
  fromYear: number,
): string | null {
  const oldAmount = entry.monto_estimado;
  if (Math.abs(newAmount - oldAmount) < 0.005) {
    return entry.historial_precios ?? null;
  }

  let tiers = parsePriceHistory(entry);
  if (tiers.length === 0) {
    tiers = [{
      desde_mes: entry.mes_inicio ?? fromMonth,
      desde_anio: entry.anio_inicio ?? fromYear,
      monto: oldAmount,
    }];
  }

  const fromIdx = monthIndex(fromYear, fromMonth);
  tiers = tiers.filter((t) => monthIndex(t.desde_anio, t.desde_mes) !== fromIdx);
  tiers.push({ desde_mes: fromMonth, desde_anio: fromYear, monto: newAmount });
  tiers.sort((a, b) => monthIndex(a.desde_anio, a.desde_mes) - monthIndex(b.desde_anio, b.desde_mes));
  return JSON.stringify(tiers);
}

export function recurringEntryEnded(
  entry: Pick<RecurringEntry, "mes_fin" | "anio_fin">,
  month: number,
  year: number,
): boolean {
  const { mes_fin, anio_fin } = entry;
  if (!mes_fin || !anio_fin) return false;
  return monthIndex(year, month) > monthIndex(anio_fin, mes_fin);
}

export function recurringEntryAppliesToMonth(entry: RecurringScopeLike, month: number, year: number): boolean {
  if (recurringEntryEnded(entry, month, year)) return false;
  const { mes_inicio, anio_inicio, es_puntual } = entry;
  if (!mes_inicio || !anio_inicio) return true;
  const start = monthIndex(anio_inicio, mes_inicio);
  const cur = monthIndex(year, month);
  return es_puntual ? start === cur : cur >= start;
}

export function subscriptionStarted(entry: SubscriptionLike, month: number, year: number): boolean {
  const { mes_inicio, anio_inicio } = entry;
  if (!mes_inicio || !anio_inicio) return true;
  return monthIndex(year, month) >= monthIndex(anio_inicio, mes_inicio);
}

export function subscriptionMonthExcluded(entry: SubscriptionLike, month: number): boolean {
  if (!entry.meses_excluidos) return false;
  try {
    return (JSON.parse(entry.meses_excluidos) as number[]).includes(month);
  } catch {
    return false;
  }
}

/** Suscripción activa en el mes de presupuesto (inicio, fin, pausas; anual sigue prorrateándose). */
export function subscriptionAppliesToMonth(entry: SubscriptionLike, month: number, year: number): boolean {
  if (!subscriptionStarted(entry, month, year)) return false;
  if (recurringEntryEnded(entry, month, year)) return false;
  if (subscriptionMonthExcluded(entry, month)) return false;
  return true;
}
