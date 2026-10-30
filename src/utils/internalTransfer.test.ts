import { describe, expect, it } from "vitest";
import { isExcludedFromBudget, isOmittedFromBudget, isRealExpense, isRealIncome } from "./internalTransfer";

describe("omit from budget", () => {
  it("excludes omitted income from real income", () => {
    const income = {
      amount: 1200,
      es_interna: false,
      es_pending: false,
      category_anon: "Nómina",
      excluida_presupuesto: true,
    };
    expect(isOmittedFromBudget(income)).toBe(true);
    expect(isExcludedFromBudget(income)).toBe(true);
    expect(isRealIncome(income)).toBe(false);
    expect(isRealExpense(income)).toBe(false);
  });

  it("treats numeric/string omit flags as omitted", () => {
    expect(isOmittedFromBudget({ excluida_presupuesto: 1 as unknown as boolean })).toBe(true);
    expect(isOmittedFromBudget({ excluida_presupuesto: "true" as unknown as boolean })).toBe(true);
  });

  it("keeps normal income as real income", () => {
    const income = {
      amount: 1200,
      es_interna: false,
      es_pending: false,
      category_anon: "Nómina",
      excluida_presupuesto: false,
    };
    expect(isRealIncome(income)).toBe(true);
  });
});

describe("isRealIncome: solo lo ganado (2026-10-29)", () => {
  const tx = (amount: number, category_anon: string) => ({ amount, category_anon, es_interna: false, es_pending: false, excluida_presupuesto: false });
  it("nómina, freelance y «Otros ingresos» cuentan", () => {
    expect(isRealIncome(tx(1800, "Nómina"))).toBe(true);
    expect(isRealIncome(tx(300, "freelance"))).toBe(true);
    expect(isRealIncome(tx(20, "Otros ingresos"))).toBe(true);
  });
  it("Bizum, traspasos y devoluciones no cuentan solos", () => {
    expect(isRealIncome(tx(15, ""))).toBe(false);
    expect(isRealIncome(tx(15, "Transferencia recibida"))).toBe(false);
    expect(isRealIncome(tx(30, "Devolución"))).toBe(false);
  });
});
