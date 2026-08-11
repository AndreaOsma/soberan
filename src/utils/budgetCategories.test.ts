import { describe, expect, it } from "vitest";
import { budgetCategories, transactionCategoryOptions } from "./budgetCategories";
import { categoryOptionsForAmount, normalizeCategory, SUBSCRIPTION_CATEGORY } from "./expenseCategories";
import type { RecurringEntry, Transaction } from "../types";

const entry = (overrides: Partial<RecurringEntry>): RecurringEntry => ({
  id: 1,
  nombre: "Test",
  categoria: "Hogar",
  monto_estimado: 100,
  es_ingreso: false,
  es_fijo: true,
  tipo_partida: "gasto",
  bloque: "necesidades",
  ...overrides,
});

describe("normalizeCategory", () => {
  it("mapea aliases legacy", () => {
    expect(normalizeCategory("Suscripciones y facturas")).toBe(SUBSCRIPTION_CATEGORY);
    expect(normalizeCategory("Vivienda")).toBe("Hogar");
    expect(normalizeCategory("General")).toBe("");
    expect(normalizeCategory("otros")).toBe("Otros gastos");
  });
});

describe("categoryOptionsForAmount", () => {
  it("gastos no incluyen Nómina", () => {
    const opts = categoryOptionsForAmount(-20);
    expect(opts).toContain("Alimentación");
    expect(opts).not.toContain("Nómina");
  });

  it("ingresos no incluyen Alimentación", () => {
    const opts = categoryOptionsForAmount(100);
    expect(opts).toContain("Nómina");
    expect(opts).not.toContain("Alimentación");
  });
});

describe("budgetCategories", () => {
  it("recoge categorías del presupuesto sin duplicados", () => {
    const cats = budgetCategories([
      entry({ id: 1, categoria: "Hogar" }),
      entry({ id: 2, categoria: "Ocio", nombre: "Ocio" }),
      entry({ id: 3, categoria: "Hogar", nombre: "Luz" }),
    ]);
    expect(cats).toEqual(["Hogar", "Ocio"]);
  });

  it("suscripciones usan categoría canónica Suscripciones", () => {
    const cats = budgetCategories([
      entry({ id: 1, tipo_partida: "suscripcion", categoria: "Streaming" }),
    ]);
    expect(cats).toContain(SUBSCRIPTION_CATEGORY);
    expect(cats).not.toContain("Suscripciones y facturas");
  });
});

describe("transactionCategoryOptions", () => {
  it("para gasto no incluye Nómina aunque haya partidas de ingreso", () => {
    const opts = transactionCategoryOptions(
      [entry({ id: 1, es_ingreso: true, categoria: "Nómina" }), entry({ id: 2, categoria: "Ocio" })],
      [],
      -15,
    );
    expect(opts).toContain("Ocio");
    expect(opts).not.toContain("Nómina");
  });

  it("incluye categoría legacy del movimiento actual", () => {
    const txs: Transaction[] = [{
      id: 1,
      amount: -5,
      category_anon: "LegacyCat",
      description_raw: "x",
      date: "2026-07-01",
    }];
    const opts = transactionCategoryOptions([], txs, -5);
    expect(opts).toContain("LegacyCat");
    expect(opts).toContain("Alimentación");
  });
});
