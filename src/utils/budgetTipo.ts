import type { RecurringEntry } from "../types";

export type BudgetTipoPartida = "gasto" | "ahorro_inversion" | "suscripcion";
export type BudgetDestino = "cuenta" | "cartera";

type RecurringBudgetRow = Pick<
  RecurringEntry,
  "es_ingreso" | "tipo_partida" | "bloque" | "monto_estimado" | "cartera_destino"
>;

/** Legacy DB values ahorro/inversion are still accepted when reading. */
export function isAhorroInversionTipo(tipo: string | null | undefined): boolean {
  return tipo === "ahorro_inversion" || tipo === "ahorro" || tipo === "inversion";
}

/** Partidas que mueven dinero a ahorro/inversión — no son consumo para la tasa de ahorro. */
export function isSavingsAllocation(entry: RecurringBudgetRow): boolean {
  if (entry.es_ingreso) return false;
  if (isAhorroInversionTipo(entry.tipo_partida) || entry.bloque === "ahorro_inversion") return true;
  if (entry.cartera_destino?.trim()) return true;
  return false;
}

/** Ahorro mensual: partidas planificadas + slack; si el surplus es negativo pero hay ahorro/inversión, usa lo planificado. */
export function monthlySavingsAmount(
  monthlyIncome: number,
  monthlyConsumption: number,
  monthlyDebtPayments: number,
  monthlyAhorroInversion: number,
): number {
  const surplus = monthlyIncome - monthlyConsumption - monthlyDebtPayments;
  if (monthlyAhorroInversion > 0) {
    return round2(Math.max(surplus, monthlyAhorroInversion));
  }
  return round2(surplus);
}

export function monthlyRecurringTotals(recurringEntries: RecurringBudgetRow[]) {
  let monthlyIncome = 0;
  let monthlyConsumption = 0;
  let monthlyAhorroInversion = 0;

  for (const entry of recurringEntries) {
    const amount = Number(entry.monto_estimado || 0);
    if (entry.es_ingreso) {
      monthlyIncome += amount;
      continue;
    }
    if (isSavingsAllocation(entry)) {
      monthlyAhorroInversion += amount;
    } else {
      monthlyConsumption += amount;
    }
  }

  return {
    monthlyIncome: round2(monthlyIncome),
    monthlyConsumption: round2(monthlyConsumption),
    monthlyAhorroInversion: round2(monthlyAhorroInversion),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function normalizeBudgetTipo(tipo: string | null | undefined): BudgetTipoPartida {
  if (isAhorroInversionTipo(tipo)) return "ahorro_inversion";
  if (tipo === "suscripcion") return "suscripcion";
  return "gasto";
}

export function destinoFromEntry(entry: Pick<RecurringEntry, "cartera_destino" | "cuenta_destino_id" | "tipo_partida">): BudgetDestino {
  if (entry.tipo_partida === "inversion" || (entry.cartera_destino?.trim() && !entry.cuenta_destino_id)) {
    return "cartera";
  }
  return "cuenta";
}
