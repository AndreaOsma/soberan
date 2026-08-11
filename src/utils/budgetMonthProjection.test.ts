import { describe, expect, it } from "vitest";
import type { Account, Debt, DebtInstallment, Goal, RecurringEntry } from "../types";
import {
  eachMonthInclusive,
  plannedEntryAmountInMonth,
  projectAhorroAtBudgetMonth,
  projectAhorroLongHorizon,
  projectDebtAtBudgetMonth,
} from "./budgetMonthProjection";
import { entryAppliesBeforeMonth } from "./subscriptionBudget";

describe("entryAppliesBeforeMonth", () => {
  it("detecta series que ya aplicaban en meses previos", () => {
    expect(entryAppliesBeforeMonth({ mes_inicio: 1, anio_inicio: 2026, es_puntual: false }, 3, 2026)).toBe(true);
    expect(entryAppliesBeforeMonth({ mes_inicio: 3, anio_inicio: 2026, es_puntual: false }, 3, 2026)).toBe(false);
    expect(entryAppliesBeforeMonth({ mes_inicio: null, anio_inicio: null, es_puntual: false }, 3, 2026)).toBe(true);
    expect(entryAppliesBeforeMonth({ mes_inicio: 1, anio_inicio: 2026, es_puntual: true }, 3, 2026)).toBe(false);
  });
});

