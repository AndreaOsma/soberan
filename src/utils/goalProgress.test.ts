import { describe, expect, it } from "vitest";
import type { Account, Debt, Goal, Investment, MonthlyBudget, RecurringEntry } from "../types";
import {
  buildGoalProgressSnapshot,
  findGoalForDestino,
  findGoalForEntry,
  goalCurrentAmount,
  goalLinkedDebts,
  goalMonthlyContribution,
  goalPartidasCurrentAmount,
} from "./goalProgress";

const accounts: Account[] = [
  { id: 1, alias_real: "Ahorro", tipo: "metas", balance_actual: 1500, banco: "B" },
];

const investments: Investment[] = [
  { id: 1, nombre: "ETF", monto_invertido: 1000, valor_actual: 2500, tipo: "Inv", cartera: "MyInvestor", fecha_inicio: "2024-01-01" },
];

const goalCuenta: Goal = {
  id: 1,
  nombre: "Fondo emergencia",
  monto_objetivo: 3000,
  monto_actual: 0,
  account_id: 1,
};

const goalCartera: Goal = {
  id: 2,
  nombre: "Jubilación",
  monto_objetivo: 10000,
  monto_actual: 0,
  cartera_destino: "MyInvestor",
};

const goalPartidas: Goal = {
  id: 3,
  nombre: "Coche",
  monto_objetivo: 12000,
  monto_actual: 0,
};

const debt: Debt = {
  id: 1,
  acreedor: "Banco",
  monto_total: 12000,
  monto_pagado: 2500,
  monto_pagado_registrado: 2500,
  tipo: "Préstamo",
  goal_id: 3,
};

const entries: RecurringEntry[] = [
  {
    id: 10,
    nombre: "Ahorro cuenta",
    monto_estimado: 200,
    es_ingreso: false,
    es_fijo: true,
    tipo_partida: "ahorro_inversion",
    categoria: "Ahorro",
    cuenta_destino_id: 1,
    mes_inicio: 1,
    anio_inicio: 2026,
  },
  {
    id: 11,
    nombre: "Vacaciones",
    monto_estimado: 150,
    es_ingreso: false,
    es_fijo: true,
    tipo_partida: "gasto",
    categoria: "Ocio",
    es_puntual: true,
    goal_id: 4,
    mes_inicio: 8,
    anio_inicio: 2026,
  },
];

const goalViaEntry: Goal = { id: 4, nombre: "Viaje", monto_objetivo: 900, monto_actual: 0 };

describe("goalProgress", () => {
  it("resuelve objetivo por cuenta o cartera", () => {
    expect(findGoalForDestino([goalCuenta, goalCartera], 1)?.nombre).toBe("Fondo emergencia");
    expect(findGoalForDestino([goalCuenta, goalCartera], null, "MyInvestor")?.nombre).toBe("Jubilación");
  });

  it("resuelve objetivo por goal_id en partida", () => {
    const entry = entries[1];
    expect(findGoalForEntry([goalViaEntry], entry)?.nombre).toBe("Viaje");
  });

  it("usa saldo de cuenta o valor de cartera", () => {
    expect(goalCurrentAmount(goalCuenta, accounts, investments)).toBe(1500);
    expect(goalCurrentAmount(goalCartera, accounts, investments)).toBe(2500);
  });

  it("usa deudas y fondos vinculados para objetivos por partidas", () => {
    expect(goalLinkedDebts([debt], 3)).toHaveLength(1);
    expect(goalPartidasCurrentAmount(goalPartidas, entries, [], 7, 2026, { debts: [debt] })).toBe(2500);
  });

  it("suma aportaciones del presupuesto del mes", () => {
    const mbs: MonthlyBudget[] = [
      { id: 1, recurring_entry_id: 10, mes: 7, anio: 2026, monto_real: 250 },
    ];
    expect(goalMonthlyContribution(goalCuenta, entries, mbs, 7, 2026)).toBe(250);
    expect(goalMonthlyContribution(goalPartidas, entries, [], 7, 2026, { debts: [debt] })).toBe(0);
    expect(goalMonthlyContribution(goalPartidas, entries, [], 7, 2026, { debts: [{ ...debt, cuota_mensual: 220 }] })).toBe(220);
  });

  it("calcula ETA con aportación mensual", () => {
    const snap = buildGoalProgressSnapshot(goalCuenta, accounts, investments, entries, [], 7, 2026);
    expect(snap.remaining).toBe(1500);
    expect(snap.monthsRemaining).toBe(8);
    expect(snap.etaLabel).toMatch(/8 meses/);
  });
});
