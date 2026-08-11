import { parseJsonValue } from "./format";

export const IRPF_MODELO145_SETTINGS_KEY = "irpf_modelo145";

export type IrpfDependentForm = {
  kind: "descendant" | "ascendant";
  age: number;
  disability: "none" | "33_64" | "65_plus";
  shared_custody: boolean;
  mobility_reduced: boolean;
};

export type IrpfModelo145Answers = {
  annual_gross: number;
  age: number;
  family_situation: "1" | "2" | "3";
  disability: "none" | "33_64" | "65_plus";
  mobility_reduced: boolean;
  geographic_mobility: boolean;
  contract_type: "indefinido" | "temporal" | "especial";
  pagas: number;
  ss_pct: number;
  dependents: IrpfDependentForm[];
};

export type IrpfModelo145Version = {
  id: string;
  /** Inclusive start date YYYY-MM-DD — applies until the next version for the same job */
  effective_from: string;
  created_at: string;
  /**
   * WorkHistory.id this rate belongs to.
   * null = personal defaults (solo para precargar el asistente; no se aplica a todos los empleos).
   */
  job_id: number | null;
  note?: string;
  answers: IrpfModelo145Answers;
  irpf_pct: number;
  ss_pct: number;
};

export type IrpfModelo145Store = {
  versions: IrpfModelo145Version[];
};

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseJobId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Parse settings JSON; migrates legacy flat Modelo 145 object into a one-entry history. */
export function parseIrpfModelo145Store(raw: string | null | undefined): IrpfModelo145Store {
  const parsed = parseJsonValue<Record<string, unknown>>(raw ?? null, {});
  if (Array.isArray(parsed.versions)) {
    const versions = (parsed.versions as unknown[])
      .filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object")
      .map((v) => normalizeVersion(v))
      .filter((v): v is IrpfModelo145Version => v != null)
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    return { versions };
  }

  // Legacy single snapshot → personal defaults (job_id null)
  if (parsed.family_situation || parsed.dependents || parsed.annual_gross) {
    const answers = legacyAnswers(parsed);
    return {
      versions: [
        {
          id: newId(),
          effective_from: isIsoDate(parsed.effective_from) ? parsed.effective_from : "2000-01-01",
          created_at: new Date().toISOString(),
          job_id: parseJobId(parsed.job_id),
          note: "Migrado desde versión única",
          answers,
          irpf_pct: Number(parsed.irpf_pct) || 0,
          ss_pct: Number(parsed.ss_pct) || answers.ss_pct || 6.5,
        },
      ],
    };
  }

  return { versions: [] };
}

function legacyAnswers(parsed: Record<string, unknown>): IrpfModelo145Answers {
  return {
    annual_gross: Number(parsed.annual_gross) || 0,
    age: Number(parsed.age) || 35,
    family_situation: (["1", "2", "3"].includes(String(parsed.family_situation))
      ? String(parsed.family_situation)
      : "3") as IrpfModelo145Answers["family_situation"],
    disability: (["none", "33_64", "65_plus"].includes(String(parsed.disability))
      ? String(parsed.disability)
      : "none") as IrpfModelo145Answers["disability"],
    mobility_reduced: Boolean(parsed.mobility_reduced),
    geographic_mobility: Boolean(parsed.geographic_mobility),
    contract_type: (["indefinido", "temporal", "especial"].includes(String(parsed.contract_type))
      ? String(parsed.contract_type)
      : "indefinido") as IrpfModelo145Answers["contract_type"],
    pagas: Number(parsed.pagas) === 12 ? 12 : 14,
    ss_pct: Number(parsed.ss_pct) || 6.5,
    dependents: Array.isArray(parsed.dependents) ? (parsed.dependents as IrpfModelo145Answers["dependents"]) : [],
  };
}

function normalizeVersion(raw: Record<string, unknown>): IrpfModelo145Version | null {
  if (!isIsoDate(raw.effective_from)) return null;
  const answersRaw = (raw.answers && typeof raw.answers === "object"
    ? (raw.answers as Record<string, unknown>)
    : raw);
  const answers = legacyAnswers(answersRaw);
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId(),
    effective_from: raw.effective_from,
    created_at: typeof raw.created_at === "string" ? raw.created_at : new Date().toISOString(),
    job_id: parseJobId(raw.job_id),
    note: typeof raw.note === "string" ? raw.note : undefined,
    answers,
    irpf_pct: Number(raw.irpf_pct) || 0,
    ss_pct: Number(raw.ss_pct) || answers.ss_pct || 6.5,
  };
}

