export type {
  AmortizationScheduleRow,
  BudgetDebtRow,
  GenerateScheduleOptions,
  NextDebtPayment,
  ProjectedDebtPayment,
  SimpleInstallmentRow,
} from "./debt/types";
export { DEBT_TIPO_OPTIONS } from "./debt/types";

export {
  applyChargeDayToFirstInstallment,
  chargeDayInMonth,
  chargeIsoDate,
  clampDebtChargeDay,
  daysInMonth,
  defaultScheduleStartDate,
  isoDate,
  monthIndex,
  parseChargeDayInput,
  parseInstallmentDate,
} from "./debt/chargeCalendar";

export {
  debtHasPlanilla,
  installmentMatchesMonth,
  installmentPendingForDebt,
  installmentStatus,
  isDebtArchived,
  simpleRowStatus,
} from "./debt/archive";

export {
  computeMonthlyPaymentFromTerm,
  enrichInstallmentRows,
  generateAmortizationSchedule,
  remainingDebtPaymentSchedule,
  scheduleMaturityDate,
  scheduleToInstallmentPayload,
} from "./debt/amortization";

export {
  budgetDebtRows,
  budgetDebtRowsForTotal,
  dedupedBudgetDebtRows,
  monthlyDebtObligation,
  monthlyDebtTotalFromPlanilla,
  recurringExpenseNames,
} from "./debt/budgetDebtRows";

export { nextDebtPayment } from "./debt/nextPayment";

export type { ActiveExtraInfo, ExtraPaymentImpact, ExtraPaymentMode, ExtraPaymentTarget } from "./debt/extraPayment";
export {
  detectActiveExtra,
  pickBaseNumeroCuota,
  resolveExtraPaymentTarget,
  simulateExtraPayment,
} from "./debt/extraPayment";
