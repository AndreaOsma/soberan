import { describe, expect, it } from "vitest";
import type { Debt, DebtInstallment } from "../../types";
import { generateAmortizationSchedule } from "./amortization";
import {
  detectActiveExtra,
  pickBaseNumeroCuota,
  resolveExtraPaymentTarget,
  simulateExtraPayment,
} from "./extraPayment";

const ref = new Date(2026, 0, 1); // 2026-01-01

describe("simulateExtraPayment", () => {
  it("acorta el plazo sin ahorro de intereses a tasa 0%", () => {
    const debt = {
      monto_total: 1200,
      monto_pagado: 0,
      cuota_mensual: 100,
      tasa_anual: 0,
      dia_cargo_mensual: 1,
    };
    const impact = simulateExtraPayment(debt, 300, 6, 2026, ref);
    expect(impact.applicable).toBe(true);
    expect(impact.wouldSettleDebt).toBe(false);
    expect(impact.appliedExtra).toBe(300);
    expect(impact.monthsSaved).toBe(3);
    expect(impact.interestSaved).toBe(0);
    expect(impact.baselinePayoffDate).toBe("2026-12-01");
    expect(impact.newPayoffDate).toBe("2026-09-01");
  });

  it("con TAE > 0 el extra ahorra intereses ademas de meses", () => {
    const debt = {
      monto_total: 5000,
      monto_pagado: 0,
      cuota_mensual: 300,
      tasa_anual: 12,
      dia_cargo_mensual: 1,
    };
    const impact = simulateExtraPayment(debt, 1000, 3, 2026, ref);
    expect(impact.applicable).toBe(true);
    expect(impact.appliedExtra).toBe(1000);
    expect(impact.monthsSaved).toBeGreaterThan(0);
    expect(impact.interestSaved).toBeGreaterThan(0);
    expect(impact.newPayoffDate!.localeCompare(impact.baselinePayoffDate!)).toBeLessThan(0);
  });

  it("un extra mayor que el saldo restante salda la deuda y se recorta (clamp)", () => {
    const debt = {
      monto_total: 500,
      monto_pagado: 0,
      cuota_mensual: 100,
      tasa_anual: 0,
      dia_cargo_mensual: 1,
    };
    const impact = simulateExtraPayment(debt, 100_000, 1, 2026, ref);
    expect(impact.applicable).toBe(true);
    expect(impact.wouldSettleDebt).toBe(true);
    // capital de la cuota 1 es 100 (saldo 500 -> 400), asi que el extra maximo aplicable es 400
    expect(impact.appliedExtra).toBe(400);
    expect(impact.monthsSaved).toBe(4);
  });

  it("mes fuera del calendario de pagos no es aplicable", () => {
    const debt = {
      monto_total: 1200,
      monto_pagado: 0,
      cuota_mensual: 100,
      tasa_anual: 0,
      dia_cargo_mensual: 1,
    };
    const impact = simulateExtraPayment(debt, 100, 1, 2099, ref);
    expect(impact.applicable).toBe(false);
    expect(impact.reason).toBeTruthy();
  });

  it("deuda sin cuota mensual configurada no es aplicable (no lanza)", () => {
    const debt = {
      monto_total: 1200,
      monto_pagado: 0,
      cuota_mensual: 0,
      tasa_anual: 0,
      dia_cargo_mensual: 1,
    };
    const impact = simulateExtraPayment(debt, 100, 1, 2026, ref);
    expect(impact.applicable).toBe(false);
    expect(impact.reason).toBeTruthy();
  });

  it("deuda ya saldada no es aplicable", () => {
    const debt = {
      monto_total: 1200,
      monto_pagado: 1200,
      cuota_mensual: 100,
      tasa_anual: 0,
      dia_cargo_mensual: 1,
    };
    const impact = simulateExtraPayment(debt, 100, 1, 2026, ref);
    expect(impact.applicable).toBe(false);
    expect(impact.reason).toBe("Deuda ya saldada.");
  });

  it("extra <= 0 es un no-op aplicable sin cambios", () => {
    const debt = {
      monto_total: 1200,
      monto_pagado: 0,
      cuota_mensual: 100,
      tasa_anual: 0,
      dia_cargo_mensual: 1,
    };
    const impact = simulateExtraPayment(debt, 0, 6, 2026, ref);
    expect(impact.applicable).toBe(true);
    expect(impact.appliedExtra).toBe(0);
    expect(impact.monthsSaved).toBe(0);
    expect(impact.interestSaved).toBe(0);
    expect(impact.newPayoffDate).toBe(impact.baselinePayoffDate);
  });

  it("modo cuota mantiene el plazo y reduce la cuota futura", () => {
    const debt = {
      monto_total: 1200,
      monto_pagado: 0,
      cuota_mensual: 100,
      tasa_anual: 0,
      dia_cargo_mensual: 1,
    };
    const impact = simulateExtraPayment(debt, 300, 6, 2026, ref, "cuota");
    expect(impact.applicable).toBe(true);
    expect(impact.mode).toBe("cuota");
    expect(impact.wouldSettleDebt).toBe(false);
    expect(impact.appliedExtra).toBe(300);
    // mismo plazo: paga en diciembre igual que el plan original
    expect(impact.newPayoffDate).toBe(impact.baselinePayoffDate);
    expect(impact.monthsSaved).toBe(0);
    expect(impact.newMonthlyCuota).toBe(50);
    expect(impact.newInstallmentRows).toHaveLength(7); // junio (boost) + 6 meses restantes
  });

  it("modo term vs modo cuota dan resultados distintos con la misma tasa", () => {
    const debt = {
      monto_total: 5000,
      monto_pagado: 0,
      cuota_mensual: 300,
      tasa_anual: 12,
      dia_cargo_mensual: 1,
    };
    const term = simulateExtraPayment(debt, 1000, 3, 2026, ref, "term");
    const cuota = simulateExtraPayment(debt, 1000, 3, 2026, ref, "cuota");
    expect(term.newPayoffDate!.localeCompare(term.baselinePayoffDate!)).toBeLessThan(0);
    expect(cuota.newPayoffDate).toBe(cuota.baselinePayoffDate);
    expect(cuota.newMonthlyCuota).toBeLessThan(300);
    expect(term.interestSaved).toBeGreaterThan(0);
    expect(cuota.interestSaved).toBeGreaterThan(0);
  });
});

