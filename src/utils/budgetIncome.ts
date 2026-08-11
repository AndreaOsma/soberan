import type { RecurringEntry, SalaryBreakdown, WorkHistory } from "../types";

/** Prestación/desempleo/SEPE — no es nómina de empresa, aunque el nombre diga «Nómina …». */
export function isPrestacionIncomeEntry(
  entry: Pick<RecurringEntry, "categoria"> & Partial<Pick<RecurringEntry, "nombre" | "empresa">>,
): boolean {
  const hay = `${entry.categoria || ""} ${entry.nombre || ""} ${entry.empresa || ""}`
    .trim()
    .toLowerCase();
  if (!hay) return false;
  if (hay.includes("prestaci") || hay.includes("desempleo")) return true;
  return /(^|[^a-z])sepe([^a-z]|$)/.test(hay);
}

export function isPayrollIncomeEntry(
  entry: Pick<RecurringEntry, "categoria" | "nombre" | "empresa">,
): boolean {
  if (isPrestacionIncomeEntry(entry)) return false;
  const cat = (entry.categoria || "").trim().toLowerCase();
  const name = (entry.nombre || "").trim().toLowerCase();
  return cat === "nómina" || cat === "nomina" || name.startsWith("nómina ") || name.startsWith("nomina ");
}

export function normCompanyKey(name: string): string {
  return name.trim().toLowerCase();
}

export function findPayrollEntry(
  entries: RecurringEntry[],
  empresa: string,
): RecurringEntry | undefined {
  const key = normCompanyKey(empresa);
  return entries.find((e) => {
    if (!e.es_ingreso || !isPayrollIncomeEntry(e)) return false;
    if (e.empresa && normCompanyKey(e.empresa) === key) return true;
    return normCompanyKey(e.nombre) === normCompanyKey(`Nómina ${empresa}`);
  });
}

export function estimatedJobNeto(job: Pick<WorkHistory, "salario_bruto" | "periodicidad" | "irpf_pct" | "ss_pct">): number {
  const bruto = job.periodicidad === "A" ? (job.salario_bruto ?? 0) / 12 : (job.salario_bruto ?? 0);
  const irpf = bruto * (Number(job.irpf_pct) || 0) / 100;
  const ss = bruto * (Number(job.ss_pct) || 6.35) / 100;
  return Math.round((bruto - irpf - ss) * 100) / 100;
}

export function jobActiveInMonth(job: WorkHistory, month: number, year: number): boolean {
  if (!job.salario_bruto || Number(job.salario_bruto) <= 0) return false;
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59);
  const start = new Date(job.fecha_inicio);
  const end = job.fecha_fin ? new Date(job.fecha_fin) : null;
  if (start > monthEnd) return false;
  if (end && end < monthStart) return false;
  return true;
}

export type PayrollBudgetRow = {
  key: string;
  empresa: string;
  /** Importe esperado (del breakdown del mes actual si existe, si no del mes anterior, si no estimado desde WorkHistory) */
  expected: number;
  recurringEntryId: number | null;
  /** true si el expected viene de un SalaryBreakdown del mes actual */
  fromBreakdown: boolean;
  /** Neto real de la nómina del mes anterior — se usa como sugerencia automática del "real" cuando no hay override manual */
  prevBreakdownNeto: number | null;
};

function prevMonthYear(month: number, year: number): { pm: number; py: number } {
  return month === 1 ? { pm: 12, py: year - 1 } : { pm: month - 1, py: year };
}

export function payrollBudgetRows(
  workHistory: WorkHistory[],
  salaryBreakdowns: SalaryBreakdown[],
  recurringEntries: RecurringEntry[],
  month: number,
  year: number,
): PayrollBudgetRow[] {
  const { pm, py } = prevMonthYear(month, year);

  const breakdownForMonth = salaryBreakdowns.filter((s) => s.mes === month && s.anio === year);
  const breakdownPrevMonth = salaryBreakdowns.filter((s) => s.mes === pm && s.anio === py);

  const prevNetoByCompany = new Map<string, number>(
    breakdownPrevMonth.map((b) => [normCompanyKey(b.empresa), b.neto]),
  );

  if (breakdownForMonth.length > 0) {
    return breakdownForMonth.map((b) => ({
      key: `payroll-${normCompanyKey(b.empresa)}`,
      empresa: b.empresa,
      expected: b.neto,
      recurringEntryId: findPayrollEntry(recurringEntries, b.empresa)?.id ?? null,
      fromBreakdown: true,
      prevBreakdownNeto: prevNetoByCompany.get(normCompanyKey(b.empresa)) ?? null,
    }));
  }

  // No hay breakdown del mes actual. Usar breakdown del mes anterior como expected si existe.
  const seen = new Set<string>();
  const rows: PayrollBudgetRow[] = [];

  // Primero añadir empresas con breakdown del mes anterior
  for (const b of breakdownPrevMonth) {
    const key = normCompanyKey(b.empresa);
    if (seen.has(key)) continue;
    // Verificar que el trabajo sigue activo este mes
    const jobActive = workHistory.some((j) => jobActiveInMonth(j, month, year) && normCompanyKey(j.empresa) === key);
    if (!jobActive) continue;
    seen.add(key);
    rows.push({
      key: `payroll-${key}`,
      empresa: b.empresa,
      expected: b.neto,
      recurringEntryId: findPayrollEntry(recurringEntries, b.empresa)?.id ?? null,
      fromBreakdown: false,
      prevBreakdownNeto: b.neto,
    });
  }

  // Fallback: trabajos activos sin breakdown previo → estimar desde bruto
  for (const job of workHistory) {
    if (!jobActiveInMonth(job, month, year)) continue;
    const key = normCompanyKey(job.empresa);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      key: `payroll-${key}`,
      empresa: job.empresa,
      expected: estimatedJobNeto(job),
      recurringEntryId: findPayrollEntry(recurringEntries, job.empresa)?.id ?? null,
      fromBreakdown: false,
      prevBreakdownNeto: null,
    });
  }
  return rows;
}

export function incomeRealAmount(
  expected: number,
  recurringEntryId: number | null,
  mbMap: Record<number, number>,
  prevBreakdownNeto?: number | null,
): number {
  // Prioridad 1: importe real guardado manualmente en monthly_budget
  if (recurringEntryId != null && mbMap[recurringEntryId] != null) {
    return mbMap[recurringEntryId]!;
  }
  // Prioridad 2: nómina del mes anterior como sugerencia automática
  if (prevBreakdownNeto != null) {
    return prevBreakdownNeto;
  }
  // Fallback: expected
  return expected;
}
