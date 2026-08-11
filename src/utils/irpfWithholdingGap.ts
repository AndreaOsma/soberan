import { resolveIrpfVersion, type IrpfModelo145Store } from "./irpfModelo145History";

export type WithholdingBreakdownRow = {
  mes: number;
  anio: number;
  bruto: number;
  irpf: number;
  ss: number;
  neto: number;
  empresa: string;
};

export type WithholdingJob = {
  id?: number;
  empresa: string;
  fecha_inicio: string;
  fecha_fin?: string | null;
  irpf_pct?: number | null;
  ss_pct?: number | null;
};

export type WithholdingGapResult = {
  monthsCompared: number;
  brutoTotal: number;
  irpfReal: number;
  irpfExpected: number;
  /** real − expected; >0 = empresa retiene de más */
  gapReten: number;
  pctReal: number;
  pctExpected: number;
  netoReal: number;
  netoExpected: number;
  /** real − expected; >0 = cobras más neto del que tocaría (IRPF bajo) */
  gapNeto: number;
  hasExpectedRate: boolean;
  outcomeHint: "refund_likely" | "pay_likely" | "aligned" | "insufficient_data";
  severity: "none" | "media" | "alta";
  summary: string;
};

function normalizeEmpresa(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function jobCoversMonth(job: WithholdingJob, year: number, month: number): boolean {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month - 1, 28, 23, 59, 59);
  const start = new Date(job.fecha_inicio);
  const end = job.fecha_fin ? new Date(job.fecha_fin) : new Date(9999, 11, 31);
  return start <= monthEnd && end >= monthStart;
}

/** Pick the WorkHistory row that best matches a nómina empresa for that month. */
export function matchJobForBreakdown(
  jobs: WithholdingJob[],
  empresa: string,
  year: number,
  month: number,
): WithholdingJob | null {
  const covered = jobs.filter((j) => jobCoversMonth(j, year, month));
  if (covered.length === 0) return null;
  const target = normalizeEmpresa(empresa);
  if (target) {
    const exact = covered.find((j) => normalizeEmpresa(j.empresa) === target);
    if (exact) return exact;
    const partial = covered.find((j) => {
      const n = normalizeEmpresa(j.empresa);
      return n.includes(target) || target.includes(n);
    });
    if (partial) return partial;
  }
  // Single employer that month → use it
  if (covered.length === 1) return covered[0] ?? null;
  return null;
}

export function expectedIrpfPctForMonth(opts: {
  store: IrpfModelo145Store;
  job: WithholdingJob | null;
  year: number;
  month: number;
}): number | null {
  const dayIso = `${opts.year}-${String(opts.month).padStart(2, "0")}-01`;
  const ver = resolveIrpfVersion(opts.store, dayIso, opts.job?.id ?? null);
  if (ver && Number(ver.irpf_pct) > 0) return Number(ver.irpf_pct);
  const fallback = Number(opts.job?.irpf_pct);
  if (Number.isFinite(fallback) && fallback > 0) return fallback;
  return null;
}

function gapThreshold(brutoTotal: number): number {
  return Math.max(50, brutoTotal * 0.015);
}

/**
 * Compare IRPF retenido en nóminas reales vs % esperado (Modelo 145 / empleo).
 * Solo meses con breakdown; no anualiza meses futuros.
 */
export function calcIrpfWithholdingGap(opts: {
  year: number;
  breakdowns: WithholdingBreakdownRow[];
  workHistory: WithholdingJob[];
  store: IrpfModelo145Store;
}): WithholdingGapResult {
  const empty: WithholdingGapResult = {
    monthsCompared: 0,
    brutoTotal: 0,
    irpfReal: 0,
    irpfExpected: 0,
    gapReten: 0,
    pctReal: 0,
    pctExpected: 0,
    netoReal: 0,
    netoExpected: 0,
    gapNeto: 0,
    hasExpectedRate: false,
    outcomeHint: "insufficient_data",
    severity: "none",
    summary: "Registra nóminas reales y un % IRPF esperado (Modelo 145 o empleo) para comparar la retención de la empresa.",
  };

  const rows = opts.breakdowns.filter((r) => r.anio === opts.year && Number(r.bruto) > 0);
  if (rows.length === 0) return empty;

  let brutoTotal = 0;
  let irpfReal = 0;
  let irpfExpected = 0;
  let netoReal = 0;
  let ssReal = 0;
  let monthsWithRate = 0;
  let rateWeighted = 0;

  for (const row of rows) {
    const job = matchJobForBreakdown(opts.workHistory, row.empresa, row.anio, row.mes);
    const pct = expectedIrpfPctForMonth({
      store: opts.store,
      job,
      year: row.anio,
      month: row.mes,
    });
    brutoTotal += Number(row.bruto) || 0;
    irpfReal += Number(row.irpf) || 0;
    netoReal += Number(row.neto) || 0;
    ssReal += Number(row.ss) || 0;
    if (pct == null || !Number.isFinite(pct)) continue;
    monthsWithRate += 1;
    rateWeighted += pct * (Number(row.bruto) || 0);
    irpfExpected += (Number(row.bruto) || 0) * pct / 100;
  }

  if (monthsWithRate === 0 || brutoTotal <= 0) {
    return {
      ...empty,
      monthsCompared: rows.length,
      brutoTotal,
      irpfReal,
      netoReal,
      summary: "Hay nóminas reales, pero falta un % IRPF esperado (Autocalcular Modelo 145 o editar el empleo).",
    };
  }

  const gapReten = irpfReal - irpfExpected;
  const pctReal = (irpfReal / brutoTotal) * 100;
  const pctExpected = rateWeighted / brutoTotal;
  const netoExpected = brutoTotal - irpfExpected - ssReal;
  const gapNeto = netoReal - netoExpected;
  const threshold = gapThreshold(brutoTotal);
  const absGap = Math.abs(gapReten);

  let outcomeHint: WithholdingGapResult["outcomeHint"] = "aligned";
  let severity: WithholdingGapResult["severity"] = "none";
  if (absGap >= threshold) {
    if (gapReten > 0) {
      outcomeHint = "refund_likely";
      severity = absGap >= threshold * 2 ? "alta" : "media";
    } else {
      outcomeHint = "pay_likely";
      severity = absGap >= threshold * 2 ? "alta" : "media";
    }
  }

  const summary = (() => {
    const pctBit = `Empresa ~${pctReal.toFixed(1)}% vs esperado ~${pctExpected.toFixed(1)}%`;
    if (outcomeHint === "aligned") {
      return `${pctBit}. Retención alineada (±${threshold.toFixed(0)}€) sobre ${monthsWithRate} nómina${monthsWithRate === 1 ? "" : "s"}.`;
    }
    if (outcomeHint === "refund_likely") {
      return `${pctBit}. La empresa retiene ~${absGap.toFixed(0)}€ de más → más probable devolución en la renta.`;
    }
    return `${pctBit}. La empresa retiene ~${absGap.toFixed(0)}€ de menos → más probable pagar en la renta.`;
  })();

  return {
    monthsCompared: monthsWithRate,
    brutoTotal,
    irpfReal,
    irpfExpected,
    gapReten,
    pctReal,
    pctExpected,
    netoReal,
    netoExpected,
    gapNeto,
    hasExpectedRate: true,
    outcomeHint,
    severity,
    summary,
  };
}

export function shouldAlertWithholdingGap(gap: WithholdingGapResult): boolean {
  return gap.hasExpectedRate
    && gap.monthsCompared >= 2
    && gap.outcomeHint !== "aligned"
    && gap.outcomeHint !== "insufficient_data";
}
