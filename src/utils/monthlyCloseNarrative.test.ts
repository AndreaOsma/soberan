import { describe, expect, it } from "vitest";
import { buildMonthlyCloseNarrative } from "./monthlyCloseNarrative";

const formatEUR = (v: number) => `${v.toFixed(2)} €`;

describe("buildMonthlyCloseNarrative", () => {
  it("mes bueno: aciertos de tasa, categorías y patrimonio", () => {
    const n = buildMonthlyCloseNarrative({
      realIncome: 3000,
      realExpense: 1800,
      realSavings: 1200,
      savingsRate: 40,
      targetSavingsPct: 20,
      uncategorized: 0,
      deviations: [
        { cat: "Comida", spent: 200, planned: 250, delta: -50 },
        { cat: "Ocio", spent: 80, planned: 100, delta: -20 },
      ],
      prevNetWorth: 10000,
      netWorth: 11200,
      recurringMatched: 3,
      recurringTotal: 3,
      formatEUR,
    });
    expect(n.wins).toHaveLength(3);
    expect(n.wins.some((w) => w.includes("40.0%"))).toBe(true);
    expect(n.wins.some((w) => w.includes("categorizados"))).toBe(true);
    expect(n.misses.some((m) => m.includes("Sin desviación") || m.includes("no hay más"))).toBe(true);
    expect(n.decisions).toHaveLength(3);
    expect(n.decisions.some((d) => d.action === "copy_budget")).toBe(true);
  });

  it("mes malo: sobre-gasto, sin categorizar y tasa baja", () => {
    const n = buildMonthlyCloseNarrative({
      realIncome: 2000,
      realExpense: 2200,
      realSavings: -200,
      savingsRate: 5,
      targetSavingsPct: 20,
      uncategorized: 4,
      deviations: [
        { cat: "Restaurantes", spent: 400, planned: 150, delta: 250 },
        { cat: "Compras", spent: 300, planned: 100, delta: 200 },
      ],
      prevNetWorth: 12000,
      netWorth: 11500,
      recurringMatched: 1,
      recurringTotal: 3,
      formatEUR,
    });
    expect(n.wins).toHaveLength(3);
    expect(n.misses[0]).toContain("Restaurantes");
    expect(n.misses.some((m) => m.includes("sin categorizar"))).toBe(true);
    expect(n.decisions.some((d) => d.action === "Presupuesto" && d.text.includes("Restaurantes"))).toBe(true);
    expect(n.decisions.some((d) => d.action === "Transacciones")).toBe(true);
    expect(n.decisions).toHaveLength(3);
  });

  it("sin snapshot previo no exige patrimonio en wins", () => {
    const n = buildMonthlyCloseNarrative({
      realIncome: 1000,
      realExpense: 500,
      realSavings: 500,
      savingsRate: 50,
      targetSavingsPct: 20,
      uncategorized: 0,
      deviations: [],
      prevNetWorth: null,
      netWorth: 5000,
      recurringMatched: 0,
      recurringTotal: 0,
      formatEUR,
    });
    expect(n.wins.some((w) => w.includes("Patrimonio"))).toBe(false);
    expect(n.wins.some((w) => w.includes("50.0%"))).toBe(true);
    expect(n.decisions).toHaveLength(3);
  });
});