describe("budgetMonthProjection", () => {
  it("lista meses inclusivos", () => {
    expect(eachMonthInclusive(11, 2025, 2, 2026)).toEqual([
      { month: 11, year: 2025 },
      { month: 12, year: 2025 },
      { month: 1, year: 2026 },
      { month: 2, year: 2026 },
    ]);
  });

  it("proyecta ahorro con saldo actual + plan hasta el mes visto", () => {
    const entry = {
      id: 10,
      nombre: "Fondo emergencia",
      monto_estimado: 200,
      es_ingreso: false,
      es_fijo: true,
      tipo_partida: "ahorro_inversion",
      cuenta_destino_id: 1,
      mes_inicio: 1,
      anio_inicio: 2026,
    } as RecurringEntry;
    const accounts = [{ id: 1, alias_real: "Ahorro", balance_actual: 1000 } as Account];

    const summary = projectAhorroAtBudgetMonth({
      viewMonth: 5,
      viewYear: 2026,
      refMonth: 3,
      refYear: 2026,
      recurringEntries: [entry],
      monthlyBudgets: [],
      accounts,
      investments: [],
    });

    expect(summary.isFutureOrCurrent).toBe(true);
    expect(summary.rows).toHaveLength(1);
    // mar+abr+may = 3*200
    expect(summary.rows[0]?.plannedThroughView).toBe(600);
    expect(summary.rows[0]?.projected).toBe(1600);
    expect(summary.totalProjected).toBe(1600);
    // sin rentabilidad_anual_pct: projectedCompound es null y el total compuesto coincide con el lineal
    expect(summary.rows[0]?.projectedCompound).toBeNull();
    expect(summary.totalProjectedCompound).toBe(summary.totalProjected);
  });

  it("proyecta ahorro con interés compuesto cuando hay rentabilidad_anual_pct", () => {
    const entry = {
      id: 11,
      nombre: "ETF indexado",
      monto_estimado: 200,
      es_ingreso: false,
      es_fijo: true,
      tipo_partida: "ahorro_inversion",
      cuenta_destino_id: 1,
      mes_inicio: 1,
      anio_inicio: 2026,
      rentabilidad_anual_pct: 12,
    } as RecurringEntry;
    const accounts = [{ id: 1, alias_real: "Ahorro", balance_actual: 1000 } as Account];

    const summary = projectAhorroAtBudgetMonth({
      viewMonth: 5,
      viewYear: 2026,
      refMonth: 3,
      refYear: 2026,
      recurringEntries: [entry],
      monthlyBudgets: [],
      accounts,
      investments: [],
    });

    // mar+abr+may compuestos al 1%/mes desde 1000, con aportación de 200 cada mes
    expect(summary.rows[0]?.projected).toBe(1600); // lineal sin cambios
    expect(summary.rows[0]?.projectedCompound).toBe(1636.32);
    expect(summary.totalProjectedCompound).toBe(1636.32);
  });

  it("no vuelve a sumar la aportación del mes si ya está movida", () => {
    const entry = {
      id: 10,
      nombre: "Ahorro",
      monto_estimado: 100,
      es_ingreso: false,
      es_fijo: true,
      tipo_partida: "ahorro_inversion",
      cuenta_destino_id: 1,
      mes_inicio: 1,
      anio_inicio: 2026,
    } as RecurringEntry;

    const summary = projectAhorroAtBudgetMonth({
      viewMonth: 4,
      viewYear: 2026,
      refMonth: 4,
      refYear: 2026,
      recurringEntries: [entry],
      monthlyBudgets: [{
        id: 1,
        recurring_entry_id: 10,
        mes: 4,
        anio: 2026,
        monto_real: 100,
        excluido: false,
        movido_a_cuenta: true,
      }],
      accounts: [{ id: 1, alias_real: "A", balance_actual: 500 } as Account],
      investments: [],
    });

    expect(summary.rows[0]?.plannedThroughView).toBe(0);
    expect(summary.rows[0]?.projected).toBe(500);
  });

  it("usa override mensual si existe", () => {
    const entry = {
      id: 7,
      nombre: "ETF",
      monto_estimado: 100,
      es_ingreso: false,
      tipo_partida: "ahorro_inversion",
      mes_inicio: 1,
      anio_inicio: 2026,
    } as RecurringEntry;
    expect(plannedEntryAmountInMonth(entry, [{
      id: 1,
      recurring_entry_id: 7,
      mes: 2,
      anio: 2026,
      monto_real: 250,
      excluido: false,
    }], 2, 2026)).toBe(250);
  });

  it("proyecta pendiente de deuda restando cuotas planificadas", () => {
    const debt = {
      id: 1,
      nombre: "Ortodoncia",
      acreedor: "Clínica",
      monto_total: 1000,
      monto_pagado: 400,
      cuota_mensual: 100,
      dia_cargo_mensual: 5,
      tipo: "Otro",
    } as Debt;
    const installments: DebtInstallment[] = [
      {
        id: 1, debt_id: 1, numero_cuota: 5, fecha_vencimiento: "2026-03-05",
        capital: 100, interes: 0, cuota_total: 100, saldo_pendiente: 600, pagada: false,
      },
      {
        id: 2, debt_id: 1, numero_cuota: 6, fecha_vencimiento: "2026-04-05",
        capital: 100, interes: 0, cuota_total: 100, saldo_pendiente: 500, pagada: false,
      },
      {
        id: 3, debt_id: 1, numero_cuota: 7, fecha_vencimiento: "2026-05-05",
        capital: 100, interes: 0, cuota_total: 100, saldo_pendiente: 400, pagada: false,
      },
    ];

    const summary = projectDebtAtBudgetMonth({
      viewMonth: 5,
      viewYear: 2026,
      refMonth: 3,
      refYear: 2026,
      debts: [debt],
      debtInstallments: installments,
    });

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]?.remainingNow).toBe(600);
    expect(summary.rows[0]?.plannedPaymentsThroughView).toBe(300);
    expect(summary.rows[0]?.projectedRemaining).toBe(300);
  });
});

