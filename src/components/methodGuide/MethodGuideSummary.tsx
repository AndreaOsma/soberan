import {
  METHOD_503020_ROWS,
  METHOD_CYCLE_STEPS,
  METHOD_SUMMARY_ASSIGN,
  METHOD_SUMMARY_LEAD,
} from "../../content/methodGuide";

type Props = {
  onOpenFullGuide?: () => void;
};

export function MethodGuideSummary({ onOpenFullGuide }: Props) {
  return (
    <div className="method-guide-summary">
      <p className="method-guide-summary__lead">{METHOD_SUMMARY_LEAD}</p>

      <ol className="method-guide-cycle">
        {METHOD_CYCLE_STEPS.map((step) => (
          <li key={step.n} className="method-guide-cycle__item">
            <span className="method-guide-cycle__n">{step.n}</span>
            <div>
              <strong>{step.label}</strong>
              <span className="muted method-guide-cycle__hint">{step.hint}</span>
            </div>
          </li>
        ))}
      </ol>

      <div className="method-guide-503020" aria-label="Marco 50/30/20">
        {METHOD_503020_ROWS.map((row) => (
          <div key={row.block} className="method-guide-503020__row">
            <span className="method-guide-503020__pct">{row.pct}</span>
            <div>
              <strong>{row.block}</strong>
              <span className="muted method-guide-503020__items">{row.items}</span>
            </div>
          </div>
        ))}
      </div>

      <p className="method-guide-summary__assign muted">{METHOD_SUMMARY_ASSIGN}</p>

      {onOpenFullGuide && (
        <button type="button" className="method-guide-link" onClick={onOpenFullGuide}>
          Más detalle
        </button>
      )}
    </div>
  );
}
