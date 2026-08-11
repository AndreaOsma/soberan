import type { Debt, DebtInstallmentCreate } from "../../types";
import {
  chargeDayInMonth,
  chargeIsoDate,
  clampDebtChargeDay,
  defaultScheduleStartDate,
  monthIndex,
  parseInstallmentDate,
  subtractCalendarMonths,
} from "./chargeCalendar";
import { round2 } from "./round";
import type {
  AmortizationScheduleRow,
  GenerateScheduleOptions,
  ProjectedDebtPayment,
  SimpleInstallmentRow,
} from "./types";

function buildPaymentAmounts(pending: number, cuota: number): number[] {
  const amounts: number[] = [];
  let rem = pending;
  while (rem > 0.01 && amounts.length < 600) {
    if (rem <= cuota + 0.01) {
      amounts.push(round2(rem));
      break;
    }
    amounts.push(cuota);
    rem = round2(rem - cuota);
  }
  return normalizeTrailingPartialAmount(amounts, cuota);
}

/** Fusiona la última cuota parcial con la anterior (ej. 99+99+15 → 99+114). */
function normalizeTrailingPartialAmount(amounts: number[], cuota: number): number[] {
  const result = [...amounts];
  while (result.length >= 2 && result[result.length - 1]! < cuota - 0.01) {
    const tail = result.pop()!;
    result[result.length - 1] = round2(result[result.length - 1]! + tail);
  }
  return result;
}

/** Cuotas proyectadas hasta liquidar saldo (sin planilla). Respeta fecha de vencimiento. */
export function remainingDebtPaymentSchedule(
  debt: Pick<
    Debt,
    "monto_total" | "monto_pagado" | "cuota_mensual" | "dia_cargo_mensual" | "fecha_vencimiento"
  >,
  ref: Date = new Date(),
): ProjectedDebtPayment[] {
  const pending = round2(Math.max(0, debt.monto_total - debt.monto_pagado));
  const cuota = Number(debt.cuota_mensual) || 0;
  if (pending <= 0.01 || cuota <= 0) return [];

  const amounts = buildPaymentAmounts(pending, cuota);
  const maturity = debt.fecha_vencimiento?.slice(0, 10) ?? null;
  const maturityIdx = maturity
    ? monthIndex(parseInstallmentDate(maturity).year, parseInstallmentDate(maturity).month)
    : null;
  const intendedDay = clampDebtChargeDay(
    Number(debt.dia_cargo_mensual) || (maturity ? parseInstallmentDate(maturity).day : 1),
  );

  let y: number;
  let m: number;
  if (maturity) {
    const mat = parseInstallmentDate(maturity);
    const start = subtractCalendarMonths(mat.year, mat.month - 1, amounts.length - 1);
    y = start.y;
    m = start.m;
  } else {
    const startIso = defaultScheduleStartDate(debt, ref);
    const start = parseInstallmentDate(startIso);
    y = start.year;
    m = start.month - 1;
  }

  const out: ProjectedDebtPayment[] = [];
  for (const amount of amounts) {
    const fecha = chargeIsoDate(y, m, intendedDay);
    const { year, month } = parseInstallmentDate(fecha);
    if (maturityIdx != null && monthIndex(year, month) > maturityIdx) break;
    out.push({ month, year, amount, fechaVencimiento: fecha });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }

  return out;
}

/** Última fecha de la planilla (vencimiento final de la deuda). */
export function scheduleMaturityDate(
  rows: readonly { fecha_vencimiento: string }[],
): string | null {
  if (rows.length === 0) return null;
  return rows[rows.length - 1]!.fecha_vencimiento.slice(0, 10);
}

export function scheduleToInstallmentPayload(
  schedule: AmortizationScheduleRow[],
): DebtInstallmentCreate[] {
  return schedule.map((s) => ({
    numero_cuota: s.numero_cuota,
    fecha_vencimiento: s.fecha_vencimiento,
    capital: s.capital,
    interes: s.interes,
    cuota_total: s.cuota_total,
    saldo_pendiente: s.saldo_pendiente,
    pagada: s.pagada,
    notas: null,
  }));
}

