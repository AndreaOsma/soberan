import { describe, expect, it } from "vitest";
import { split503020 } from "./budgetTemplate";

describe("split503020", () => {
  it("reparte 50/30/20 sobre ingreso neto", () => {
    expect(split503020(3000)).toEqual({
      necesidades: 1500,
      deseos: 900,
      ahorro: 600,
    });
  });

  it("no devuelve negativos con ingreso cero", () => {
    expect(split503020(0)).toEqual({ necesidades: 0, deseos: 0, ahorro: 0 });
    expect(split503020(-100)).toEqual({ necesidades: 0, deseos: 0, ahorro: 0 });
  });
});
