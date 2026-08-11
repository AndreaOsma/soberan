import type { GoalProgressSnapshot } from "../../utils/goalProgress";

type Props = {
  snapshot: GoalProgressSnapshot;
  formatEUR: (value: number) => string;
  compact?: boolean;
};

export function GoalProgressBlock({ snapshot, formatEUR, compact }: Props) {
  const { goal, current, target, pct, etaLabel, isComplete, monthlyContribution } = snapshot;

  return (
    <div style={{ fontSize: compact ? "0.78rem" : "0.82rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem", gap: "0.5rem", flexWrap: "wrap" }} className="muted">
        <span>
          Objetivo: <span className="sensitive">{formatEUR(target)}</span>
          {goal.fecha_limite && (
            <> · límite {new Date(goal.fecha_limite).toLocaleDateString("es", { month: "short", year: "numeric" })}</>
          )}
        </span>
        <span>
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
