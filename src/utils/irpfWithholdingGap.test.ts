import { describe, expect, it } from "vitest";
import type { IrpfModelo145Store } from "./irpfModelo145History";
import {
  calcIrpfWithholdingGap,
  matchJobForBreakdown,
  shouldAlertWithholdingGap,
} from "./irpfWithholdingGap";

const store: IrpfModelo145Store = {
  versions: [
    {
      id: "v1",
      effective_from: "2026-01-01",
      created_at: "2026-01-01T00:00:00Z",
      job_id: 1,
      answers: {
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
      },
      irpf_pct: 16.42,
      ss_pct: 6.5,
    },
  ],
};

const job = {
  id: 1,
  empresa: "Knowmad Mood",
  fecha_inicio: "2025-01-01",
  fecha_fin: null,
  irpf_pct: 16.42,
  ss_pct: 6.5,
};

describe("calcIrpfWithholdingGap", () => {
  it("detecta retención por debajo (a pagar)", () => {
    const gap = calcIrpfWithholdingGap({
      year: 2026,
      store,
      workHistory: [job],
      breakdowns: [
        { mes: 1, anio: 2026, empresa: "Knowmad Mood", bruto: 2500, irpf: 250, ss: 160, neto: 2090 },
        { mes: 2, anio: 2026, empresa: "Knowmad Mood", bruto: 2500, irpf: 250, ss: 160, neto: 2090 },
      ],
    });
    // expected ~16.42% of 5000 = 821; real 500 → under by ~321
    expect(gap.hasExpectedRate).toBe(true);
    expect(gap.outcomeHint).toBe("pay_likely");
    expect(gap.gapReten).toBeLessThan(0);
    expect(shouldAlertWithholdingGap(gap)).toBe(true);
  });

  it("detecta retención por encima (devolución)", () => {
    const gap = calcIrpfWithholdingGap({
      year: 2026,
      store,
      workHistory: [job],
      breakdowns: [
        { mes: 1, anio: 2026, empresa: "knowmad mood", bruto: 2500, irpf: 550, ss: 160, neto: 1790 },
        { mes: 2, anio: 2026, empresa: "knowmad mood", bruto: 2500, irpf: 550, ss: 160, neto: 1790 },
      ],
    });
    expect(gap.outcomeHint).toBe("refund_likely");
    expect(gap.gapReten).toBeGreaterThan(0);
  });

  it("no alerta con una sola nómina", () => {
    const gap = calcIrpfWithholdingGap({
      year: 2026,
      store,
      workHistory: [job],
      breakdowns: [
        { mes: 1, anio: 2026, empresa: "Knowmad Mood", bruto: 2500, irpf: 100, ss: 160, neto: 2240 },
      ],
    });
    expect(gap.outcomeHint).toBe("pay_likely");
    expect(shouldAlertWithholdingGap(gap)).toBe(false);
  });

  it("sin % esperado → insufficient_data", () => {
    const gap = calcIrpfWithholdingGap({
      year: 2026,
      store: { versions: [] },
      workHistory: [{ ...job, irpf_pct: 0 }],
      breakdowns: [
        { mes: 1, anio: 2026, empresa: "Knowmad Mood", bruto: 2500, irpf: 400, ss: 160, neto: 1940 },
        { mes: 2, anio: 2026, empresa: "Knowmad Mood", bruto: 2500, irpf: 400, ss: 160, neto: 1940 },
      ],
    });
    expect(gap.hasExpectedRate).toBe(false);
    expect(gap.outcomeHint).toBe("insufficient_data");
  });
});

describe("matchJobForBreakdown", () => {
  it("hace match case-insensitive", () => {
    const m = matchJobForBreakdown([job], "KNOWMAD MOOD", 2026, 3);
    expect(m?.empresa).toBe("Knowmad Mood");
  });
});
