import { describe, expect, it } from "vitest";
import {
  findIncomeTxByDescription,
  incomeTxDateIso,
  otherIncomeTxDescription,
  payrollIncomeTxDescription,
  resolveIncomeAccountId,
} from "./incomeTransaction";
import type { Account, Transaction } from "../types";

const accounts: Account[] = [
  { id: 1, alias_real: "Nómina", tipo: "gasto", balance_actual: 100, banco: "ING" },
  { id: 2, alias_real: "Ahorro", tipo: "ahorro", balance_actual: 500, banco: "MyInvestor" },
];

describe("payrollIncomeTxDescription", () => {
  it("usa el formato del backend", () => {
    expect(payrollIncomeTxDescription("knowmad mood", 7, 2026)).toBe("Nómina knowmad mood 7/2026");
  });
});

describe("otherIncomeTxDescription", () => {
  it("etiqueta ingresos no nómina", () => {
    expect(otherIncomeTxDescription("Alquiler", 3, 2026)).toBe("Ingreso Alquiler 3/2026");
  });
});

describe("resolveIncomeAccountId", () => {
  it("prioriza cuenta preferida", () => {
    expect(resolveIncomeAccountId(accounts, { preferredAccountId: 2 })).toBe(2);
  });

  it("usa payroll_company_config por empresa", () => {
    expect(resolveIncomeAccountId(accounts, {
      empresa: "Knowmad Mood",
      payrollConfig: { "knowmad mood": { account_id: 2 } },
    })).toBe(2);
  });

  it("cae a la primera cuenta", () => {
    expect(resolveIncomeAccountId(accounts, { empresa: "otra" })).toBe(1);
  });

  it("devuelve null sin cuentas", () => {
    expect(resolveIncomeAccountId([])).toBeNull();
  });
});

describe("incomeTxDateIso", () => {
  it("default día 1", () => {
    expect(incomeTxDateIso(2026, 7)).toBe("2026-07-01");
  });

  it("penúltimo día del mes", () => {
    expect(incomeTxDateIso(2026, 2, { incomeMode: "penultimate" })).toBe("2026-02-27");
  });
});

describe("findIncomeTxByDescription", () => {
  it("encuentra ingreso positivo por descripción", () => {
    const txs: Transaction[] = [
      { id: 1, account_id: 1, amount: -10, category_anon: "Gasto", description_raw: "Nómina x 7/2026", date: "2026-07-01" },
      { id: 2, account_id: 1, amount: 2000, category_anon: "Nómina", description_raw: "Nómina x 7/2026", date: "2026-07-01" },
    ];
    expect(findIncomeTxByDescription(txs, "Nómina x 7/2026")?.id).toBe(2);
  });
});
