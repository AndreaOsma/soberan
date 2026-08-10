import type { Debt, DebtInstallment } from "../../types";
import { installmentMatchesMonth, installmentPendingForDebt, isStaleMaturity } from "./archive";
import { remainingDebtPaymentSchedule } from "./amortization";
import { chargeIsoDate, clampDebtChargeDay, monthIndex, parseInstallmentDate } from "./chargeCalendar";
import { round2 } from "./round";
import type { BudgetDebtRow } from "./types";

function resolveDebtBudgetForMonth(
  debt: Debt,
  planilla: DebtInstallment[],
  month: number,
  year: number,
  ref: Date = new Date(),
): BudgetDebtRow[] {
  const pending = round2(Math.max(0, debt.monto_total - debt.monto_pagado));
  const fullyPaid = pending <= 0.01;

  const nombre = debt.nombre || debt.acreedor;
  const base = { debtId: debt.id, nombre, acreedor: debt.acreedor };

  if (planilla.length > 0) {
    const viewIdx = monthIndex(year, month);
    const firstIdx = Math.min(
      ...planilla.map((i) => {
        const { year: y, month: m } = parseInstallmentDate(i.fecha_vencimiento);
        return monthIndex(y, m);
      }),
    );
    if (viewIdx < firstIdx) return [];

    const hasInstallmentThisMonth = planilla.some((i) => installmentMatchesMonth(i, month, year));
    if (hasInstallmentThisMonth) {
      // Deuda liquidada/archivada: sigue mostrando cuotas de meses históricos
      // (assigned = cuota completa, paidInMonth). No proyectar meses futuros.
      return planilla
        .filter((i) => installmentMatchesMonth(i, month, year))
        .map((inst) => {
          const paidInMonth = fullyPaid || !installmentPendingForDebt(inst, debt, planilla);
          const assigned = paidInMonth
            ? round2(inst.cuota_total)
            : round2(Math.min(inst.cuota_total, pending));
          return {
            ...base,
            id: -(debt.id * 100_000 + inst.numero_cuota),
            installmentId: inst.id,
            numeroCuota: inst.numero_cuota,
            assigned,
            fechaVencimiento: inst.fecha_vencimiento,
            paidInMonth,
          };
        });
    }
    return [];
  }

  // Sin planilla no hay fechas históricas: deuda liquidada no aparece en ningún mes.
  if (fullyPaid) return [];

  const staleMaturity = isStaleMaturity(debt, ref);
  const schedule = remainingDebtPaymentSchedule(debt, ref);
  const viewIdx = monthIndex(year, month);

  if (!staleMaturity) {
    const projected = schedule.filter((p) => p.month === month && p.year === year);
    if (projected.length > 0) {
      return projected.map((pay) => ({
        ...base,
        id: -(debt.id + 100_000),
        installmentId: 0,
        numeroCuota: 0,
        assigned: pay.amount,
        fechaVencimiento: pay.fechaVencimiento,
      }));
    }

    if (schedule.length > 0) {
      const last = schedule[schedule.length - 1]!;
      if (viewIdx > monthIndex(last.year, last.month)) return [];
    }
  }

  const cuota = Number(debt.cuota_mensual) || 0;
  if (cuota <= 0) return [];

  const intendedDay = clampDebtChargeDay(Number(debt.dia_cargo_mensual) || 1);
  return [
    {
      ...base,
      id: -(debt.id + 100_000),
      installmentId: 0,
      numeroCuota: 0,
      assigned: round2(Math.min(cuota, pending)),
      fechaVencimiento: chargeIsoDate(year, month - 1, intendedDay),
    },
  ];
}

export function budgetDebtRows(
  debts: Debt[],
  installments: DebtInstallment[],
  month: number,
  year: number,
  ref: Date = new Date(),
): BudgetDebtRow[] {
  const rows: BudgetDebtRow[] = [];
  for (const debt of debts) {
    const planilla = installments.filter((i) => i.debt_id === debt.id);
    rows.push(...resolveDebtBudgetForMonth(debt, planilla, month, year, ref));
  }
  return rows;
}

export function monthlyDebtTotalFromPlanilla(
  debts: Debt[],
  installments: DebtInstallment[],
  month: number,
  year: number,
): number {
  return budgetDebtRows(debts, installments, month, year).reduce((s, r) => s + r.assigned, 0);
}

export function recurringExpenseNames(recurringEntries: { nombre: string; es_ingreso: boolean }[]): Set<string> {
  return new Set(recurringEntries.filter((e) => !e.es_ingreso).map((e) => e.nombre));
}

function isDebtRowInFixedExpenses(row: BudgetDebtRow, recurringNames: Set<string>): boolean {
  const cuotaAcreedor = `Cuota ${row.acreedor}`;
  const cuotaNombre = row.nombre !== row.acreedor ? `Cuota ${row.nombre}` : null;
  if (recurringNames.has(cuotaAcreedor)) return true;
  if (cuotaNombre && recurringNames.has(cuotaNombre)) return true;
  return false;
}

export function dedupedBudgetDebtRows(
  debts: Debt[],
  installments: DebtInstallment[],
  month: number,
  year: number,
  recurringNames: Set<string>,
  ref: Date = new Date(),
): BudgetDebtRow[] {
  return budgetDebtRows(debts, installments, month, year, ref).map((row) => ({
    ...row,
    excludedFromTotal: isDebtRowInFixedExpenses(row, recurringNames),
  }));
}

/** Cuotas de deuda que cuentan en totales (excluye solo las ya en gastos fijos recurrentes). */
export function budgetDebtRowsForTotal(rows: BudgetDebtRow[]): BudgetDebtRow[] {
  return rows.filter((r) => !r.excludedFromTotal);
}

/** Cuota mensual total de deudas (planilla-aware, opcional dedup vs recurrentes). */
export function monthlyDebtObligation(
  debts: Debt[],
  installments: DebtInstallment[],
  month: number,
  year: number,
  recurringNames?: Set<string>,
): number {
  const rows = recurringNames
    ? dedupedBudgetDebtRows(debts, installments, month, year, recurringNames)
    : budgetDebtRows(debts, installments, month, year);
  return budgetDebtRowsForTotal(rows).reduce((s, r) => s + r.assigned, 0);
}
