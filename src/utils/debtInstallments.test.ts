import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Debt, DebtInstallment } from "../types";
import {
  budgetDebtRows,
  budgetDebtRowsForTotal,
  dedupedBudgetDebtRows,
  enrichInstallmentRows,
  generateAmortizationSchedule,
  installmentStatus,
  isDebtArchived,
  recurringExpenseNames,
} from "./debtInstallments";

const jul2026 = new Date("2026-07-14T12:00:00");

describe("isDebtArchived", () => {
  it("archiva por flag o saldo ~0", () => {
    expect(isDebtArchived({ monto_total: 100, monto_pagado: 100, archivada: false })).toBe(true);
    expect(isDebtArchived({ monto_total: 100, monto_pagado: 50, archivada: true })).toBe(true);
    expect(isDebtArchived({ monto_total: 100, monto_pagado: 50, archivada: false })).toBe(false);
  });
});

const ortodoncia: Debt = {
  id: 1,
  nombre: "Ortodoncia",
  acreedor: "Clínica",
  monto_total: 5000,
  monto_pagado: 4787,
  cuota_mensual: 99,
  fecha_vencimiento: "2026-08-26",
  dia_cargo_mensual: 26,
  tipo: "Otro",
};

const coche: Debt = {
  id: 2,
  nombre: "Coche",
  acreedor: "MyInvestor",
  monto_total: 15000,
  monto_pagado: 5000,
  cuota_mensual: 350,
  fecha_vencimiento: null,
  dia_cargo_mensual: 5,
  tipo: "Préstamo personal",
};

const staleMaturity: Debt = {
  id: 4,
  nombre: "Hipoteca",
  acreedor: "Banco",
  monto_total: 100000,
  monto_pagado: 95000,
  cuota_mensual: 500,
  fecha_vencimiento: "2025-06-01",
  dia_cargo_mensual: 1,
  tipo: "Hipoteca",
};

const planillaIncompleta: Debt = {
  id: 6,
  nombre: "X",
  acreedor: "X",
  monto_total: 1000,
  monto_pagado: 0,
  cuota_mensual: 100,
  fecha_vencimiento: null,
  dia_cargo_mensual: 15,
  tipo: "Otro",
};

const instPlanillaOct: DebtInstallment[] = [
  {
    id: 20,
    debt_id: 6,
    numero_cuota: 1,
    fecha_vencimiento: "2026-10-01",
    capital: 90,
    interes: 10,
    cuota_total: 100,
    saldo_pendiente: 900,
    pagada: false,
    notas: null,
  },
];

function assignedFor(debts: Debt[], installments: DebtInstallment[], month: number, year: number) {
  return budgetDebtRows(debts, installments, month, year, jul2026).map((r) => r.assigned);
}