/** Deriva capital, interés y saldo desde cuota + deuda. pagada queda en false (la fija el backend según pagos). */
export function enrichInstallmentRows(
  debt: Pick<Debt, "monto_total" | "monto_pagado" | "tasa_anual">,
  rows: SimpleInstallmentRow[],
): DebtInstallmentCreate[] {
  const sorted = [...rows].sort(
    (a, b) =>
      a.fecha_vencimiento.localeCompare(b.fecha_vencimiento) || a.numero_cuota - b.numero_cuota,
  );
  let remaining = round2(Math.max(0, debt.monto_total - debt.monto_pagado));
  const monthlyRate = (Number(debt.tasa_anual) || 0) / 100 / 12;

  return sorted.map((row) => {
    const cuota = round2(row.cuota_total);
    const interest = round2(monthlyRate > 0 ? remaining * monthlyRate : 0);
    const capital = round2(Math.min(Math.max(0, cuota - interest), remaining));
    remaining = round2(Math.max(0, remaining - capital));

    return {
      numero_cuota: row.numero_cuota,
      fecha_vencimiento: row.fecha_vencimiento.slice(0, 10),
      capital,
      interes: interest,
      cuota_total: cuota,
      saldo_pendiente: remaining,
      pagada: false,
      notas: null,
    };
  });
}

/** Cuota constante para amortizar principal en N meses (TAE anual). */
export function computeMonthlyPaymentFromTerm(
  principal: number,
  annualRate: number,
  paymentCount: number,
): number {
  if (paymentCount <= 0) {
    throw new Error("El número de pagos debe ser mayor que 0.");
  }
  const balance = round2(Math.max(0, principal));
  if (balance <= 0.01) return 0;
  const r = (Number(annualRate) || 0) / 100 / 12;
  if (r <= 0) return round2(balance / paymentCount);
  const factor = Math.pow(1 + r, paymentCount);
  return round2((balance * r * factor) / (factor - 1));
}

/** Genera cuotas mes a mes desde el saldo pendiente, cuota mínima y TAE. */
export function generateAmortizationSchedule(
  debt: Pick<
    Debt,
    "monto_total" | "monto_pagado" | "cuota_mensual" | "tasa_anual" | "dia_cargo_mensual"
  >,
  opts?: GenerateScheduleOptions,
): AmortizationScheduleRow[] {
  const balance = round2(Math.max(0, debt.monto_total - debt.monto_pagado));
  const minPayment = Number(debt.cuota_mensual) || 0;
  const monthlyRate = (Number(debt.tasa_anual) || 0) / 100 / 12;
  const payDay = clampDebtChargeDay(Number(debt.dia_cargo_mensual) || 1);
  const maxMonths = opts?.maxMonths ?? 600;
  const paymentLimit = opts?.paymentCount != null && opts.paymentCount > 0
    ? opts.paymentCount
    : maxMonths;

  if (balance <= 0.01) return [];
  if (minPayment <= 0) {
    throw new Error("Indica la cuota mensual o el número de pagos antes de autocalcular.");
  }

  let y: number;
  let m: number;
  const intendedChargeDay = payDay;

  if (opts?.startDate) {
    const [sy, sm] = opts.startDate.slice(0, 10).split("-").map(Number);
    y = sy;
    m = sm - 1;
  } else {
    const ref = opts?.referenceDate ?? new Date();
    y = ref.getFullYear();
    m = ref.getMonth();
    const effectiveThisMonth = chargeDayInMonth(y, m, intendedChargeDay);
    if (ref.getDate() > effectiveThisMonth) {
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
  }

  const rows: AmortizationScheduleRow[] = [];
  let remaining = balance;
  let n = 1;

  while (remaining > 0.01 && n <= paymentLimit) {
    const interest = round2(monthlyRate > 0 ? remaining * monthlyRate : 0);
    const totalDue = round2(remaining + interest);
    const isLastForced = opts?.paymentCount != null && n === opts.paymentCount;
    const cuota = isLastForced
      ? totalDue
      : round2(Math.min(totalDue, minPayment || totalDue));

    if (!isLastForced && monthlyRate > 0 && minPayment <= interest + 0.01) {
      throw new Error("La cuota mensual no cubre los intereses; la deuda no amortiza con estos datos.");
    }

    const capital = round2(Math.min(Math.max(0, cuota - interest), remaining));
    remaining = round2(Math.max(0, remaining - capital));
    const fecha = chargeIsoDate(y, m, intendedChargeDay);

    rows.push({
      numero_cuota: n,
      fecha_vencimiento: fecha,
      capital,
      interes: interest,
      cuota_total: cuota,
      saldo_pendiente: remaining,
      pagada: false,
    });

    n += 1;
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }

  if (remaining > 0.01) {
    if (opts?.paymentCount != null) {
      throw new Error(
        `Con ${opts.paymentCount} cuotas de ${minPayment}€ no se amortiza el saldo. Revisa cuota, plazo o TAE.`,
      );
    }
    throw new Error(
      `No se pudo amortizar el saldo en ${paymentLimit} cuotas. Revisa la cuota mínima o la TAE.`,
    );
  }

  return rows;
}
