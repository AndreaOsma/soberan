import { describe, expect, it } from "vitest";
import { monthlyRecurringTotals, monthlySavingsAmount } from "./budgetTipo";

describe("monthlyRecurringTotals", () => {
  it("excluye ahorro/inversión del consumo y lo refleja en el ahorro disponible", () => {
    const totals = monthlyRecurringTotals([
      { es_ingreso: true, tipo_partida: "gasto", bloque: null, monto_estimado: 3000 },
      { es_ingreso: false, tipo_partida: "gasto", bloque: "necesidades", monto_estimado: 2000 },
      { es_ingreso: false, tipo_partida: "ahorro_inversion", bloque: null, monto_estimado: 625 },
    ]);

    expect(totals.monthlyIncome).toBe(3000);
    expect(totals.monthlyConsumption).toBe(2000);
    expect(totals.monthlyAhorroInversion).toBe(625);

    const monthlySavings = totals.monthlyIncome - totals.monthlyConsumption;
    expect(monthlySavings).toBe(1000);
    expect(monthlySavings / totals.monthlyIncome).toBeCloseTo(0.333, 2);
  });

  it("sin partidas de ahorro, consumo incluye todo lo no ingreso", () => {
    const totals = monthlyRecurringTotals([
      { es_ingreso: true, tipo_partida: "gasto", bloque: null, monto_estimado: 2500 },
      { es_ingreso: false, tipo_partida: "gasto", bloque: "deseos", monto_estimado: 1800 },
      { es_ingreso: false, tipo_partida: "suscripcion", bloque: null, monto_estimado: 120 },
    ]);

    expect(totals.monthlyConsumption).toBe(1920);
    expect(totals.monthlyAhorroInversion).toBe(0);
  });

  it("cuenta partidas con cartera_destino como ahorro/inversión", () => {
    const totals = monthlyRecurringTotals([
      { es_ingreso: false, tipo_partida: "gasto", bloque: null, monto_estimado: 400, cartera_destino: "ETF World" },
      { es_ingreso: false, tipo_partida: "inversion", bloque: null, monto_estimado: 225, cartera_destino: null },
    ]);

    expect(totals.monthlyConsumption).toBe(0);
    expect(totals.monthlyAhorroInversion).toBe(625);
  });
});

describe("monthlySavingsAmount", () => {
  it("usa ahorro planificado cuando el surplus es negativo", () => {
    expect(monthlySavingsAmount(2500, 2600, 0, 625)).toBe(625);
  });

  it("suma slack extra cuando hay más margen que el ahorro planificado", () => {
    expect(monthlySavingsAmount(3000, 2000, 0, 625)).toBe(1000);
  });

  it("sin partidas de ahorro devuelve el surplus tal cual", () => {
    expect(monthlySavingsAmount(2500, 2600, 0, 0)).toBe(-100);
  });
});
