import type { AlertItem, CalendarEvent, Goal, Account } from "../../types";
import type { NextDebtPayment } from "../../utils/debtInstallments";
import type { EmergencyFundSnapshot, FinancialTrafficLight } from "../../utils/emergencyFund";
import type { BudgetScheduleInput } from "../../utils/budgetTotals";
import type { MenuKey } from "../../config/ui";

export type TotalsSnapshot = {
  totalCash: number;
  totalDebt: number;
  totalInvestments: number;
  totalAssets: number;
  netWorth: number;
  monthlyIncome: number;
  monthlyExpense: number;
  monthlySavings: number;
  monthlyConsumption?: number;
  monthlyFondos?: number;
  monthlyPuntual?: number;
  monthlySubs?: number;
  monthlyDebtPayments?: number;
  monthlyAhorroInversion?: number;
  monthlyAhorroToCartera?: number;
  monthlyLiquidityOutflows?: number;
};

export type ActiveSalary = {
  empresa: string;
  bruto: number;
  irpf: number;
  ss: number;
  neto: number;
  irpf_pct: number;
  ss_pct: number;
} | null;

export type { AlertItem, CalendarEvent, Goal, Account, NextDebtPayment, EmergencyFundSnapshot, FinancialTrafficLight, BudgetScheduleInput, MenuKey };
