import { describe, expect, it } from "vitest";
import { buildAnnualBudgetSummary, sumAnnualLinesByName } from "./annualBudget";

describe("buildAnnualBudgetSummary", () => {
  it("suma 12 meses con deuda variable en planilla", () => {
    const summary = buildAnnualBudgetSummary({
      year: 2026,
      recurringEntries: [],
      workHistory: [{
        id: 1,
        empresa: "Acme",
        grupo_cotizacion: "1",
        fecha_inicio: "2020-01-01",
        fecha_fin: null,
        salario_bruto: 3000,
        periodicidad: "M",
        irpf_pct: 15,
        ss_pct: 6.35,
        dias_alta: 22,
      }],
      salaryBreakdowns: [],
      monthlyBudgetsByMonth: {},
      debts: [{
        id: 1,
        nombre: "Ortodoncia",
        acreedor: "Clínica",
        monto_total: 5000,
        monto_pagado: 4787,
        cuota_mensual: 99,
        fecha_vencimiento: "2026-08-26",
        dia_cargo_mensual: 26,
        tipo: "Otro",
      }],
      debtInstallments: [],
      currentMonth: 7,
      currentYear: 2026,
    });

    expect(summary.months).toHaveLength(12);
    expect(summary.months[6]?.debt).toBeGreaterThan(0);
    expect(summary.months[8]?.debt).toBe(0);
    expect(summary.totals.income).toBeGreaterThan(0);
  });

  it("acumula desglose de gastos en totales anuales", () => {
    const summary = buildAnnualBudgetSummary({
      year: 2026,
      recurringEntries: [
        {
          id: 1,
          nombre: "Comida",
          categoria: "Comida",
          monto_estimado: 300,
          es_ingreso: false,
          tipo_partida: "gasto",
          es_fondo: true,
          es_puntual: false,
          mes_inicio: 1,
          anio_inicio: 2026,
        },
        {
          id: 2,
          nombre: "Regalo",
          categoria: "Ocio",
          monto_estimado: 50,
          es_ingreso: false,
          tipo_partida: "gasto",
          es_fondo: false,
          es_puntual: true,
          mes_inicio: 1,
          anio_inicio: 2026,
        },
        {
          id: 3,
          nombre: "Netflix",
          categoria: "Suscripciones y facturas",
          monto_estimado: 15,
          es_ingreso: false,
          tipo_partida: "suscripcion",
          mes_inicio: 1,
          anio_inicio: 2026,
        },
      ] as import("../types").RecurringEntry[],
      workHistory: [],
      salaryBreakdowns: [],
      monthlyBudgetsByMonth: {},
      debts: [],
      debtInstallments: [],
    });

    expect(summary.totals.fondos).toBe(3600);
    expect(summary.totals.puntual).toBe(50);
    expect(summary.totals.subs).toBe(180);
    expect(summary.totals.consumption).toBe(3830);

    const jan = summary.months[0]!;
    expect(jan.lines.some((l) => l.group === "fondos" && l.label === "Comida")).toBe(true);
    expect(jan.lines.some((l) => l.group === "puntual" && l.label === "Regalo")).toBe(true);
    expect(jan.lines.some((l) => l.group === "subs" && l.label === "Netflix")).toBe(true);
    expect(summary.months[1]!.lines.some((l) => l.group === "puntual")).toBe(false);

    const byName = sumAnnualLinesByName(summary.months, ["fondos", "puntual", "subs"]);
    expect(byName.find((row) => row.label === "Comida")?.amount).toBe(3600);
    expect(byName.find((row) => row.label === "Netflix")?.amount).toBe(180);
    expect(byName.find((row) => row.label === "Regalo")?.amount).toBe(50);
  });
});
