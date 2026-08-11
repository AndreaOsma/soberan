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
