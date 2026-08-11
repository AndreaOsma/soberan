import type { Debt, DebtInstallment } from "../../types";
import { activeUnpaidInstallments, isDebtArchived } from "./archive";
import { remainingDebtPaymentSchedule } from "./amortization";
import type { NextDebtPayment } from "./types";

/** Próxima cuota pendiente (planilla o fallback día de cargo). */
export function nextDebtPayment(
  debts: Debt[],
  installments: DebtInstallment[],
  ref: Date = new Date(),
): NextDebtPayment | null {
  let best: NextDebtPayment | null = null;
  const today = ref.toISOString().slice(0, 10);

  for (const debt of debts) {
    if (isDebtArchived(debt)) continue;
    const pending = debt.monto_total - debt.monto_pagado;
    if (pending <= 0) continue;
    const planilla = installments.filter((i) => i.debt_id === debt.id);
    if (planilla.length > 0) {
      const active = activeUnpaidInstallments(debt, planilla);
      if (active.length === 0) continue;
      const inst = active[0];
      const date = inst.fecha_vencimiento.slice(0, 10);
      if (!best || date < best.date) {
        best = {
          label: debt.nombre || debt.acreedor,
          amount: inst.cuota_total,
          date,
          debtId: debt.id,
          installmentId: inst.id,
        };
      }
      continue;
    }
    const projected = remainingDebtPaymentSchedule(debt, ref);
    if (projected.length === 0) continue;
    const next = projected[0];
    const date = next.fechaVencimiento.slice(0, 10);
    if (date < today) continue;
    if (!best || date < best.date) {
      best = {
        label: debt.nombre || debt.acreedor,
        amount: next.amount,
        date,
        debtId: debt.id,
        installmentId: 0,
      };
    }
  }
  return best;
}
