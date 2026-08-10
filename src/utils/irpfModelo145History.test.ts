import { describe, expect, it } from "vitest";
import {
  irpfForJobMonths,
  parseIrpfModelo145Store,
  resolveIrpfVersion,
  upsertIrpfVersion,
  type IrpfModelo145Answers,
} from "./irpfModelo145History";

const answers: IrpfModelo145Answers = {
  annual_gross: 30000,
  age: 35,
  family_situation: "3",
  disability: "none",
  mobility_reduced: false,
  geographic_mobility: false,
  contract_type: "indefinido",
  pagas: 14,
  ss_pct: 6.5,
  dependents: [],
};

describe("irpfModelo145History job scoping", () => {
  it("no aplica un % global a otro empleo", () => {
    let store = parseIrpfModelo145Store(null);
    store = upsertIrpfVersion(store, {
      effective_from: "2026-01-01",
      job_id: 10,
      answers,
      irpf_pct: 20,
      ss_pct: 6.5,
    });
    expect(resolveIrpfVersion(store, "2026-06-01", 10)?.irpf_pct).toBe(20);
    expect(resolveIrpfVersion(store, "2026-06-01", 99)).toBeNull();
  });

  it("calcula cada empleo con su propio % o fallback", () => {
    let store = parseIrpfModelo145Store(null);
    store = upsertIrpfVersion(store, {
      effective_from: "2026-01-01",
      job_id: 1,
      answers,
      irpf_pct: 10,
      ss_pct: 6.5,
    });
    const a = irpfForJobMonths({
      store,
      jobId: 1,
      brutoMensual: 1000,
      irpfPctFallback: 5,
      ssPctFallback: 6.5,
      year: 2026,
      fechaInicio: "2026-01-01",
      fechaFin: "2026-03-31",
    });
    const b = irpfForJobMonths({
      store,
      jobId: 2,
      brutoMensual: 1000,
      irpfPctFallback: 15,
      ssPctFallback: 6.5,
      year: 2026,
      fechaInicio: "2026-01-01",
      fechaFin: "2026-03-31",
    });
    expect(a.meses).toBe(3);
    expect(a.irpfAnual).toBeCloseTo(300, 5); // 10%
    expect(b.irpfAnual).toBeCloseTo(450, 5); // fallback 15%
  });
});
