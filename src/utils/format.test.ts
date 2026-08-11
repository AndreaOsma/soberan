import { describe, expect, it } from "vitest";
import { toDateOnly, transactionInCalendarMonth } from "./format";

describe("toDateOnly", () => {
  it("extrae YYYY-MM-DD de datetimes ISO (Safari type=date)", () => {
    expect(toDateOnly("2026-07-29T00:00:00")).toBe("2026-07-29");
    expect(toDateOnly("2026-07-29T12:34:56.000Z")).toBe("2026-07-29");
    expect(toDateOnly("2026-07-29")).toBe("2026-07-29");
  });

  it("devuelve vacío si no hay fecha válida", () => {
    expect(toDateOnly("")).toBe("");
    expect(toDateOnly(null)).toBe("");
    expect(toDateOnly("29/07/2026")).toBe("");
    expect(toDateOnly("not-a-date")).toBe("");
  });
});

describe("transactionInCalendarMonth", () => {
  it("clasifica por prefijo YYYY-MM sin depender de zona horaria", () => {
    expect(transactionInCalendarMonth("2026-07-01", 7, 2026)).toBe(true);
    expect(transactionInCalendarMonth("2026-07-31T00:00:00.000Z", 7, 2026)).toBe(true);
    expect(transactionInCalendarMonth("2026-06-30", 7, 2026)).toBe(false);
    expect(transactionInCalendarMonth("2026-07-15", 6, 2026)).toBe(false);
  });
});