describe("projectAhorroLongHorizon", () => {
  it("usa objetivo_fecha de la partida cuando no hay goal vinculado", () => {
    const entry = {
      id: 20,
      nombre: "Fondo viaje",
      monto_estimado: 100,
      es_ingreso: false,
      tipo_partida: "ahorro_inversion",
      cuenta_destino_id: 1,
      mes_inicio: 1,
      anio_inicio: 2026,
      objetivo_fecha: "2026-02-01",
      rentabilidad_anual_pct: 12,
    } as RecurringEntry;
    const accounts = [{ id: 1, alias_real: "Ahorro", balance_actual: 1000 } as Account];

    const rows = projectAhorroLongHorizon({
      recurringEntries: [entry],
      monthlyBudgets: [],
      accounts,
      investments: [],
      goals: [],
      refMonth: 1,
      refYear: 2026,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.horizonSource).toBe("objetivo_fecha");
    expect(rows[0]?.targetMonth).toBe(2);
    expect(rows[0]?.targetYear).toBe(2026);
    expect(rows[0]?.totalContributed).toBe(1200);
    expect(rows[0]?.projectedCompound).toBe(1221.1);
    expect(rows[0]?.gains).toBe(21.1);
  });

  it("prioriza la fecha límite del goal vinculado sobre objetivo_fecha", () => {
    const entry = {
      id: 21,
      nombre: "Fondo viaje",
      monto_estimado: 100,
      es_ingreso: false,
      tipo_partida: "ahorro_inversion",
      cuenta_destino_id: 1,
      mes_inicio: 1,
      anio_inicio: 2026,
      objetivo_fecha: "2030-01-01",
      goal_id: 5,
      rentabilidad_anual_pct: 12,
    } as RecurringEntry;
    const goal = { id: 5, nombre: "Viaje", monto_objetivo: 2000, monto_actual: 0, fecha_limite: "2026-02-01" } as Goal;
    const accounts = [{ id: 1, alias_real: "Ahorro", balance_actual: 1000 } as Account];

    const rows = projectAhorroLongHorizon({
      recurringEntries: [entry],
      monthlyBudgets: [],
      accounts,
      investments: [],
      goals: [goal],
      refMonth: 1,
      refYear: 2026,
    });

    expect(rows[0]?.horizonSource).toBe("goal");
    expect(rows[0]?.targetMonth).toBe(2);
    expect(rows[0]?.targetYear).toBe(2026);
  });

  it("usa un horizonte por defecto cuando no hay goal ni objetivo_fecha", () => {
    const entry = {
      id: 22,
      nombre: "Jubilación",
      monto_estimado: 50,
      es_ingreso: false,
      tipo_partida: "ahorro_inversion",
      cuenta_destino_id: 1,
      mes_inicio: 1,
      anio_inicio: 2026,
      rentabilidad_anual_pct: 6,
    } as RecurringEntry;
    const accounts = [{ id: 1, alias_real: "Ahorro", balance_actual: 500 } as Account];

    const rows = projectAhorroLongHorizon({
      recurringEntries: [entry],
      monthlyBudgets: [],
      accounts,
      investments: [],
      goals: [],
      refMonth: 1,
      refYear: 2026,
      fallbackHorizonYears: 1,
    });

    expect(rows[0]?.horizonSource).toBe("fallback");
    expect(rows[0]?.targetMonth).toBe(1);
    expect(rows[0]?.targetYear).toBe(2027);
    expect(rows[0]?.gains).toBeGreaterThan(0);
  });

  it("no genera fila para partidas sin rentabilidad_anual_pct", () => {
    const entry = {
      id: 23,
      nombre: "Sin tasa",
      monto_estimado: 100,
      es_ingreso: false,
      tipo_partida: "ahorro_inversion",
      cuenta_destino_id: 1,
      objetivo_fecha: "2026-06-01",
    } as RecurringEntry;

    const rows = projectAhorroLongHorizon({
      recurringEntries: [entry],
      monthlyBudgets: [],
      accounts: [{ id: 1, alias_real: "Ahorro", balance_actual: 500 } as Account],
      investments: [],
      goals: [],
      refMonth: 1,
      refYear: 2026,
    });

    expect(rows).toHaveLength(0);
  });

  it("no genera fila si la fecha objetivo ya pasó", () => {
    const entry = {
      id: 24,
      nombre: "Fecha pasada",
      monto_estimado: 100,
      es_ingreso: false,
      tipo_partida: "ahorro_inversion",
      cuenta_destino_id: 1,
      objetivo_fecha: "2025-06-01",
      rentabilidad_anual_pct: 6,
    } as RecurringEntry;

    const rows = projectAhorroLongHorizon({
      recurringEntries: [entry],
      monthlyBudgets: [],
      accounts: [{ id: 1, alias_real: "Ahorro", balance_actual: 500 } as Account],
      investments: [],
      goals: [],
      refMonth: 1,
      refYear: 2026,
    });

    expect(rows).toHaveLength(0);
  });
});
