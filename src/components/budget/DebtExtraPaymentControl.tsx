import { useEffect, useMemo, useState } from "react";
import type { Debt, DebtInstallment } from "../../types";
import {
  detectActiveExtra,
  type ExtraPaymentMode,
  resolveExtraPaymentTarget,
  simulateExtraPayment,
} from "../../utils/debtInstallments";
import { MONTH_NAMES } from "../../hooks/useBudgetEntries";

type Props = {
  debt: Debt;
  planilla: DebtInstallment[];
  month: number;
  year: number;
  formatEUR: (value: number) => string;
  onCommit: (debtId: number, month: number, year: number, extraAmount: number, mode: ExtraPaymentMode) => Promise<void>;
  submitting: boolean;
};

export function DebtExtraPaymentControl({ debt, planilla, month, year, formatEUR, onCommit, submitting }: Props) {
  // Si la cuota del mes visto ya está liquidada (pago real registrado), no se le puede
  // tocar el importe retroactivamente: el extra se aplica a la próxima cuota pendiente.
  const target = useMemo(
    () => resolveExtraPaymentTarget(debt, planilla, month, year),
    [debt, planilla, month, year],
  );
  const targetChanged = target.month !== month || target.year !== year;

  const activeExtra = useMemo(
    () => detectActiveExtra(debt, planilla, target.month, target.year),
    [debt, planilla, target],
  );
  const [extraInput, setExtraInput] = useState("");
  const [mode, setMode] = useState<ExtraPaymentMode>("term");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (touched) return;
    if (activeExtra.active) {
      setExtraInput(String(activeExtra.extraAmount));
      setMode(activeExtra.mode ?? "term");
    }
  }, [activeExtra, touched]);

  const extra = parseFloat(extraInput) || 0;
  const impact = useMemo(
    () => simulateExtraPayment(debt, extra, target.month, target.year, new Date(), mode),
    [debt, extra, target, mode],
  );
  const isChange = activeExtra.active && Math.round(extra * 100) !== Math.round(activeExtra.extraAmount * 100);
  const isSameAsActive = activeExtra.active && !isChange && mode === activeExtra.mode;

  return (
    <details className="debt-extra-payment" open={activeExtra.active}>
      <summary className="muted" style={{ cursor: "pointer", fontSize: "0.78rem" }}>
        {activeExtra.active
          ? `Pago extra planificado: ${formatEUR(activeExtra.extraAmount)} (${activeExtra.mode === "cuota" ? "cuota reducida" : "menos meses"})`
          : "+ Pago extra este mes"}
      </summary>
      <div style={{ marginTop: "0.4rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem" }}>
          <span>Extra sobre la cuota</span>
          <input
            type="number"
            min={0}
            step={10}
            value={extraInput}
            onChange={(e) => { setTouched(true); setExtraInput(e.target.value); }}
            className="debt-schedule-input"
            aria-label={`Pago extra para ${debt.nombre || debt.acreedor}`}
          />
          <span className="muted">€</span>
        </label>
        {targetChanged && (
          <p className="muted" style={{ fontSize: "0.78rem", margin: 0 }}>
            Este mes ya está pagado — se aplicará a la cuota de{" "}
            <strong>{MONTH_NAMES[target.month - 1]} {target.year}</strong>.
          </p>
        )}
        {extra > 0 && (
          <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.78rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}>
              <input type="radio" name={`extra-mode-${debt.id}-${month}-${year}`} checked={mode === "term"} onChange={() => { setTouched(true); setMode("term"); }} />
              Quitar meses
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}>
              <input type="radio" name={`extra-mode-${debt.id}-${month}-${year}`} checked={mode === "cuota"} onChange={() => { setTouched(true); setMode("cuota"); }} />
              Reducir cuota futura
            </label>
          </div>
        )}
        {extra > 0 && impact.applicable && (
          <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
            {impact.wouldSettleDebt ? (
              <>Saldarías la deuda este mes.</>
            ) : impact.mode === "cuota" ? (
              <>
                Tu cuota baja a <strong>{formatEUR(impact.newMonthlyCuota ?? 0)}</strong>/mes desde el mes siguiente,
                {" "}manteniendo el plazo. Ahorras <strong className="positive">{formatEUR(impact.interestSaved)}</strong> en intereses.
              </>
            ) : (
              <>
                Adelantas <strong>{impact.monthsSaved}</strong> {impact.monthsSaved === 1 ? "mes" : "meses"} y ahorras{" "}
                <strong className="positive">{formatEUR(impact.interestSaved)}</strong> en intereses.
              </>
            )}
          </p>
        )}
        {extra > 0 && !impact.applicable && (
          <p className="muted negative" style={{ fontSize: "0.8rem", margin: 0 }}>
            {impact.reason}
          </p>
        )}
        <div className="inline-actions" style={{ gap: "0.4rem" }}>
          <button
            type="button"
            className="button-secondary"
            style={{ fontSize: "0.75rem", padding: "0.2rem 0.45rem" }}
            disabled={!impact.applicable || extra <= 0 || submitting || isSameAsActive}
            onClick={() => void onCommit(debt.id, target.month, target.year, extra, mode).then(() => setTouched(false))}
          >
            {submitting ? "Guardando…" : activeExtra.active ? "Actualizar" : "Aplicar este mes"}
          </button>
          {activeExtra.active && (
            <button
              type="button"
              className="button-secondary"
              style={{ fontSize: "0.75rem", padding: "0.2rem 0.45rem" }}
              disabled={submitting}
              onClick={() => { setExtraInput(""); void onCommit(debt.id, target.month, target.year, 0, "term").then(() => setTouched(false)); }}
            >
              Quitar
            </button>
          )}
        </div>
      </div>
    </details>
  );
}
