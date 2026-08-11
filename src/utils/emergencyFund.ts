import type { Debt, DebtInstallment, RecurringEntry, Transaction } from "../types";
import { isRealExpense } from "./internalTransfer";
import { budgetExpenseAmount } from "./expenseSplits";
import { monthlyDebtObligation, recurringExpenseNames } from "./debtInstallments";
import { isPayrollIncomeEntry } from "./budgetIncome";

export type EmergencyIncomeProfile = "funcionario" | "nomina_privada" | "mixto" | "autonomo";

export type EmergencyIncomeProfileSetting = EmergencyIncomeProfile | "auto";

export type FinancialTrafficLight = "Óptimo" | "Estable" | "Atención Requerida" | "Riesgo Crítico";

export type EmergencyFundSnapshot = {
  avgNecesidades: number;
  currentDebt: number;
  essentialBurn: number;
  efMonths: number | null;
  profile: EmergencyIncomeProfile;
  targetMonths: number;
  warnMonths: number;
  profileLabel: string;
  monthsWithNecesidadesData: number;
};

const PROFILE_LABELS: Record<EmergencyIncomeProfile, string> = {
  funcionario: "Funcionario/a",
  nomina_privada: "Nómina privada",
  mixto: "Mixto",
  autonomo: "Autónomo/freelance",
};

const PROFILE_TARGET_MONTHS: Record<EmergencyIncomeProfile, number> = {
  funcionario: 3,
  nomina_privada: 6,
  mixto: 6,
  autonomo: 12,
};