describe("detectActiveExtra", () => {
  const debt = {
    monto_total: 1200,
    monto_pagado: 0,
    cuota_mensual: 100,
    tasa_anual: 0,
    dia_cargo_mensual: 1,
  };

  it("no detecta nada si la planilla coincide con el estándar", () => {
    const baseline = generateAmortizationSchedule(debt, { referenceDate: ref });
    const info = detectActiveExtra(debt, baseline, 6, 2026, ref);
    expect(info.active).toBe(false);
  });

  it("detecta un extra en modo term por planilla más corta", () => {
    const baseline = generateAmortizationSchedule(debt, { referenceDate: ref });
    const impact = simulateExtraPayment(debt, 300, 6, 2026, ref, "term");
    const realPlanilla = [...baseline.slice(0, 5), ...impact.newInstallmentRows];
    const info = detectActiveExtra(debt, realPlanilla, 6, 2026, ref);
    expect(info.active).toBe(true);
    expect(info.mode).toBe("term");
    expect(info.extraAmount).toBe(300);
  });

  it("detecta un extra en modo cuota por cuotas futuras más bajas al mismo plazo", () => {
    const baseline = generateAmortizationSchedule(debt, { referenceDate: ref });
    const impact = simulateExtraPayment(debt, 300, 6, 2026, ref, "cuota");
    const realPlanilla = [...baseline.slice(0, 5), ...impact.newInstallmentRows];
    const info = detectActiveExtra(debt, realPlanilla, 6, 2026, ref);
    expect(info.active).toBe(true);
    expect(info.mode).toBe("cuota");
    expect(info.extraAmount).toBe(300);
  });

  it("no detecta nada si no hay cuota ese mes", () => {
    const info = detectActiveExtra(debt, [], 6, 2026, ref);
    expect(info.active).toBe(false);
  });
});

