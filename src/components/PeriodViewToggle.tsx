type Props = {
  mode: "month" | "year";
  onChange: (mode: "month" | "year") => void;
  monthLabel?: string;
  yearLabel?: string;
  hideMonthButton?: boolean;
};

export function PeriodViewToggle({
  mode,
  onChange,
  monthLabel,
  yearLabel = "Año",
  hideMonthButton,
}: Props) {
  return (
    <div className="period-view-toggle" role="group" aria-label="Vista del período">
      {!hideMonthButton && (
        <button
          type="button"
          className={`period-view-toggle__btn${mode === "month" ? " is-active" : ""}`}
          aria-pressed={mode === "month"}
          onClick={() => onChange("month")}
        >
          Mes{monthLabel ? ` · ${monthLabel}` : ""}
        </button>
      )}
      <button
        type="button"
        className={`period-view-toggle__btn${mode === "year" ? " is-active" : ""}`}
        aria-pressed={mode === "year"}
        onClick={() => onChange("year")}
      >
        {yearLabel}
      </button>
    </div>
  );
}