const AUTONOMO_INCOME_CATEGORIES = new Set(["freelance", "prestación", "prestacion"]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function profileTargetMonths(profile: EmergencyIncomeProfile): number {
  return PROFILE_TARGET_MONTHS[profile];
}

export function profileWarnMonths(profile: EmergencyIncomeProfile): number {
  return Math.max(1, profileTargetMonths(profile) / 2);
}

export function profileLabel(profile: EmergencyIncomeProfile): string {
  return PROFILE_LABELS[profile];
}

export function buildNecesidadesCategorySet(recurringEntries: RecurringEntry[]): Set<string> {
  const cats = new Set<string>();
  for (const entry of recurringEntries) {
    if (entry.es_ingreso) continue;
    if (entry.bloque !== "necesidades") continue;
    const cat = (entry.categoria || "").trim();
    if (cat) cats.add(cat);
    if (entry.tipo_partida === "suscripcion") {
      cats.add("Suscripciones");
    }
  }
  return cats;
}

export function averageNecesidadesSpending(
  transactions: Transaction[],
  categories: Set<string>,
  refDate: Date = new Date(),
  months = 6,
): { average: number; monthsWithData: number } {
  if (categories.size === 0) {
    return { average: 0, monthsWithData: 0 };
  }

  const monthTotals: number[] = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const d = new Date(refDate.getFullYear(), refDate.getMonth() - offset, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    let sum = 0;
    for (const tx of transactions) {
      if (!isRealExpense(tx)) continue;
      const txDate = new Date(tx.date);
      if (txDate.getFullYear() !== y || txDate.getMonth() + 1 !== m) continue;
      const cat = (tx.category_anon || "").trim();
      if (!categories.has(cat)) continue;
      sum += budgetExpenseAmount(tx);
    }
    if (sum > 0.01) monthTotals.push(sum);
  }

  if (monthTotals.length === 0) {
    return { average: 0, monthsWithData: 0 };
  }

  const total = monthTotals.reduce((s, v) => s + v, 0);
  return { average: round2(total / monthTotals.length), monthsWithData: monthTotals.length };
}

export function currentMonthlyDebt(
  debts: Debt[],
  installments: DebtInstallment[],
  month: number,
  year: number,
  recurringEntries: RecurringEntry[],
): number {
  return monthlyDebtObligation(
    debts,
    installments,
    month,
    year,
    recurringExpenseNames(recurringEntries),
  );
}

export function essentialMonthlyBurn(avgNecesidades: number, currentDebt: number): number {
  return round2(avgNecesidades + currentDebt);
}

export function emergencyFundMonthsCovered(liquidity: number, essentialBurn: number): number | null {
  if (essentialBurn <= 0.01) return null;
  return round2(liquidity / essentialBurn);
}

export function resolveIncomeProfile(
  setting: string | undefined,
  recurringEntries: RecurringEntry[],
): EmergencyIncomeProfile {
  const normalized = (setting || "auto").trim().toLowerCase();
  if (normalized === "funcionario") return "funcionario";
  if (normalized === "nomina_privada" || normalized === "nómina privada") return "nomina_privada";
  if (normalized === "mixto") return "mixto";
  if (normalized === "autonomo" || normalized === "autónomo") return "autonomo";

  const incomeEntries = recurringEntries.filter((e) => e.es_ingreso);
  if (incomeEntries.length === 0) return "nomina_privada";

  const totalPlanned = incomeEntries.reduce((s, e) => s + Number(e.monto_estimado || 0), 0);
  if (totalPlanned <= 0.01) return "nomina_privada";

  const autonomoPlanned = incomeEntries
    .filter((e) => AUTONOMO_INCOME_CATEGORIES.has((e.categoria || "").trim().toLowerCase()))
    .reduce((s, e) => s + Number(e.monto_estimado || 0), 0);

  if (autonomoPlanned / totalPlanned > 0.4) return "autonomo";

  const hasPayroll = incomeEntries.some((e) => isPayrollIncomeEntry(e));
  const hasOther = incomeEntries.some((e) => !isPayrollIncomeEntry(e));
  if (hasPayroll && hasOther) return "mixto";

  return "nomina_privada";
}

export function financialTrafficLightV2(params: {
  efMonths: number | null;
  savingsRate: number;
  proj90: number;
  totalDebt: number;
  totalCash: number;
  profile: EmergencyIncomeProfile;
  targetSavingsPct?: number;
}): FinancialTrafficLight {
  const { efMonths, savingsRate, proj90, totalDebt, totalCash, profile, targetSavingsPct = 20 } = params;
  const target = profileTargetMonths(profile);
  const warn = profileWarnMonths(profile);
  const savingsTarget = Math.max(0, targetSavingsPct) / 100;

  if (proj90 < 0 || (efMonths !== null && efMonths < 1) || (totalDebt > 0 && totalCash < 0)) {
    return "Riesgo Crítico";
  }
  if (savingsRate < 0 || (efMonths !== null && efMonths < warn)) {
    return "Atención Requerida";
  }
  if (savingsRate >= savingsTarget && efMonths !== null && efMonths >= target) {
    return "Óptimo";
  }
  return "Estable";
}

export function buildEmergencyFundSnapshot(params: {
  transactions: Transaction[];
  recurringEntries: RecurringEntry[];
  debts: Debt[];
  debtInstallments: DebtInstallment[];
  month: number;
  year: number;
  liquidity: number;
  profileSetting?: string;
  refDate?: Date;
}): EmergencyFundSnapshot {
  const {
    transactions,
    recurringEntries,
    debts,
    debtInstallments,
    month,
    year,
    liquidity,
    profileSetting,
    refDate = new Date(),
  } = params;

  const categories = buildNecesidadesCategorySet(recurringEntries);
  const { average: avgNecesidades, monthsWithData } = averageNecesidadesSpending(
    transactions,
    categories,
    refDate,
  );
  const debt = currentMonthlyDebt(debts, debtInstallments, month, year, recurringEntries);
  const burn = essentialMonthlyBurn(avgNecesidades, debt);
  const profile = resolveIncomeProfile(profileSetting, recurringEntries);
  const targetMonths = profileTargetMonths(profile);
  const warnMonths = profileWarnMonths(profile);

  return {
    avgNecesidades,
    currentDebt: debt,
    essentialBurn: burn,
    efMonths: emergencyFundMonthsCovered(liquidity, burn),
    profile,
    targetMonths,
    warnMonths,
    profileLabel: profileLabel(profile),
    monthsWithNecesidadesData: monthsWithData,
  };
}

export function trafficLightCriteriaText(
  profile: EmergencyIncomeProfile,
  targetSavingsPct = 20,
): Record<FinancialTrafficLight, string> {
  const target = profileTargetMonths(profile);
  const warn = profileWarnMonths(profile);
  return {
    "Óptimo": `Tasa de ahorro ≥ ${targetSavingsPct}% y fondo de emergencia ≥ ${target} meses (perfil ${PROFILE_LABELS[profile]}).`,
    "Estable": "Finanzas estables pero sin alcanzar el nivel Óptimo.",
    "Atención Requerida": `Tasa de ahorro negativa o fondo de emergencia < ${warn} meses.`,
    "Riesgo Crítico": "Proyección de patrimonio neto a 90 días negativa, reserva < 1 mes o cuenta en negativo con deuda.",
  };
}

/** Porcentaje del mes transcurrido (0–100). Mes futuro → 0; mes pasado → 100. */
export function monthElapsedPercent(month: number, year: number, ref: Date = new Date()): number {
  const curMonth = ref.getMonth() + 1;
  const curYear = ref.getFullYear();
  if (year > curYear || (year === curYear && month > curMonth)) return 0;
  if (year < curYear || (year === curYear && month < curMonth)) return 100;
  const daysInMonth = new Date(year, month, 0).getDate();
  return Math.round((ref.getDate() / daysInMonth) * 100);
}

export function isCurrentCalendarMonth(month: number, year: number, ref: Date = new Date()): boolean {
  return ref.getMonth() + 1 === month && ref.getFullYear() === year;
}