describe("mes en curso ya vencido (referenceDate pasado el dia_cargo_mensual)", () => {
  // dia_cargo_mensual=5, referenceDate=15 de enero: sin recorte, generateAmortizationSchedule
  // saltaria a febrero y el mes en curso (enero, cuota vencida sin pagar) desaparecería.
  const debt = {
    monto_total: 1200,
    monto_pagado: 0,
    cuota_mensual: 100,
    tasa_anual: 0,
    dia_cargo_mensual: 5,
  };
  const lateRef = new Date(2026, 0, 15); // 2026-01-15

  it("simulateExtraPayment sigue permitiendo el mes en curso", () => {
    const impact = simulateExtraPayment(debt, 50, 1, 2026, lateRef);
    expect(impact.applicable).toBe(true);
    expect(impact.reason).toBeNull();
  });

  it("detectActiveExtra tambien encuentra el mes en curso", () => {
    const planilla = [{ fecha_vencimiento: "2026-01-05", cuota_total: 100 }];
    const info = detectActiveExtra(debt, planilla, 1, 2026, lateRef);
    expect(info.active).toBe(false); // cuota_total estándar, sin extra — pero no debe fallar por "mes fuera de rango"
  });

  it("un mes futuro de verdad sigue funcionando igual (sin recorte indebido)", () => {
    const impact = simulateExtraPayment(debt, 50, 3, 2026, lateRef);
    expect(impact.applicable).toBe(true);
  });
});

describe("resolveExtraPaymentTarget", () => {
  const debt: Debt = {
    id: 1,
    acreedor: "Test",
    tipo: "Préstamo personal",
    monto_total: 1200,
    monto_pagado: 100,
    monto_pagado_registrado: 100, // solo la cuota de enero está realmente pagada
    cuota_mensual: 100,
    tasa_anual: 0,
    dia_cargo_mensual: 1,
  };
  const planilla: DebtInstallment[] = [
    { id: 1, debt_id: 1, numero_cuota: 1, fecha_vencimiento: "2026-01-01", cuota_total: 100, pagada: true },
    { id: 2, debt_id: 1, numero_cuota: 2, fecha_vencimiento: "2026-02-01", cuota_total: 100, pagada: false },
    { id: 3, debt_id: 1, numero_cuota: 3, fecha_vencimiento: "2026-03-01", cuota_total: 100, pagada: false },
  ];

  it("redirige a la próxima cuota pendiente si el mes visto ya está liquidado", () => {
    expect(resolveExtraPaymentTarget(debt, planilla, 1, 2026)).toEqual({ month: 2, year: 2026 });
  });

  it("no redirige si el mes visto todavía está pendiente", () => {
    expect(resolveExtraPaymentTarget(debt, planilla, 2, 2026)).toEqual({ month: 2, year: 2026 });
  });

  it("no redirige si el mes visto no tiene cuota real todavía (planilla no generada)", () => {
    expect(resolveExtraPaymentTarget(debt, planilla, 6, 2026)).toEqual({ month: 6, year: 2026 });
  });

  it("deuda totalmente liquidada: no hay a dónde redirigir, se mantiene el mes visto", () => {
    const paidOff: Debt = { ...debt, monto_pagado: 1200, monto_pagado_registrado: 1200 };
    expect(resolveExtraPaymentTarget(paidOff, planilla, 1, 2026)).toEqual({ month: 1, year: 2026 });
  });

  it("el extra aplicado a la cuota redirigida se detecta con detectActiveExtra sobre ese mes", () => {
    const target = resolveExtraPaymentTarget(debt, planilla, 1, 2026);
    const impact = simulateExtraPayment(debt, 50, target.month, target.year, new Date(2026, 0, 15), "term");
    expect(impact.applicable).toBe(true);
    const realPlanilla = [planilla[0]!, ...impact.newInstallmentRows];
    const info = detectActiveExtra(debt, realPlanilla, target.month, target.year, new Date(2026, 0, 15));
    expect(info.active).toBe(true);
    expect(info.extraAmount).toBe(50);
  });
});

describe("pickBaseNumeroCuota", () => {
  it("reutiliza el numero_cuota real de la cuota objetivo si ya existe", () => {
    const planilla = [
      { fecha_vencimiento: "2026-01-05", numero_cuota: 1 },
      { fecha_vencimiento: "2026-02-05", numero_cuota: 2 },
    ];
    expect(pickBaseNumeroCuota(planilla, "2026-02-05")).toBe(2);
  });

  it("sigue tras la última cuota real si el mes objetivo no tiene fila todavía", () => {
    const planilla = [
      { fecha_vencimiento: "2026-01-05", numero_cuota: 1 },
      { fecha_vencimiento: "2026-02-05", numero_cuota: 2 },
    ];
    expect(pickBaseNumeroCuota(planilla, "2026-06-05")).toBe(3);
  });

  it("empieza en 1 si no hay planilla previa", () => {
    expect(pickBaseNumeroCuota([], "2026-01-05")).toBe(1);
  });
});
