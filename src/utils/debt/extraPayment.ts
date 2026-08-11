import type { Debt, DebtInstallment } from "../../types";
import { computeMonthlyPaymentFromTerm, generateAmortizationSchedule } from "./amortization";
import { activeUnpaidInstallments, installmentMatchesMonth } from "./archive";
import { chargeIsoDate, monthIndex, parseInstallmentDate } from "./chargeCalendar";
import { round2 } from "./round";
import type { AmortizationScheduleRow } from "./types";

export type ExtraPaymentMode = "term" | "cuota";

export type ExtraPaymentImpact = {
  applicable: boolean;
  reason: string | null;
  appliedExtra: number;
  mode: ExtraPaymentMode;
  wouldSettleDebt: boolean;
  baselinePayoffDate: string | null;
  newPayoffDate: string | null;
  monthsSaved: number;
  interestSaved: number;
  /** Nueva cuota mensual desde el mes objetivo en adelante (solo difiere de la cuota estándar en modo "cuota"). */
  newMonthlyCuota: number | null;
  /** Filas desde el mes objetivo (inclusive) en adelante, listas para persistir. Vacío si no aplica. */
  newInstallmentRows: AmortizationScheduleRow[];
  /**
   * Mes/año realmente afectado (puede diferir del mes pedido: si ese mes ya está
   * pagado/pasado, el extra se redirige a la próxima cuota pendiente).
   */
  appliedMonth: number | null;
  appliedYear: number | null;
};

export type ActiveExtraInfo = {
  active: boolean;
  extraAmount: number;
  mode: ExtraPaymentMode | null;
};

type DebtForSimulation = Pick<
  Debt,
  "monto_total" | "monto_pagado" | "cuota_mensual" | "tasa_anual" | "dia_cargo_mensual"
>;

const NOT_APPLICABLE = (reason: string, mode: ExtraPaymentMode): ExtraPaymentImpact => ({
  applicable: false,
  reason,
  appliedExtra: 0,
  mode,
  wouldSettleDebt: false,
  baselinePayoffDate: null,
  newPayoffDate: null,
  monthsSaved: 0,
  interestSaved: 0,
  newMonthlyCuota: null,
  newInstallmentRows: [],
  appliedMonth: null,
  appliedYear: null,
});

function totalInterest(schedule: readonly AmortizationScheduleRow[]): number {
  return round2(schedule.reduce((sum, row) => sum + row.interes, 0));
}

function nextChargeDate(row: AmortizationScheduleRow): string {
  const { year, month, day } = parseInstallmentDate(row.fecha_vencimiento);
  return chargeIsoDate(year, month, day);
}

/**
 * generateAmortizationSchedule salta al mes siguiente si referenceDate ya pasó el día de
 * cargo de este mes (correcto para generar una planilla nueva desde cero). Para simular un
 * extra sobre un mes concreto, eso puede hacer que el mes objetivo directamente no aparezca
 * en la simulación aunque la cuota real siga sin pagar. Se recorta referenceDate para que
 * nunca sea posterior al primer día del mes objetivo, así ese mes siempre queda incluido.
 */
function effectiveReferenceDate(referenceDate: Date, targetMonth: number, targetYear: number): Date {
  const targetFirst = new Date(targetYear, targetMonth - 1, 1);
  return referenceDate < targetFirst ? referenceDate : targetFirst;
}

function findRowIndexForMonth(
  schedule: readonly AmortizationScheduleRow[],
  targetMonth: number,
  targetYear: number,
): number {
  const targetIdx = monthIndex(targetYear, targetMonth);
  return schedule.findIndex((row) => {
    const { year, month } = parseInstallmentDate(row.fecha_vencimiento);
    return monthIndex(year, month) === targetIdx;
  });
}

