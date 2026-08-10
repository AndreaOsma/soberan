import { describe, expect, it } from "vitest";
import { budgetExpenseAmount, equalSplitDraft, unsettledOwedByPerson } from "./expenseSplits";
import type { Transaction } from "../types";

describe("expenseSplits", () => {
  it("uses my share for budget amount", () => {
    const tx = {
      amount: -90,
      es_interna: false,
      es_pending: false,
      category_anon: "Ocio",
      splits: [
        { person_name: "Yo", amount: 30, is_me: true, settled: false },
        { person_name: "María", amount: 60, is_me: false, settled: false },
      ],
    };
    expect(budgetExpenseAmount(tx)).toBe(30);
  });

  it("falls back to full abs without splits", () => {
    expect(budgetExpenseAmount({ amount: -40, category_anon: "Ocio" })).toBe(40);
  });

  it("aggregates unsettled owed", () => {
    const txs = [
      {
        id: 1,
        amount: -90,
        category_anon: "Ocio",
        description_raw: "a",
        date: "2026-07-01",
        splits: [
          { person_name: "Yo", amount: 30, is_me: true, settled: false },
          { person_name: "María", amount: 40, is_me: false, settled: false },
          { person_name: "Juan", amount: 20, is_me: false, settled: true },
        ],
      },
    ] as Transaction[];
    expect(unsettledOwedByPerson(txs)).toEqual([{ person_name: "María", amount: 40 }]);
  });

  it("equal split covers total", () => {
    const rows = equalSplitDraft(100, ["A", "B"]);
    expect(rows).toHaveLength(3);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBeCloseTo(100, 2);
    expect(rows.filter((r) => r.is_me)).toHaveLength(1);
  });
});
