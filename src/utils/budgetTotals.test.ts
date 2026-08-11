import { describe, expect, it } from "vitest";
import { computeMonthlyBudgetTotals, projectAccountCashBalance, projectNetWorthBalance, buildNetWorthProjections, cumulativeBudgetProjection } from "./budgetTotals";
import type { Debt, DebtInstallment } from "../types";

const baseRecurring = {
  es_fijo: true,
  categoria: "General",
} as const;

describe("computeMonthlyBudgetTotals", () => {
  it("incluye nómina del historial laboral aunque no haya partida recurrente", () => {
    const totals = computeMonthlyBudgetTotals({
      recurringEntries: [],
      month: 7,
      year: 2026,
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
        dias_alta: 30,
      }],
    });

    expect(totals.monthlyIncome).toBeGreaterThan(2000);
  });

  it("excluye partidas puntuales de otros meses", () => {
    const totals = computeMonthlyBudgetTotals({
      recurringEntries: [{
        id: 1,
        nombre: "Solo junio",
        monto_estimado: 9000,
        es_ingreso: false,
        es_fijo: false,
        categoria: "General",
        tipo_partida: "gasto",
        es_puntual: true,
        mes_inicio: 6,
        anio_inicio: 2026,
      }],
      month: 7,
      year: 2026,
    });

    expect(totals.monthlyConsumption).toBe(0);
  });

  it("ignora partidas excluidas del mes en presupuesto", () => {
    const totals = computeMonthlyBudgetTotals({
      recurringEntries: [{
        id: 10,
        nombre: "Viaje",
        monto_estimado: 4000,
        es_ingreso: false,
        ...baseRecurring,
        tipo_partida: "gasto",
        es_puntual: true,
        es_fondo: false,
        mes_inicio: 7,
        anio_inicio: 2026,
      }],
      month: 7,
      year: 2026,
      monthlyBudgets: [{
        id: 1,
        recurring_entry_id: 10,
        mes: 7,
        anio: 2026,
        monto_real: 0,
        excluido: true,
      }],
    });

    expect(totals.monthlyConsumption).toBe(0);
  });

  it("no suma gastos legacy fuera de fondos, planificados o suscripciones", () => {
    const totals = computeMonthlyBudgetTotals({
      recurringEntries: [
        {
          id: 1,
          nombre: "Legacy fijo",
          monto_estimado: 3000,
          es_ingreso: false,
          ...baseRecurring,
          tipo_partida: "gasto",
          es_puntual: false,
          es_fondo: false,
          bloque: "necesidades",
        },
        {
          id: 2,
          nombre: "Comida fondo",
          monto_estimado: 400,
          es_ingreso: false,
          ...baseRecurring,
          tipo_partida: "gasto",
          es_fondo: true,
        },
      ],
      month: 7,
      year: 2026,
    });

    expect(totals.monthlyConsumption).toBe(400);
  });

  it("desglosa monthlyConsumption en fondos, planificados y suscripciones", () => {
    const totals = computeMonthlyBudgetTotals({
      recurringEntries: [
        {
          id: 1,
          nombre: "Comida",
          monto_estimado: 300,
          es_ingreso: false,
          ...baseRecurring,
          tipo_partida: "gasto",
          es_fondo: true,
        },
        {
          id: 2,
          nombre: "Libre",
          monto_estimado: 500,
          es_ingreso: false,
          ...baseRecurring,
          tipo_partida: "gasto",
          es_puntual: true,
          es_fondo: false,
          mes_inicio: 7,
          anio_inicio: 2026,
        },
        {
          id: 3,
          nombre: "Netflix",
          monto_estimado: 12,
          es_ingreso: false,
          ...baseRecurring,
          tipo_partida: "suscripcion",
          frecuencia: "mensual",
        },
      ],
      month: 7,
      year: 2026,
    });

    expect(totals.monthlyFondos).toBe(300);
    expect(totals.monthlyPuntual).toBe(500);
    expect(totals.monthlySubs).toBe(12);
    expect(totals.monthlyConsumption).toBe(812);
  });

  it("cuenta ahorro a cuenta sin tratarlo como salida de liquidez", () => {
    const totals = computeMonthlyBudgetTotals({
      recurringEntries: [
        { id: 1, nombre: "Nómina", monto_estimado: 2500, es_ingreso: true, ...baseRecurring },
        {
          id: 2,
          nombre: "Comida",
          monto_estimado: 400,
          es_ingreso: false,
          ...baseRecurring,
          tipo_partida: "gasto",
          es_fondo: true,
        },
        {
          id: 3,
          nombre: "Fondo emergencia",
          monto_estimado: 625,
          es_ingreso: false,
          ...baseRecurring,
          tipo_partida: "ahorro_inversion",
          cuenta_destino_id: 2,
        },
      ],
      month: 7,
      year: 2026,
    });

    expect(totals.monthlyAhorroInversion).toBe(625);
    expect(totals.monthlyAhorroToCartera).toBe(0);
    expect(totals.monthlyLiquidityOutflows).toBe(400);
  });

  it("cuenta aportaciones a cartera como salida de liquidez", () => {
    const totals = computeMonthlyBudgetTotals({
      recurringEntries: [
        { id: 1, nombre: "Nómina", monto_estimado: 2500, es_ingreso: true, ...baseRecurring },
        {
          id: 2,
          nombre: "Libre",
          monto_estimado: 1800,
          es_ingreso: false,
          ...baseRecurring,
          tipo_partida: "gasto",
          es_puntual: true,
          es_fondo: false,
          mes_inicio: 7,
          anio_inicio: 2026,
        },
        {
          id: 3,
          nombre: "ETF",
          monto_estimado: 625,
          es_ingreso: false,
          ...baseRecurring,
          tipo_partida: "ahorro_inversion",
          cartera_destino: "Index",
        },
      ],
      month: 7,
      year: 2026,
    });

    expect(totals.monthlyLiquidityOutflows).toBe(2425);
  });
});