describe("budgetDebtRows", () => {
  it("Ortodoncia: jul 99, ago 114, sep vacío", () => {
    expect(assignedFor([ortodoncia], [], 7, 2026)).toEqual([99]);
    expect(assignedFor([ortodoncia], [], 8, 2026)).toEqual([114]);
    expect(assignedFor([ortodoncia], [], 9, 2026)).toEqual([]);
  });

  it("Coche sin planilla: fallback cuota en julio", () => {
    expect(assignedFor([coche], [], 7, 2026)).toEqual([350]);
  });

  it("Planilla solo octubre: jul vacío, oct con cuota", () => {
    expect(assignedFor([planillaIncompleta], instPlanillaOct, 7, 2026)).toEqual([]);
    expect(assignedFor([planillaIncompleta], instPlanillaOct, 10, 2026)).toEqual([100]);
  });

  it("Planilla que empieza en agosto: jul vacío", () => {
    const debt: Debt = { ...planillaIncompleta, id: 7 };
    const inst: DebtInstallment[] = [{
      id: 30,
      debt_id: 7,
      numero_cuota: 1,
      fecha_vencimiento: "2026-08-15",
      capital: 100,
      interes: 0,
      cuota_total: 100,
      saldo_pendiente: 900,
      pagada: false,
      notas: null,
    }];
    expect(assignedFor([debt], inst, 7, 2026)).toEqual([]);
    expect(assignedFor([debt], inst, 8, 2026)).toEqual([100]);
  });

  it("última cuota del mes visible aunque haya otra pendiente anterior", () => {
    const debt: Debt = {
      id: 8,
      nombre: "Préstamo",
      acreedor: "Banco",
      monto_total: 1000,
      monto_pagado: 900,
      cuota_mensual: 100,
      fecha_vencimiento: "2026-07-15",
      dia_cargo_mensual: 15,
      tipo: "Préstamo personal",
    };
    const inst: DebtInstallment[] = [
      {
        id: 40,
        debt_id: 8,
        numero_cuota: 9,
        fecha_vencimiento: "2026-06-15",
        capital: 100,
        interes: 0,
        cuota_total: 100,
        saldo_pendiente: 100,
        pagada: false,
        notas: null,
      },
      {
        id: 41,
        debt_id: 8,
        numero_cuota: 10,
        fecha_vencimiento: "2026-07-15",
        capital: 100,
        interes: 0,
        cuota_total: 100,
        saldo_pendiente: 0,
        pagada: false,
        notas: null,
      },
    ];
    expect(assignedFor([debt], inst, 6, 2026)).toEqual([100]);
    expect(assignedFor([debt], inst, 7, 2026)).toEqual([100]);
  });

  it("cuota pagada del mes sigue en presupuesto y resta del sin asignar", () => {
    const debt: Debt = {
      id: 9,
      nombre: "Ortodoncia",
      acreedor: "Clínica",
      monto_total: 5000,
      monto_pagado: 4900,
      monto_pagado_registrado: 4900,
      cuota_mensual: 100,
      fecha_vencimiento: "2026-08-26",
      dia_cargo_mensual: 26,
      tipo: "Otro",
    };
    const inst: DebtInstallment[] = [{
      id: 50,
      debt_id: 9,
      numero_cuota: 49,
      fecha_vencimiento: "2026-07-26",
      capital: 100,
      interes: 0,
      cuota_total: 100,
      saldo_pendiente: 0,
      pagada: true,
      notas: null,
    }];
    const rows = budgetDebtRows([debt], inst, 7, 2026, jul2026);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assigned).toBe(100);
    expect(rows[0]!.paidInMonth).toBe(true);
    expect(budgetDebtRowsForTotal(rows).reduce((s, r) => s + r.assigned, 0)).toBe(100);
  });

  it("deuda liquidada/archivada sigue en meses históricos con planilla", () => {
    const debt: Debt = {
      id: 11,
      nombre: "Préstamo",
      acreedor: "Banco",
      monto_total: 1000,
      monto_pagado: 1000,
      monto_pagado_registrado: 1000,
      cuota_mensual: 100,
      fecha_vencimiento: "2026-07-15",
      dia_cargo_mensual: 15,
      tipo: "Préstamo personal",
      archivada: true,
    };
    const inst: DebtInstallment[] = [
      {
        id: 60,
        debt_id: 11,
        numero_cuota: 9,
        fecha_vencimiento: "2026-06-15",
        capital: 100,
        interes: 0,
        cuota_total: 100,
        saldo_pendiente: 0,
        pagada: true,
        notas: null,
      },
      {
        id: 61,
        debt_id: 11,
        numero_cuota: 10,
        fecha_vencimiento: "2026-07-15",
        capital: 100,
        interes: 0,
        cuota_total: 100,
        saldo_pendiente: 0,
        pagada: true,
        notas: null,
      },
    ];
    const jun = budgetDebtRows([debt], inst, 6, 2026, jul2026);
    const jul = budgetDebtRows([debt], inst, 7, 2026, jul2026);
    const ago = budgetDebtRows([debt], inst, 8, 2026, jul2026);
    expect(jun).toHaveLength(1);
    expect(jun[0]!.assigned).toBe(100);
    expect(jun[0]!.paidInMonth).toBe(true);
    expect(jul).toHaveLength(1);
    expect(jul[0]!.assigned).toBe(100);
    expect(ago).toEqual([]);
  });

  it("deuda liquidada sin planilla no inventa cuotas en meses futuros", () => {
    const debt: Debt = {
      ...coche,
      id: 12,
      monto_pagado: coche.monto_total,
      archivada: true,
    };
    expect(assignedFor([debt], [], 7, 2026)).toEqual([]);
  });

  it("Vencimiento antiguo con saldo: fallback cuota", () => {
    expect(assignedFor([staleMaturity], [], 7, 2026)).toEqual([500]);
  });
});

