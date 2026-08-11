import type { Debt, DebtInstallment } from "../../types";
import { monthIndex, parseInstallmentDate } from "./chargeCalendar";
import { round2 } from "./round";
import type { SimpleInstallmentRow } from "./types";

/** Deuda sin saldo pendiente (o marcada archivada en backend). */
export function isDebtArchived(debt: Pick<Debt, "monto_total" | "monto_pagado" | "archivada">): boolean {
  if (debt.archivada) return true;
  return round2(Math.max(0, debt.monto_total - debt.monto_pagado)) <= 0.01;
}

export function installmentPaidPool(debt: Pick<Debt, "monto_pagado_registrado">): number {
  return round2(Math.max(0, debt.monto_pagado_registrado ?? 0));
}

export function cuotaCoveredByPool(cuota: number, pool: number): boolean {
  return cuota > 0.01 && pool + 0.01 >= cuota;
}

export function isInstallmentPaidByPool(
  inst: DebtInstallment,
  paidPool: number,
  planilla: DebtInstallment[],
): boolean {
  const sorted = [...planilla].sort(
    (a, b) =>
      a.fecha_vencimiento.localeCompare(b.fecha_vencimiento) || a.numero_cuota - b.numero_cuota,
  );
  let pool = paidPool;
  for (const row of sorted) {
    const cuota = round2(row.cuota_total);
    if (row.id === inst.id) {
      return cuotaCoveredByPool(cuota, pool);
    }
    if (cuotaCoveredByPool(cuota, pool)) {
      pool = round2(Math.max(0, pool - cuota));
    } else {
      return false;
    }
  }
  return false;
}

export function installmentPendingForDebt(
  inst: DebtInstallment,
  debt: Pick<Debt, "monto_pagado_registrado">,
  planilla: DebtInstallment[],
): boolean {
  return !isInstallmentPaidByPool(inst, installmentPaidPool(debt), planilla);
}

/** Vencimiento pasado (antes de hoy) pero saldo pendiente — la proyección no es fiable. */
export function isStaleMaturity(debt: Debt, ref: Date = new Date()): boolean {
  const fv = debt.fecha_vencimiento?.slice(0, 10);
  if (!fv) return false;
  const pending = round2(Math.max(0, debt.monto_total - debt.monto_pagado));
  if (pending <= 0.01 || debt.archivada) return false;
  const { year: y, month: m } = parseInstallmentDate(fv);
  const maturityIdx = monthIndex(y, m);
  const todayIdx = monthIndex(ref.getFullYear(), ref.getMonth() + 1);
  return maturityIdx < todayIdx;
}

export function activeUnpaidInstallments(debt: Debt, planilla: DebtInstallment[]): DebtInstallment[] {
  let remaining = round2(Math.max(0, debt.monto_total - debt.monto_pagado));
  if (remaining <= 0.01) return [];

  const maturity = debt.fecha_vencimiento?.slice(0, 10) ?? null;
  const maturityIdx = maturity
    ? monthIndex(parseInstallmentDate(maturity).year, parseInstallmentDate(maturity).month)
    : null;

  const unpaid = planilla
    .filter((i) => installmentPendingForDebt(i, debt, planilla))
    .filter((i) => {
      if (maturityIdx == null) return true;
      const { year, month } = parseInstallmentDate(i.fecha_vencimiento);
      return monthIndex(year, month) <= maturityIdx;
    })
    .sort(
      (a, b) =>
        a.fecha_vencimiento.localeCompare(b.fecha_vencimiento) || a.numero_cuota - b.numero_cuota,
    );

  const active: DebtInstallment[] = [];
  for (const inst of unpaid) {
    if (remaining <= 0.01) break;
    active.push(inst);
    remaining = round2(Math.max(0, remaining - inst.cuota_total));
  }
  return active;
}

export function installmentMatchesMonth(inst: DebtInstallment, month: number, year: number): boolean {
  const { month: m, year: y } = parseInstallmentDate(inst.fecha_vencimiento);
  return m === month && y === year;
}

export function debtHasPlanilla(installments: DebtInstallment[], debtId: number): boolean {
  return installments.some((i) => i.debt_id === debtId);
}

/** Estado de una fila simple según pagos reales de la deuda. */
export function simpleRowStatus(
  debt: Pick<Debt, "monto_pagado_registrado">,
  sortedRows: SimpleInstallmentRow[],
  row: SimpleInstallmentRow,
): "pagada" | "vencida" | "pendiente" {
  let paidPool = installmentPaidPool(debt);
  for (const r of sortedRows) {
    const cuota = round2(r.cuota_total);
    const isTarget =
      r.numero_cuota === row.numero_cuota && r.fecha_vencimiento === row.fecha_vencimiento;
    const pagada = cuotaCoveredByPool(cuota, paidPool);
    if (isTarget) {
      if (pagada) return "pagada";
      const today = new Date().toISOString().slice(0, 10);
      return r.fecha_vencimiento.slice(0, 10) < today ? "vencida" : "pendiente";
    }
    if (pagada) paidPool = round2(Math.max(0, paidPool - cuota));
  }
  return "pendiente";
}

export function installmentStatus(
  inst: DebtInstallment,
  debt?: Pick<Debt, "monto_pagado_registrado">,
  planilla?: DebtInstallment[],
): "pagada" | "vencida" | "pendiente" {
  const pending = debt && planilla
    ? installmentPendingForDebt(inst, debt, planilla)
    : !inst.pagada;
  if (!pending) return "pagada";
  const today = new Date().toISOString().slice(0, 10);
  return inst.fecha_vencimiento.slice(0, 10) < today ? "vencida" : "pendiente";
}