export function versionsForJob(store: IrpfModelo145Store, jobId: number | null | undefined): IrpfModelo145Version[] {
  if (jobId == null) {
    return store.versions.filter((v) => v.job_id == null);
  }
  return store.versions.filter((v) => v.job_id === jobId);
}

/**
 * Resolve rate for a specific job on a date.
 * Prefer job-scoped versions; do not apply personal (job_id null) rates to another employer.
 */
export function resolveIrpfVersion(
  store: IrpfModelo145Store,
  dateIso: string,
  jobId?: number | null,
): IrpfModelo145Version | null {
  const scoped = jobId != null
    ? store.versions.filter((v) => v.job_id === jobId && v.effective_from <= dateIso)
    : store.versions.filter((v) => v.job_id == null && v.effective_from <= dateIso);
  if (scoped.length === 0) return null;
  return scoped[scoped.length - 1] ?? null;
}

/** Latest version for a job, else latest personal defaults (for wizard prefills). */
export function latestIrpfVersion(
  store: IrpfModelo145Store,
  jobId?: number | null,
): IrpfModelo145Version | null {
  const jobScoped = jobId != null ? versionsForJob(store, jobId) : [];
  if (jobScoped.length > 0) return jobScoped[jobScoped.length - 1] ?? null;
  const personal = versionsForJob(store, null);
  if (personal.length > 0) return personal[personal.length - 1] ?? null;
  if (jobId == null && store.versions.length > 0) {
    return store.versions[store.versions.length - 1] ?? null;
  }
  return null;
}

/**
 * Append or replace a version for the same effective_from + job_id.
 */
export function upsertIrpfVersion(
  store: IrpfModelo145Store,
  input: {
    effective_from: string;
    job_id?: number | null;
    answers: IrpfModelo145Answers;
    irpf_pct: number;
    ss_pct: number;
    note?: string;
  },
): IrpfModelo145Store {
  const jobId = input.job_id ?? null;
  const next: IrpfModelo145Version = {
    id: newId(),
    effective_from: input.effective_from,
    created_at: new Date().toISOString(),
    job_id: jobId,
    note: input.note,
    answers: input.answers,
    irpf_pct: input.irpf_pct,
    ss_pct: input.ss_pct,
  };
  const withoutSame = store.versions.filter(
    (v) => !(v.effective_from === input.effective_from && (v.job_id ?? null) === jobId),
  );
  return {
    versions: [...withoutSame, next].sort((a, b) => a.effective_from.localeCompare(b.effective_from)),
  };
}

export function removeIrpfVersion(store: IrpfModelo145Store, id: string): IrpfModelo145Store {
  return { versions: store.versions.filter((v) => v.id !== id) };
}

/** Sum IRPF across months of a job using that job's Modelo 145 history, else its stored %. */
export function irpfForJobMonths(opts: {
  store: IrpfModelo145Store;
  jobId?: number | null;
  brutoMensual: number;
  ssPctFallback: number;
  irpfPctFallback: number;
  year: number;
  fechaInicio: string;
  fechaFin?: string | null;
}): { meses: number; irpfAnual: number; ssAnual: number; brutoAnual: number; netoAnual: number } {
  const yearStart = new Date(opts.year, 0, 1);
  const yearEnd = new Date(opts.year, 11, 31, 23, 59, 59);
  const jobStart = new Date(opts.fechaInicio);
  const jobEnd = opts.fechaFin ? new Date(opts.fechaFin) : new Date();
  const overlapStart = new Date(Math.max(jobStart.getTime(), yearStart.getTime()));
  const overlapEnd = new Date(Math.min(jobEnd.getTime(), yearEnd.getTime()));
  if (overlapStart > overlapEnd) {
    return { meses: 0, irpfAnual: 0, ssAnual: 0, brutoAnual: 0, netoAnual: 0 };
  }

  let meses = 0;
  let irpfAnual = 0;
  let ssAnual = 0;
  const cursor = new Date(overlapStart.getFullYear(), overlapStart.getMonth(), 1);
  const endMonth = new Date(overlapEnd.getFullYear(), overlapEnd.getMonth(), 1);
  while (cursor <= endMonth) {
    const dayIso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-01`;
    const ver = resolveIrpfVersion(opts.store, dayIso, opts.jobId ?? null);
    const irpfPct = ver?.irpf_pct ?? opts.irpfPctFallback;
    const ssPct = ver?.ss_pct ?? opts.ssPctFallback;
    irpfAnual += opts.brutoMensual * irpfPct / 100;
    ssAnual += opts.brutoMensual * ssPct / 100;
    meses += 1;
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const brutoAnual = opts.brutoMensual * meses;
  return {
    meses,
    irpfAnual,
    ssAnual,
    brutoAnual,
    netoAnual: brutoAnual - irpfAnual - ssAnual,
  };
}