describe("projectNetWorthBalance", () => {
  it("suma ahorro planificado al patrimonio", () => {
    const proj90 = projectNetWorthBalance(20000, 625, 3);
    expect(proj90).toBeGreaterThan(20000);
    expect(proj90).toBeCloseTo(20000 + 625 * 0.95 * 3, 0);
  });

  it("resta cuando el ahorro mensual es negativo", () => {
    const proj90 = projectNetWorthBalance(5000, -800, 3);
    expect(proj90).toBeLessThan(5000);
  });

  it("añade revalorización compuesta sobre inversiones cuando está activa", () => {
    const linear = projectNetWorthBalance(20000, 625, 3, { annualReturnPct: 0, investmentsNow: 10000 });
    const withReturn = projectNetWorthBalance(20000, 625, 3, { annualReturnPct: 12, investmentsNow: 10000 });
    expect(withReturn).toBeGreaterThan(linear);
  });
});

describe("projectAccountCashBalance", () => {
  it("proyecta liquidez en cuentas tras gastos de vida", () => {
    const proj90 = projectAccountCashBalance(5000, 2500, 1800, 3);
    expect(proj90).toBeGreaterThan(5000);
  });

  it("baja la liquidez si inviertes en cartera cada mes", () => {
    const sinInversion = projectAccountCashBalance(8000, 2500, 1800, 3);
    const conInversion = projectAccountCashBalance(8000, 2500, 1800 + 625, 3);
    expect(conInversion).toBeLessThan(sinInversion);
  });
});

describe("buildNetWorthProjections", () => {
  const baseSchedule = {
    recurringEntries: [
      {
        ...baseRecurring,
        id: 2,
        nombre: "Alquiler",
        monto_estimado: 800,
        es_ingreso: false,
        categoria: "Vivienda",
        tipo_partida: "gasto" as const,
        bloque: "necesidades" as const,
        frecuencia: "mensual",
        mes_inicio: 1,
        anio_inicio: 2020,
      },
    ],
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
    debts: [] as Debt[],
    debtInstallments: [] as DebtInstallment[],
  };

  it("genera filas para 1, 3, 6 y 12 meses con delta", () => {
    const rows = buildNetWorthProjections({
      netWorthNow: 13500,
      cashNow: 5000,
      month: 7,
      year: 2026,
      budgetSchedule: baseSchedule,
    });

    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.months)).toEqual([1, 3, 6, 12]);
    expect(rows[0].delta).toBeCloseTo(rows[0].netWorth - 13500, 2);
    expect(rows[3].netWorth).toBeGreaterThan(rows[0].netWorth);
    expect(rows[3].cash).not.toBe(rows[3].netWorth);
  });

  it("usa planilla de deudas mes a mes (cuotas variables)", () => {
    const debt: Debt = {
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
    const schedule = {
      ...baseSchedule,
      recurringEntries: baseSchedule.recurringEntries,
      workHistory: baseSchedule.workHistory,
      debts: [debt],
      debtInstallments: [] as DebtInstallment[],
    };

    const scheduled = cumulativeBudgetProjection(7, 2026, 3, schedule);
    const julTotals = computeMonthlyBudgetTotals({ ...schedule, month: 7, year: 2026 });
    const linearFlat = julTotals.monthlySavings * 0.95 * 3;

    expect(scheduled.savingsSum).toBeGreaterThan(linearFlat);
    expect(computeMonthlyBudgetTotals({ ...schedule, month: 9, year: 2026 }).monthlyDebtPayments).toBe(0);
  });
});