describe("dedupedBudgetDebtRows", () => {
  it("muestra fila pero excluye del total si existe Cuota MyInvestor", () => {
    const recurring = recurringExpenseNames([{ nombre: "Cuota MyInvestor", es_ingreso: false }]);
    const rows = dedupedBudgetDebtRows([coche], [], 7, 2026, recurring, jul2026);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assigned).toBe(350);
    expect(rows[0]!.excludedFromTotal).toBe(true);
    expect(budgetDebtRowsForTotal(rows).reduce((s, r) => s + r.assigned, 0)).toBe(0);
  });
});

describe("installmentStatus", () => {
  // installmentStatus usa new Date() para decidir vencida vs pendiente; fija el
  // reloj entre las dos fechas de vencimiento del fixture (jul/ago 2026) para que
  // el test no dependa de la fecha real en la que se ejecute.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("no marca pagada si el flag está mal pero pagos registrados no cubren la cuota", () => {
    const debt: Debt = {
      id: 10,
      nombre: "Test",
      acreedor: "Banco",
      monto_total: 1000,
      monto_pagado: 100,
      monto_pagado_registrado: 100,
      cuota_mensual: 100,
      fecha_vencimiento: null,
      dia_cargo_mensual: 1,
      tipo: "Otro",
    };
    const planilla: DebtInstallment[] = [
      {
        id: 60,
        debt_id: 10,
        numero_cuota: 1,
        fecha_vencimiento: "2026-07-01",
        capital: 100,
        interes: 0,
        cuota_total: 100,
        saldo_pendiente: 900,
        pagada: true,
        notas: null,
      },
      {
        id: 61,
        debt_id: 10,
        numero_cuota: 2,
        fecha_vencimiento: "2026-08-01",
        capital: 100,
        interes: 0,
        cuota_total: 100,
        saldo_pendiente: 800,
        pagada: true,
        notas: null,
      },
    ];
    expect(installmentStatus(planilla[0]!, debt, planilla)).toBe("pagada");
    expect(installmentStatus(planilla[1]!, debt, planilla)).toBe("pendiente");
  });

  it("no marca pagada con monto_pagado importado si no hay pagos registrados", () => {
    const debt: Debt = {
      id: 11,
      nombre: "Importada",
      acreedor: "Banco",
      monto_total: 1000,
      monto_pagado: 400,
      monto_pagado_registrado: 0,
      cuota_mensual: 200,
      fecha_vencimiento: null,
      dia_cargo_mensual: 1,
      tipo: "Otro",
    };
    const planilla: DebtInstallment[] = [
      {
        id: 70,
        debt_id: 11,
        numero_cuota: 1,
        fecha_vencimiento: "2026-07-01",
        capital: 200,
        interes: 0,
        cuota_total: 200,
        saldo_pendiente: 800,
        pagada: true,
        notas: null,
      },
      {
        id: 71,
        debt_id: 11,
        numero_cuota: 2,
        fecha_vencimiento: "2026-08-01",
        capital: 200,
        interes: 0,
        cuota_total: 200,
        saldo_pendiente: 600,
        pagada: true,
        notas: null,
      },
    ];
    expect(installmentStatus(planilla[0]!, debt, planilla)).not.toBe("pagada");
    expect(installmentStatus(planilla[1]!, debt, planilla)).not.toBe("pagada");
  });
});

describe("enrichInstallmentRows", () => {
  it("calcula saldo y deja pagada en false (la fija el backend según pagos)", () => {
    const rows = enrichInstallmentRows(
      { monto_total: 1000, monto_pagado: 200, tasa_anual: 0 },
      [
        { numero_cuota: 1, fecha_vencimiento: "2026-07-01", cuota_total: 200 },
        { numero_cuota: 2, fecha_vencimiento: "2026-08-01", cuota_total: 200 },
      ],
    );
    expect(rows[0]!.pagada).toBe(false);
    expect(rows[0]!.saldo_pendiente).toBe(600);
    expect(rows[1]!.pagada).toBe(false);
    expect(rows[0]!.capital).toBe(200);
    expect(rows[0]!.interes).toBe(0);
  });
});

describe("generateAmortizationSchedule", () => {
  it("respeta mes de primera cuota y usa dia_cargo para el día", () => {
    const schedule = generateAmortizationSchedule(
      {
        monto_total: 1000,
        monto_pagado: 0,
        cuota_mensual: 100,
        tasa_anual: 0,
        dia_cargo_mensual: 26,
      },
      { startDate: "2026-08-01", paymentCount: 10 },
    );
    expect(schedule[0]!.fecha_vencimiento).toBe("2026-08-26");
    expect(schedule[0]!.fecha_vencimiento.slice(5, 7)).toBe("08");
  });
});
