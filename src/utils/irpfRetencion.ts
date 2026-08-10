/** AEAT-style IRPF withholding (Modelo 145 inputs) — mirror of backend/app/irpf_retencion.py */

export type FamilySituation = "1" | "2" | "3";
export type DisabilityDegree = "none" | "33_64" | "65_plus";
export type ContractType = "indefinido" | "temporal" | "especial";

export type IrpfDependent = {
  kind: "descendant" | "ascendant";
  age: number;
  disability: DisabilityDegree;
  shared_custody?: boolean;
  mobility_reduced?: boolean;
};

export type IrpfRetencionInput = {
  annual_gross: number;
  age: number;
  family_situation?: FamilySituation;
  disability?: DisabilityDegree;
  mobility_reduced?: boolean;
  geographic_mobility?: boolean;
  dependents?: IrpfDependent[];
  contract_type?: ContractType;
  pagas?: number;
  ss_pct?: number;
};

export type IrpfRetencionResult = {
  irpf_pct: number;
  ss_pct: number;
  neto_estimado: number;
  irpf_amount: number;
  ss_amount: number;
  annual_irpf: number;
  family_minimum: number;
  exclusion_limit: number;
  retention_base: number;
  disclaimer: string;
};

function truncate2(value: number): number {
  return Math.floor(value * 100 + 1e-9) / 100;
}

function annualRetentionQuota(base: number): number {
  const brackets: [number, number][] = [
    [12_450, 0.19],
    [20_200, 0.24],
    [35_200, 0.3],
    [60_000, 0.37],
    [300_000, 0.45],
    [Infinity, 0.47],
  ];
  let remaining = Math.max(base, 0);
  let prev = 0;
  let tax = 0;
  for (const [limit, rate] of brackets) {
    const width = Math.min(Math.max(limit - prev, 0), remaining);
    if (width <= 0) {
      prev = limit;
      continue;
    }
    tax += width * rate;
    remaining -= width;
    prev = limit;
    if (remaining <= 0) break;
  }
  return Math.max(tax, 0);
}

function art20(rendNeto: number): number {
  if (rendNeto <= 14_747.5) return 7_302;
  if (rendNeto <= 19_747.5) return Math.max(0, 7_302 - 1.14 * (rendNeto - 14_747.5));
  return 0;
}

function disabilityMin(degree: DisabilityDegree, mobility = false): number {
  if (degree === "65_plus" || mobility) return 9_000;
  if (degree === "33_64") return 3_000;
  return 0;
}

function personalMin(age: number, disability: DisabilityDegree, mobility = false): number {
  let base = 5_550;
  if (age >= 75) base += 1_150 + 1_400;
  else if (age >= 65) base += 1_150;
  return base + disabilityMin(disability, mobility);
}

function descendantsMin(deps: IrpfDependent[]): number {
  const kids = deps.filter((d) => d.kind === "descendant").sort((a, b) => a.age - b.age);
  const ordinal = [2_400, 2_700, 4_000];
  let total = 0;
  kids.forEach((kid, i) => {
    let amount = i < 3 ? ordinal[i]! : 4_500;
    if (kid.age < 3) amount += 2_800;
    amount += disabilityMin(kid.disability, kid.mobility_reduced);
    if (kid.shared_custody) amount *= 0.5;
    total += amount;
  });
  return total;
}

function ascendantsMin(deps: IrpfDependent[]): number {
  let total = 0;
  for (const dep of deps) {
    if (dep.kind !== "ascendant") continue;
    let amount = 1_150;
    if (dep.age >= 75) amount += 1_400;
    amount += disabilityMin(dep.disability, dep.mobility_reduced);
    total += amount;
  }
  return total;
}

function exclusionLimit(situation: FamilySituation, nDesc: number): number {
  const base = { "1": 17_197, "2": 17_197, "3": 15_876 }[situation];
  const extra = { "1": 2_800, "2": 2_100, "3": 1_800 }[situation];
  return base + Math.max(nDesc, 0) * extra;
}

export function calculateIrpfRetencion(input: IrpfRetencionInput): IrpfRetencionResult {
  const annualGross = Math.max(Number(input.annual_gross) || 0, 0);
  const pagas = Math.max(Number(input.pagas) || 14, 12);
  const age = Math.max(Number(input.age) || 0, 0);
  const situation = input.family_situation ?? "3";
  const disability = input.disability ?? "none";
  const mobility = Boolean(input.mobility_reduced);
  const geo = Boolean(input.geographic_mobility);
  const contract = input.contract_type ?? "indefinido";
  const dependents = input.dependents ?? [];
  const nDesc = dependents.filter((d) => d.kind === "descendant").length;

  let ssPct = input.ss_pct;
  if (ssPct == null) ssPct = contract === "temporal" ? 6.55 : 6.5;
  const ssRate = Math.max(ssPct, 0) / 100;
  const annualSs = annualGross * ssRate;
  const rendNeto = Math.max(annualGross - annualSs, 0);

  let otherExpenses = 2_000;
  if (disability !== "none" || mobility) {
    otherExpenses += disability === "65_plus" || mobility ? 3_500 : 2_000;
  }
  if (geo) otherExpenses += 2_000;

  const retentionBase = Math.max(rendNeto - otherExpenses - art20(rendNeto), 0);
  const spouseMin = situation === "2" ? 3_400 : 0;
  const familyMin =
    personalMin(age, disability, mobility) +
    descendantsMin(dependents) +
    ascendantsMin(dependents) +
    spouseMin;

  let raw = Math.max(annualRetentionQuota(retentionBase) - annualRetentionQuota(familyMin), 0);
  const excl = exclusionLimit(situation, nDesc);
  if (annualGross <= excl) raw = 0;
  else if (annualGross <= 35_200) {
    raw = Math.min(raw, Math.max(annualGross - 15_876, 0) * 0.43);
  }

  let irpfPct = annualGross > 0 && raw > 0 ? truncate2((raw / annualGross) * 100) : 0;
  if (contract === "temporal" && irpfPct > 0) irpfPct = Math.max(irpfPct, 2);
  if (contract === "especial") irpfPct = Math.max(irpfPct, 15);

  const brutoMensual = annualGross / pagas;
  const irpfAmount = brutoMensual * irpfPct / 100;
  const ssAmount = brutoMensual * ssRate;
  const neto = Math.max(brutoMensual - irpfAmount - ssAmount, 0);

  return {
    irpf_pct: irpfPct,
    ss_pct: Math.round(ssRate * 10000) / 100,
    neto_estimado: Math.round(neto * 100) / 100,
    irpf_amount: Math.round(irpfAmount * 100) / 100,
    ss_amount: Math.round(ssAmount * 100) / 100,
    annual_irpf: Math.round(annualGross * irpfPct) / 100,
    family_minimum: Math.round(familyMin * 100) / 100,
    exclusion_limit: Math.round(excl * 100) / 100,
    retention_base: Math.round(retentionBase * 100) / 100,
    disclaimer:
      "Estimación orientativa según algoritmo AEAT 2026 y datos tipo Modelo 145. No sustituye el Servicio de Cálculo de Retenciones oficial ni la nómina del pagador.",
  };
}
