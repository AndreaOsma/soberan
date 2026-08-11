import { describe, expect, it } from "vitest";
import {
  estimatedJobNeto,
  incomeRealAmount,
  isPayrollIncomeEntry,
  jobActiveInMonth,
  payrollBudgetRows,
} from "./budgetIncome";
import type { SalaryBreakdown, WorkHistory } from "../types";

describe("budgetIncome", () => {
  it("detecta partidas de nómina", () => {
    expect(isPayrollIncomeEntry({ categoria: "Nómina", nombre: "Foo" })).toBe(true);
    expect(isPayrollIncomeEntry({ categoria: "Freelance", nombre: "Cliente" })).toBe(false);
  });

  it("estima neto mensual desde bruto", () => {
    expect(estimatedJobNeto({
      salario_bruto: 3000,
      periodicidad: "M",
      irpf_pct: 15,
      ss_pct: 6.35,
    })).toBe(2359.5);
  });

  it("payroll rows priorizan nómina real del mes actual", () => {
    const breakdown: SalaryBreakdown[] = [{
      id: 1, mes: 7, anio: 2026, empresa: "Acme", bruto: 3000, irpf: 450, ss: 190.5, neto: 2359.5,
    }];
    const work: WorkHistory[] = [{
      id: 1,
      empresa: "Acme",
      grupo_cotizacion: "1",
      fecha_inicio: "2024-01-01",
      fecha_fin: null,
      salario_bruto: 2000,
      periodicidad: "M",
      irpf_pct: 10,
      ss_pct: 6.35,
      dias_alta: 365,
    }];
    const rows = payrollBudgetRows(work, breakdown, [], 7, 2026);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.expected).toBe(2359.5);
    expect(rows[0]!.fromBreakdown).toBe(true);
  });

  it("usa nómina del mes anterior como expected y real automático cuando no hay breakdown del mes actual", () => {
    const work: WorkHistory[] = [{
      id: 1,
      empresa: "Acme",
      grupo_cotizacion: "1",
      fecha_inicio: "2024-01-01",
      fecha_fin: null,
      salario_bruto: 3000,
      periodicidad: "M",
      irpf_pct: 15,
      ss_pct: 6.35,
      dias_alta: 365,
    }];
    // Solo existe breakdown de junio, no de julio
    const breakdown: SalaryBreakdown[] = [{
      id: 2, mes: 6, anio: 2026, empresa: "Acme", bruto: 3000, irpf: 450, ss: 190.5, neto: 2107.86,
    }];
    const rows = payrollBudgetRows(work, breakdown, [], 7, 2026);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.expected).toBe(2107.86);
    expect(rows[0]!.fromBreakdown).toBe(false);
    expect(rows[0]!.prevBreakdownNeto).toBe(2107.86);
  });

  it("incomeRealAmount prefiere monto_real guardado, luego prevBreakdownNeto, luego expected", () => {
    expect(incomeRealAmount(2000, 1, { 1: 2107.86 })).toBe(2107.86);
    expect(incomeRealAmount(2000, 1, {}, 2107.86)).toBe(2107.86);
    expect(incomeRealAmount(2000, null, {}, null)).toBe(2000);
  });

  it("jobActiveInMonth respeta fechas", () => {
    const job: WorkHistory = {
      id: 1,
      empresa: "Acme",
      grupo_cotizacion: "1",
      fecha_inicio: "2026-08-01",
      fecha_fin: null,
      salario_bruto: 2000,
      periodicidad: "M",
      irpf_pct: 10,
      ss_pct: 6.35,
      dias_alta: 30,
    };
    expect(jobActiveInMonth(job, 7, 2026)).toBe(false);
    expect(jobActiveInMonth(job, 8, 2026)).toBe(true);
  });
});
