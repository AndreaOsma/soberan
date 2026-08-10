import type { Debt } from "../../types";

export function parseInstallmentDate(iso: string): { month: number; year: number; day: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { year: y, month: m, day: d };
}

export function monthIndex(year: number, month: number): number {
  return year * 12 + month;
}

export function subtractCalendarMonths(year: number, jsMonth: number, count: number): { y: number; m: number } {
  let m = jsMonth;
  let y = year;
  for (let i = 0; i < count; i += 1) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  return { y, m };
}

export function clampDebtChargeDay(day: number): number {
  if (!day || day < 1) return 1;
  return Math.min(31, Math.round(day));
}

export function daysInMonth(y: number, jsMonth: number): number {
  return new Date(y, jsMonth + 1, 0).getDate();
}

/** Día efectivo de cargo en un mes (p. ej. 31 → 30 en abril, 28/29 en febrero). */
export function chargeDayInMonth(y: number, jsMonth: number, intendedDay: number): number {
  return Math.min(clampDebtChargeDay(intendedDay), daysInMonth(y, jsMonth));
}

export function isoDate(y: number, jsMonth: number, day: number): string {
  return `${y}-${String(jsMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function chargeIsoDate(y: number, jsMonth: number, intendedDay: number): string {
  return isoDate(y, jsMonth, chargeDayInMonth(y, jsMonth, intendedDay));
}

/** Ajusta el día de la primera cuota al día de cargo elegido (sin recalcular todo el mes). */
export function applyChargeDayToFirstInstallment(
  fechaInicio: string,
  intendedDay: number,
): string {
  const intended = clampDebtChargeDay(intendedDay);
  const [ys, ms] = fechaInicio.slice(0, 10).split("-");
  const y = Number(ys);
  const m = Number(ms) - 1;
  if (!ys || !Number.isFinite(y) || !Number.isFinite(m)) {
    return defaultScheduleStartDate({ dia_cargo_mensual: intended });
  }
  return chargeIsoDate(y, m, intended);
}

export function parseChargeDayInput(raw: string): number {
  const n = parseInt(raw.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export function defaultScheduleStartDate(
  debt: Pick<Debt, "dia_cargo_mensual">,
  ref: Date = new Date(),
): string {
  const intendedDay = clampDebtChargeDay(Number(debt.dia_cargo_mensual) || ref.getDate());
  let y = ref.getFullYear();
  let m = ref.getMonth();
  const effectiveThisMonth = chargeDayInMonth(y, m, intendedDay);
  if (ref.getDate() > effectiveThisMonth) {
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return chargeIsoDate(y, m, intendedDay);
}
