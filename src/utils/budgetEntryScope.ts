import type { RecurringEntry } from "../types";
import { destinoFromEntry, normalizeBudgetTipo } from "./budgetTipo";
import { subscriptionMonthlyAmount } from "./subscriptionBudget";

const LIBRE_GASTO_NAME = "Libre";

function isLibrePlannedGasto(entry: Pick<RecurringEntry, "nombre" | "es_puntual" | "es_fondo">): boolean {
  return entry.nombre.trim().toLowerCase() === LIBRE_GASTO_NAME.toLowerCase()
    && Boolean(entry.es_puntual)
    && !entry.es_fondo;
}

export function entryAssignedAmount(
  entry: RecurringEntry,
  mbMap: Record<number, number>,
  month: number,
  year: number,
): number {
  if (mbMap[entry.id] !== undefined) return mbMap[entry.id];
  if (entry.tipo_partida === "suscripcion") return subscriptionMonthlyAmount(entry, month, year);
  return entry.monto_estimado;
}

type EditFormLike = {
  nombre: string;
  categoria: string;
  monto_estimado: number;
  es_fijo: boolean;
  tipo_partida: string;
  bloque: string;
  goal_id: number | null;
  es_puntual: boolean;
  es_fondo: boolean;
  cuenta_destino_id: number | "";
  cartera_destino: string;
  objetivo_monto: number | "";
  objetivo_fecha: string;
  frecuencia: string;
  fecha_pago: number;
  mes_cobro: number;
};

export function hasStructuralEditChanges(entry: RecurringEntry, form: EditFormLike): boolean {
  const destino = destinoFromEntry(entry);
  const formDestino = form.cartera_destino?.trim() ? "cartera" : "cuenta";
  return (
    form.nombre !== entry.nombre
    || form.categoria !== (entry.categoria ?? "")
    || Math.abs(form.monto_estimado - entry.monto_estimado) >= 0.005
    || form.es_fijo !== entry.es_fijo
    || normalizeBudgetTipo(form.tipo_partida) !== normalizeBudgetTipo(entry.tipo_partida)
    || (form.goal_id ?? null) !== (entry.goal_id ?? null)
    || Boolean(form.es_puntual) !== Boolean(entry.es_puntual)
    || Boolean(form.es_fondo) !== Boolean(entry.es_fondo)
    || (form.bloque || null) !== (isLibrePlannedGasto(entry) ? "deseos" : entry.bloque || null)
    || (form.cuenta_destino_id || null) !== (entry.cuenta_destino_id ?? null)
    || (form.cartera_destino || null) !== (entry.cartera_destino ?? null)
    || destino !== formDestino
  );
}

export function hasNonAmountStructuralChanges(entry: RecurringEntry, form: EditFormLike): boolean {
  const base = { ...form, monto_estimado: entry.monto_estimado };
  return hasStructuralEditChanges(entry, base);
}
