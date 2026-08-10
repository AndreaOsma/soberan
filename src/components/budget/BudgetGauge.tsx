import { formatEUR } from "../../utils/format";
import { expenseGaugeStatus, savingsGaugeStatus, statusClass, type BudgetStatus } from "../../utils/budgetStatus";

type Props = {
  label: string;
  pct: number;
  target: number;
  targetLabel: string;
  /** true = más alto es mejor (ahorro); false = más bajo es mejor (gasto) */
  favorable: boolean;
  amount: number;
};

function resolveStatus(pct: number, target: number, favorable: boolean): BudgetStatus {
  return favorable ? savingsGaugeStatus(pct, target) : expenseGaugeStatus(pct, target);
}

export function BudgetGauge({ label, pct, target, targetLabel, favorable, amount }: Props) {
  const status = resolveStatus(pct, target, favorable);
  const fill = Math.min(pct, 100);

  return (
    <div className="budget-gauge">
      <div className="budget-gauge__head">
        <span className="budget-gauge__label">{label}</span>
        <span className={`budget-gauge__pct ${statusClass("budget-gauge__pct", status)}`}>
          {pct.toFixed(0)}% <span className="muted budget-gauge__meta">· meta {targetLabel}</span>
        </span>
      </div>
      <div className="budget-gauge__track">
        <div
          className={`budget-gauge__fill ${statusClass("budget-gauge__fill", status)}`}
          style={{ width: `${fill}%` }}
        />
      </div>
      <div className="budget-gauge__amount muted sensitive">{formatEUR(amount)}</div>
    </div>
  );
}