export function simulateExtraPayment(
  debt: DebtForSimulation,
  extraAmount: number,
  targetMonth: number,
  targetYear: number,
  referenceDate: Date = new Date(),
  mode: ExtraPaymentMode = "term",
): ExtraPaymentImpact {
  let baseline: AmortizationScheduleRow[];
  try {
    baseline = generateAmortizationSchedule(debt, {
      referenceDate: effectiveReferenceDate(referenceDate, targetMonth, targetYear),
    });
  } catch (err) {
    return NOT_APPLICABLE(err instanceof Error ? err.message : "No se pudo calcular la planilla.", mode);
  }

  if (baseline.length === 0) {
    return NOT_APPLICABLE("Deuda ya saldada.", mode);
  }

  const idx = findRowIndexForMonth(baseline, targetMonth, targetYear);
  if (idx === -1) {
    return NOT_APPLICABLE("Mes fuera del calendario de pagos.", mode);
  }

  const baselinePayoffDate = baseline[baseline.length - 1]!.fecha_vencimiento;
  const standardCuota = baseline[idx]!.cuota_total;
  const { year: appliedYear, month: appliedMonth } = parseInstallmentDate(baseline[idx]!.fecha_vencimiento);

  if (!(extraAmount > 0)) {
    return {
      applicable: true,
      reason: null,
      appliedExtra: 0,
      mode,
      wouldSettleDebt: false,
      baselinePayoffDate,
      newPayoffDate: baselinePayoffDate,
      monthsSaved: 0,
      interestSaved: 0,
      newMonthlyCuota: standardCuota,
      newInstallmentRows: baseline.slice(idx),
      appliedMonth,
      appliedYear,
    };
  }

  const targetRow = baseline[idx]!;
  const appliedExtra = round2(Math.min(extraAmount, targetRow.saldo_pendiente));
  const remainingAfterBoost = round2(targetRow.saldo_pendiente - appliedExtra);
  const boostedRow: AmortizationScheduleRow = {
    ...targetRow,
    cuota_total: round2(targetRow.cuota_total + appliedExtra),
    capital: round2(targetRow.capital + appliedExtra),
    saldo_pendiente: remainingAfterBoost,
  };
  const wouldSettleDebt = remainingAfterBoost <= 0.01;

  let newSchedule: AmortizationScheduleRow[];
  let newMonthlyCuota: number | null;

  if (wouldSettleDebt) {
    newSchedule = [boostedRow];
    newMonthlyCuota = null;
  } else if (mode === "cuota") {
    const remainingMonthsCount = baseline.length - (idx + 1);
    let reducedCuota: number;
    try {
      reducedCuota = computeMonthlyPaymentFromTerm(remainingAfterBoost, Number(debt.tasa_anual) || 0, remainingMonthsCount);
    } catch (err) {
      return NOT_APPLICABLE(err instanceof Error ? err.message : "No se pudo recalcular la cuota reducida.", mode);
    }
    const tailDebt: DebtForSimulation = {
      ...debt,
      monto_pagado: round2(debt.monto_total - remainingAfterBoost),
      cuota_mensual: reducedCuota,
    };
    let tailRaw: AmortizationScheduleRow[];
    try {
      tailRaw = generateAmortizationSchedule(tailDebt, {
        startDate: nextChargeDate(boostedRow),
        paymentCount: remainingMonthsCount,
      });
    } catch (err) {
      return NOT_APPLICABLE(err instanceof Error ? err.message : "No se pudo recalcular el resto de la planilla.", mode);
    }
    const tail = tailRaw.map((row, i) => ({ ...row, numero_cuota: boostedRow.numero_cuota + 1 + i }));
    newSchedule = [boostedRow, ...tail];
    newMonthlyCuota = round2(reducedCuota);
  } else {
    const tailDebt: DebtForSimulation = {
      ...debt,
      monto_pagado: round2(debt.monto_total - remainingAfterBoost),
    };
    let tailRaw: AmortizationScheduleRow[];
    try {
      tailRaw = generateAmortizationSchedule(tailDebt, { startDate: nextChargeDate(boostedRow) });
    } catch (err) {
      return NOT_APPLICABLE(err instanceof Error ? err.message : "No se pudo recalcular el resto de la planilla.", mode);
    }
    const tail = tailRaw.map((row, i) => ({ ...row, numero_cuota: boostedRow.numero_cuota + 1 + i }));
    newSchedule = [boostedRow, ...tail];
    newMonthlyCuota = standardCuota;
  }

  const fullNewSchedule = [...baseline.slice(0, idx), ...newSchedule];

  return {
    applicable: true,
    reason: null,
    appliedExtra,
    mode: wouldSettleDebt ? "term" : mode,
    wouldSettleDebt,
    baselinePayoffDate,
    newPayoffDate: newSchedule[newSchedule.length - 1]!.fecha_vencimiento,
    monthsSaved: baseline.length - fullNewSchedule.length,
    interestSaved: round2(totalInterest(baseline) - totalInterest(fullNewSchedule)),
    newMonthlyCuota,
    newInstallmentRows: newSchedule,
    appliedMonth,
    appliedYear,
  };
}

