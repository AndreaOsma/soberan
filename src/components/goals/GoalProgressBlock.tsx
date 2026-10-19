import type { GoalProgressSnapshot } from "../../utils/goalProgress";

type Props = {
  snapshot: GoalProgressSnapshot;
  formatEUR: (value: number) => string;
  compact?: boolean;
};

export function GoalProgressBlock({ snapshot, formatEUR, compact }: Props) {
  const { goal, current, target, pct, etaLabel, isComplete, monthlyContribution } = snapshot;

  return (
    <div className={`goal-progress${compact ? " goal-progress--compact" : ""}`}>
      <div className="goal-progress__row muted">
        <span className="goal-progress__target">
          Objetivo: <span className="sensitive">{formatEUR(target)}</span>
          {goal.fecha_limite && (
            <> · límite {new Date(goal.fecha_limite).toLocaleDateString("es", { month: "short", year: "numeric" })}</>
          )}
        </span>
        <span className="goal-progress__current">
          <span className="sensitive">{formatEUR(current)}</span>
          {" "}({pct.toFixed(1)}%)
          {isComplete ? (
            <span className="budget-goal-done"> · ✓ alcanzado</span>
          ) : etaLabel ? (
            <span> · {etaLabel}</span>
          ) : monthlyContribution <= 0 ? (
            <span> · sin aportación en presupuesto</span>
          ) : null}
        </span>
      </div>
      <div className="budget-goal-track">
        <div
          className={`budget-goal-fill ${isComplete || pct >= 100 ? "budget-goal-fill--done" : "budget-goal-fill--progress"}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}
