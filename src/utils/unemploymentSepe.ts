import type { RecurringEntry, WorkHistory } from "../types";
import { isPrestacionIncomeEntry } from "./budgetIncome";

export type SepeRenewalState = "ok" | "upcoming" | "overdue" | "needs_date";

export type SepeSettings = {
  sepe_status?: string;
  sepe_ultima_renovacion?: string;
  sepe_intervalo_dias?: string;
};

const DEFAULT_INTERVAL_DAYS = 90;
const UPCOMING_DAYS = 7;

function parseIsoDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T12:00:00`);
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(iso: string, days: number): Date {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + days);
  return d;
}

function diffCalendarDays(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function formatDateEs(d: Date): string {
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}

export function hasPrestacionIncome(
  recurringEntries: Array<
    Pick<RecurringEntry, "es_ingreso" | "categoria"> & Partial<Pick<RecurringEntry, "nombre" | "empresa">>
  >,
): boolean {
  // Detección por categoría, nombre o empresa (p. ej. «Nómina PRESTACION DESEMPLEO…»).
  return recurringEntries.some((e) => e.es_ingreso && isPrestacionIncomeEntry(e));
}

export function hasActiveJob(workHistory: Pick<WorkHistory, "fecha_fin">[]): boolean {
  return workHistory.some((w) => !w.fecha_fin);
}

export function lastJobEndDate(workHistory: Pick<WorkHistory, "fecha_fin">[]): string | null {
  const ended = workHistory
    .filter((w) => w.fecha_fin)
    .map((w) => w.fecha_fin!.slice(0, 10))
    .sort((a, b) => b.localeCompare(a));
  return ended[0] ?? null;
}

export function sepeIntervalDays(settings: SepeSettings): number {
  const n = parseInt(settings.sepe_intervalo_dias || String(DEFAULT_INTERVAL_DAYS), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_DAYS;
}

export function isUnemployed(
  settings: SepeSettings,
  workHistory: Pick<WorkHistory, "fecha_fin">[],
  recurringEntries: Pick<RecurringEntry, "es_ingreso" | "categoria">[],
): boolean {
  const status = (settings.sepe_status || "auto").trim().toLowerCase();
  if (status === "activo") return false;
  if (status === "paro") return true;
  if (hasActiveJob(workHistory)) return false;
  return hasPrestacionIncome(recurringEntries);
}

export function nextSepeRenewalDate(
  settings: SepeSettings,
  workHistory: Pick<WorkHistory, "fecha_fin">[],
): Date | null {
  const interval = sepeIntervalDays(settings);
  const lastRenewal = settings.sepe_ultima_renovacion?.slice(0, 10);
  const base = lastRenewal || lastJobEndDate(workHistory);
  if (!base) return null;
  return addDays(base, interval);
}

export function sepeRenewalAlertState(
  settings: SepeSettings,
  workHistory: Pick<WorkHistory, "fecha_fin">[],
  recurringEntries: Pick<RecurringEntry, "es_ingreso" | "categoria">[],
  refDate: Date = new Date(),
): SepeRenewalState {
  if (!isUnemployed(settings, workHistory, recurringEntries)) return "ok";

  const lastRenewal = settings.sepe_ultima_renovacion?.slice(0, 10);
  if (!lastRenewal) return "needs_date";

  const next = nextSepeRenewalDate(settings, workHistory);
  if (!next) return "needs_date";

  const daysUntil = diffCalendarDays(refDate, next);
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= UPCOMING_DAYS) return "upcoming";
  return "ok";
}

export function sepeAlertSeverity(state: SepeRenewalState): "alta" | "media" | "baja" | null {
  if (state === "overdue") return "alta";
  if (state === "upcoming" || state === "needs_date") return "media";
  return null;
}

export function formatSepeAlertMessage(
  state: SepeRenewalState,
  settings: SepeSettings,
  workHistory: Pick<WorkHistory, "fecha_fin">[],
  refDate: Date = new Date(),
): string {
  const next = nextSepeRenewalDate(settings, workHistory);
  if (state === "needs_date") {
    const hint = lastJobEndDate(workHistory);
    if (hint && next) {
      return (
        `Estás en paro: confirma la fecha de tu última renovación SEPE `
        + `(estimación ~${formatDateEs(next)} según fin de contrato). `
        + `Indícala en Ajustes o pulsa «Renovado hoy» en Historial laboral.`
      );
    }
    return (
      "Estás en paro: indica la fecha de tu última renovación SEPE en Ajustes "
      + "o pulsa «Renovado hoy» en Historial laboral."
    );
  }
  if (state === "overdue" && next) {
    return (
      `Renovación SEPE vencida: debías renovar/sellar la demanda antes del ${formatDateEs(next)}. `
      + "Hazlo cuanto antes."
    );
  }
  if (state === "upcoming" && next) {
    const days = diffCalendarDays(refDate, next);
    return (
      `Próxima renovación SEPE en ${days} día${days !== 1 ? "s" : ""} (${formatDateEs(next)}). `
      + "Renueva/sella la demanda a tiempo."
    );
  }
  return "";
}

export function todayIso(): string {
  return toIsoDate(new Date());
}