/**
 * numero_cuota base para renumerar las filas de simulateExtraPayment antes de persistir.
 * La simulación siempre numera desde 1 (planilla teórica desde hoy); la deuda real puede
 * llevar cuotas ya pagadas con numero_cuota más alto, así que hay que anclar a la cuota
 * real existente en la fecha objetivo (o, si no hay ninguna, seguir tras la última real).
 */
export function pickBaseNumeroCuota(
  planilla: readonly { fecha_vencimiento: string; numero_cuota: number }[],
  targetDate: string,
): number {
  const existing = planilla.find((r) => r.fecha_vencimiento === targetDate);
  if (existing) return existing.numero_cuota;
  if (planilla.length === 0) return 1;
  return Math.max(...planilla.map((r) => r.numero_cuota)) + 1;
}

/**
 * Compara la planilla real contra una simulación fresca sin extra para detectar si ya
 * hay un pago extra planificado (no pagado) en el mes objetivo, y en qué modo.
 * No depende de metadatos guardados — se deriva comparando cuota real vs. estándar.
 */
export function detectActiveExtra(
  debt: DebtForSimulation,
  planilla: readonly { fecha_vencimiento: string; cuota_total: number }[],
  targetMonth: number,
  targetYear: number,
  referenceDate: Date = new Date(),
): ActiveExtraInfo {
  const NONE: ActiveExtraInfo = { active: false, extraAmount: 0, mode: null };
  let baseline: AmortizationScheduleRow[];
  try {
    baseline = generateAmortizationSchedule(debt, {
      referenceDate: effectiveReferenceDate(referenceDate, targetMonth, targetYear),
    });
  } catch {
    return NONE;
  }

  const targetIdx = monthIndex(targetYear, targetMonth);
  const baselineIdx = findRowIndexForMonth(baseline, targetMonth, targetYear);
  const realRow = planilla.find((row) => {
    const { year, month } = parseInstallmentDate(row.fecha_vencimiento);
    return monthIndex(year, month) === targetIdx;
  });
  if (!realRow) return NONE;

  const standardCuota = baselineIdx !== -1 ? baseline[baselineIdx]!.cuota_total : Number(debt.cuota_mensual) || 0;
  const diff = round2(realRow.cuota_total - standardCuota);
  if (diff <= 0.01) return NONE;

  const baselineLastDate = baseline.length > 0 ? baseline[baseline.length - 1]!.fecha_vencimiento : null;
  const realFutureRows = planilla.filter((row) => {
    const { year, month } = parseInstallmentDate(row.fecha_vencimiento);
    return monthIndex(year, month) >= targetIdx;
  });
  const realLastDate = realFutureRows.reduce<string | null>(
    (max, r) => (max === null || r.fecha_vencimiento > max ? r.fecha_vencimiento : max),
    null,
  );
  const mode: ExtraPaymentMode = baselineLastDate && realLastDate && realLastDate < baselineLastDate ? "term" : "cuota";

  return { active: true, extraAmount: diff, mode };
}

export type ExtraPaymentTarget = { month: number; year: number };

/**
 * Mes/año donde debe aplicarse un pago extra pedido desde la vista de un mes concreto.
 * Si ese mes ya tiene una cuota real liquidada (pago registrado que la cubre), no se le
 * puede tocar el importe retroactivamente — el extra se redirige a la próxima cuota
 * pendiente de la planilla real. Si el mes visto aún no tiene cuota real (planilla no
 * generada todavía) o su cuota sigue pendiente, se usa el mes visto tal cual.
 */
export function resolveExtraPaymentTarget(
  debt: Debt,
  planilla: DebtInstallment[],
  viewMonth: number,
  viewYear: number,
): ExtraPaymentTarget {
  const viewed = { month: viewMonth, year: viewYear };
  const viewedRow = planilla.find((i) => installmentMatchesMonth(i, viewMonth, viewYear));
  if (!viewedRow) return viewed;

  const unpaid = activeUnpaidInstallments(debt, planilla);
  if (unpaid.some((i) => i.id === viewedRow.id)) return viewed;

  const next = unpaid[0];
  if (!next) return viewed;
  const { month, year } = parseInstallmentDate(next.fecha_vencimiento);
  return { month, year };
}
