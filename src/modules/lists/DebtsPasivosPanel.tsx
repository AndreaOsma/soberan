import { api } from "../../services/api";
import { EmptyState } from "../../components/EmptyState";
import { DebtScheduleCalendar } from "../../components/debt/DebtScheduleCalendar";
import { parseNum } from "../../utils/format";
import {
  debtHasPlanilla,
  defaultScheduleStartDate,
  isDebtArchived,
  monthlyDebtObligation,
  nextDebtPayment,
  recurringExpenseNames,
} from "../../utils/debtInstallments";
import type { Debt, DebtInstallment, RecurringEntry } from "../../types";
import type { Dispatch, SetStateAction } from "react";
import type { DebtFormState } from "./ListsEditModals";

type Props = {
  debts: Debt[];
  debtInstallments: DebtInstallment[];
  recurringEntries: RecurringEntry[];
  monthlyIncome: number;
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  deleteWithUndo: (label: string, onCommit: () => Promise<void>) => void;
  debtExtraMonthly: number;
  setDebtExtraMonthly: (v: number) => void;
  debtCalc: { dtiPct: number; termYears: number; tae: number };
  setDebtCalc: Dispatch<SetStateAction<{ dtiPct: number; termYears: number; tae: number }>>;
  showLiquidatedDebts: boolean;
  setShowLiquidatedDebts: Dispatch<SetStateAction<boolean>>;
  showLiquidation: boolean;
  setShowLiquidation: Dispatch<SetStateAction<boolean>>;
  showDebtCapacity: boolean;
  setShowDebtCapacity: Dispatch<SetStateAction<boolean>>;
  liquidationMode: "avalanche" | "snowball";
  setLiquidationMode: Dispatch<SetStateAction<"avalanche" | "snowball">>;
  scheduleFocusDebtId: number | null;
  scheduleEditorDebtId: number | null;
  scheduleAutocalc: boolean;
  scheduleStartDate: string | null;
  setScheduleFocusDebtId: (v: number | null) => void;
  setScheduleEditorDebtId: (v: number | null) => void;
  setScheduleAutocalc: (v: boolean) => void;
  setScheduleStartDate: (v: string | null) => void;
  emptyDebtForm: () => DebtFormState;
  setDebtForm: Dispatch<SetStateAction<DebtFormState>>;
  setIsDebtFormOpen: (v: boolean) => void;
  setEditDebtModal: (v: Debt | null) => void;
  setDebtPaymentsModal: (v: { debt: Debt; initialAmount?: number; initialDate?: string } | null) => void;
};

export function DebtsPasivosPanel({
  debts, debtInstallments, recurringEntries, monthlyIncome, formatEUR, addToast, loadAll, deleteWithUndo,
  debtExtraMonthly, setDebtExtraMonthly, debtCalc, setDebtCalc,
  showLiquidatedDebts, setShowLiquidatedDebts,
  showLiquidation, setShowLiquidation,
  showDebtCapacity, setShowDebtCapacity,
  liquidationMode, setLiquidationMode,
  scheduleFocusDebtId, scheduleEditorDebtId, scheduleAutocalc, scheduleStartDate,
  setScheduleFocusDebtId, setScheduleEditorDebtId, setScheduleAutocalc, setScheduleStartDate,
  emptyDebtForm, setDebtForm, setIsDebtFormOpen, setEditDebtModal, setDebtPaymentsModal,
}: Props) {
    const activeDebts = debts.filter((d) => !isDebtArchived(d));
    const liquidatedDebts = debts.filter((d) => isDebtArchived(d));
    const visibleDebts = showLiquidatedDebts ? debts : activeDebts;
    const monthNow = new Date().getMonth() + 1;
    const yearNow = new Date().getFullYear();
    const recNames = recurringExpenseNames(recurringEntries);
    const monthlyObligation = monthlyDebtObligation(debts, debtInstallments, monthNow, yearNow, recNames);
    const nextPay = nextDebtPayment(debts, debtInstallments);
    const currentDtiPreview = monthlyIncome > 0 ? (monthlyObligation / monthlyIncome) * 100 : 0;

    function openScheduleEditor(debt: Debt, autocalc: boolean) {
      setScheduleFocusDebtId(debt.id);
      setScheduleEditorDebtId(debt.id);
      setScheduleAutocalc(autocalc);
      setScheduleStartDate(defaultScheduleStartDate(debt));
    }

    function calcPayoff(ordered: typeof activeDebts, extraMonthly: number) {
      type DebtState = { id: number; acreedor: string; pending: number; rate: number; minPayment: number };
      const state: DebtState[] = ordered.map((d) => ({
        id: d.id,
        acreedor: d.nombre || d.acreedor,
        pending: d.monto_total - d.monto_pagado,
        rate: (Number(d.tasa_anual) || 0) / 100 / 12,
        minPayment: Number(d.cuota_mensual) || 0
      }));
      let totalInterest = 0;
      const payoffMonth: Record<number, number> = {};
      for (let m = 1; m <= 600; m++) {
        let extra = extraMonthly;
        for (let i = 0; i < state.length; i++) {
          const s = state[i];
          if (s.pending <= 0) continue;
          const interest = s.pending * s.rate;
          totalInterest += interest;
          const minPay = Math.min(s.pending + interest, s.minPayment || s.pending + interest);
          s.pending = Math.max(0, s.pending + interest - minPay);
          if (s.pending <= 0 && !(s.id in payoffMonth)) payoffMonth[s.id] = m;
        }
        for (let i = 0; i < state.length; i++) {
          const s = state[i];
          if (s.pending > 0 && extra > 0) {
            const payment = Math.min(s.pending, extra);
            s.pending -= payment;
            extra -= payment;
            if (s.pending <= 0 && !(s.id in payoffMonth)) payoffMonth[s.id] = m;
            break;
          }
        }
        if (state.every((s) => s.pending <= 0)) break;
      }
      return { payoffMonth, totalInterest };
    }

    const avalancheOrder = [...activeDebts].sort((a, b) => (Number(b.tasa_anual) || 0) - (Number(a.tasa_anual) || 0));
    const snowballOrder = [...activeDebts].sort((a, b) => (a.monto_total - a.monto_pagado) - (b.monto_total - b.monto_pagado));
    const avalanche = calcPayoff(avalancheOrder, debtExtraMonthly);
    const snowball = calcPayoff(snowballOrder, debtExtraMonthly);
    const today = new Date();

    function monthsToDate(months: number) {
      const d = new Date(today.getFullYear(), today.getMonth() + months, 1);
      return d.toLocaleDateString("es", { year: "numeric", month: "short" });
    }

    const existingPayments = monthlyObligation;
    const maxPayment = monthlyIncome * (debtCalc.dtiPct / 100);
    const freePayment = Math.max(0, maxPayment - existingPayments);
    const currentDtiPct = currentDtiPreview;
    const monthlyRate = debtCalc.tae / 100 / 12;
    const n = debtCalc.termYears * 12;
    const maxLoan = monthlyRate > 0 && freePayment > 0
      ? freePayment * (1 - Math.pow(1 + monthlyRate, -n)) / monthlyRate
      : freePayment > 0 ? freePayment * n
      : 0;
    const dtiColor = currentDtiPct >= debtCalc.dtiPct
      ? "#dc2626" : currentDtiPct >= debtCalc.dtiPct * 0.8
      ? "#d97706" : "#16a34a";
    const scenarios = [
      { label: "Conservador", dti: 30 },
      { label: "Moderado", dti: 35 },
      { label: "Máximo bancario", dti: 40 },
    ].map(s => {
      const mp = monthlyIncome * (s.dti / 100);
      const fp = Math.max(0, mp - existingPayments);
      const ml = monthlyRate > 0 && fp > 0 ? fp * (1 - Math.pow(1 + monthlyRate, -n)) / monthlyRate : fp > 0 ? fp * n : 0;
      return { ...s, freePayment: fp, maxLoan: ml };
    });

  return (
        <section className="grid">
          <section className="grid two-col">
            <article className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <h2>Deudas y Pasivos</h2>
                <button onClick={() => { setDebtForm(emptyDebtForm()); setIsDebtFormOpen(true); }}>+ Nueva deuda</button>
              </div>
              <p className="muted" style={{ fontSize: "0.82rem", margin: "0 0 1rem" }}>
                Planilla = cuotas previstas del acreedor. Pagos reales = abonos efectivos que actualizan el saldo.
              </p>

              {activeDebts.length > 0 && (
                <div className="pasivos-summary-chip">
                  <button type="button" className="pasivos-summary-chip__item" onClick={() => setShowDebtCapacity(true)}>
                    <span className="muted">DTI</span>
                    <strong style={{ color: currentDtiPreview >= debtCalc.dtiPct ? "#dc2626" : currentDtiPreview >= debtCalc.dtiPct * 0.8 ? "#d97706" : undefined }}>
                      {currentDtiPreview.toFixed(1)}%
                    </strong>
                  </button>
                  {nextPay && (
                    <span className="pasivos-summary-chip__item">
                      <span className="muted">Próxima cuota</span>
                      <strong className="sensitive">{formatEUR(nextPay.amount)}</strong>
                      <small className="muted">{new Date(nextPay.date + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</small>
                    </span>
                  )}
                </div>
              )}

              {activeDebts.length === 0 && !showLiquidatedDebts ? (
                <EmptyState
                  icon="🎉"
                  title="Sin deudas activas"
                  description="No tienes pasivos registrados con saldo pendiente."
                  actionLabel="+ Añadir deuda"
                  onAction={() => setIsDebtFormOpen(true)}
                />
              ) : visibleDebts.length === 0 ? (
                <p className="muted" style={{ fontSize: "0.85rem" }}>No hay deudas archivadas para mostrar.</p>
              ) : (
                <ul className="list">
                  {visibleDebts.map((debt) => {
                    const pending = debt.monto_total - debt.monto_pagado;
                    const hasPlanilla = debtHasPlanilla(debtInstallments, debt.id);
                    return (
                      <li key={debt.id}>
                        <div>
                          <strong>{debt.nombre || debt.acreedor}</strong>
                          {debt.nombre && <small className="muted" style={{ marginLeft: "0.4rem" }}>· {debt.acreedor}</small>}
                          {Number(debt.tasa_anual) > 0 ? <small className="muted" style={{ marginLeft: "0.5rem" }}>{debt.tasa_anual}% TAE</small> : null}
                          {pending > 0 && !hasPlanilla ? (
                            <button type="button" className="debt-badge debt-badge--no-planilla debt-badge--clickable"
                              title="Generar planilla"
                              onClick={() => openScheduleEditor(debt, true)}>
                              Sin planilla
                            </button>
                          ) : null}
                          {pending <= 0 ? (
                            <span className="debt-badge debt-badge--liquidated">Archivada</span>
                          ) : null}
                        </div>
                        <div className="inline-actions">
                          <strong className={pending > 0 ? "negative sensitive" : "positive sensitive"}>{formatEUR(pending)}</strong>
                          {pending > 0 && !hasPlanilla ? (
                            <button type="button" style={{ padding: "0.25rem 0.5rem", fontSize: "0.78rem" }}
                              title="Generar planilla desde cuota, TAE y fecha de inicio"
                              aria-label={`Generar planilla de ${debt.nombre || debt.acreedor}`}
                              onClick={() => openScheduleEditor(debt, true)}>
                              Generar planilla
                            </button>
                          ) : (
                            <button type="button" className="button-secondary" style={{ padding: "0.25rem 0.5rem", fontSize: "0.78rem" }}
                              title="Ver o editar planilla de pagos"
                              aria-label={`Planilla de ${debt.nombre || debt.acreedor}`}
                              onClick={() => openScheduleEditor(debt, false)}>
                              Planilla
                            </button>
                          )}
                          <button type="button" className="button-secondary" style={{ padding: "0.25rem 0.5rem", fontSize: "0.78rem" }}
                            title="Historial de pagos reales abonados"
                            aria-label={`Pagos reales de ${debt.nombre || debt.acreedor}`}
                            onClick={() => setDebtPaymentsModal({ debt })}>Pagos reales</button>
                          <button type="button" className="button-secondary" style={{ padding: "0.25rem 0.5rem" }}
                            aria-label={`Editar deuda ${debt.nombre || debt.acreedor}`} title="Editar"
                            onClick={() => setEditDebtModal(debt)}>✎</button>
                          <button type="button" className="danger"
                            aria-label={`Eliminar deuda ${debt.nombre || debt.acreedor}`} title="Eliminar"
                            onClick={() => deleteWithUndo("Deuda", () => api.deleteDebt(debt.id).then(() => loadAll()))}>
                            🗑
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {liquidatedDebts.length > 0 && (
                <button type="button" className="button-secondary" style={{ marginTop: "0.75rem", fontSize: "0.82rem" }}
                  onClick={() => setShowLiquidatedDebts(v => !v)}>
                  {showLiquidatedDebts
                    ? "Ocultar archivadas"
                    : `Ver archivadas (${liquidatedDebts.length})`}
                </button>
              )}
            </article>

            <article className="card debt-strategy-card">
              <button
                type="button"
                className="debt-panel-head"
                onClick={() => setShowLiquidation(v => !v)}
                aria-expanded={showLiquidation}
              >
                <div className="debt-panel-head__text">
                  <h2>Estrategia de liquidación</h2>
                  <p className="muted">
                    {activeDebts.length === 0
                      ? "Añade deudas para priorizar pagos"
                      : avalanche.totalInterest <= snowball.totalInterest
                        ? `Avalanche ahorra más · interés ${formatEUR(avalanche.totalInterest)}`
                        : `Snowball prioriza saldos · interés ${formatEUR(snowball.totalInterest)}`}
                  </p>
                </div>
                <span className="debt-panel-head__chevron" aria-hidden>{showLiquidation ? "▾" : "▸"}</span>
              </button>

              {showLiquidation && (
                <div className="debt-strategy-body">
                  <label className="debt-strategy-extra">
                    <span>Pago extra mensual</span>
                    <div className="debt-strategy-extra__field">
                      <input
                        type="number"
                        min={0}
                        step={50}
                        value={debtExtraMonthly}
                        onChange={(e) => setDebtExtraMonthly(parseNum(e.target.value))}
                        aria-label="Pago extra mensual disponible"
                      />
                      <span className="muted">€/mes</span>
                    </div>
                  </label>

                  {activeDebts.length > 0 && activeDebts.some((d) => Number(d.tasa_anual) > 0) ? (
                    <>
                      <div className="debt-strategy-tabs" role="tablist" aria-label="Método de liquidación">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={liquidationMode === "avalanche"}
                          className={`debt-strategy-tab${liquidationMode === "avalanche" ? " debt-strategy-tab--active" : ""}`}
                          onClick={() => setLiquidationMode("avalanche")}
                        >
                          Avalanche
                          <small>Mayor interés primero</small>
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={liquidationMode === "snowball"}
                          className={`debt-strategy-tab${liquidationMode === "snowball" ? " debt-strategy-tab--active" : ""}`}
                          onClick={() => setLiquidationMode("snowball")}
                        >
                          Snowball
                          <small>Menor saldo primero</small>
                        </button>
                      </div>

                      <div className="debt-strategy-stats">
                        <div>
                          <span className="muted">Interés estimado</span>
                          <strong className="sensitive">
                            {formatEUR(liquidationMode === "avalanche" ? avalanche.totalInterest : snowball.totalInterest)}
                          </strong>
                        </div>
                        <div>
                          <span className="muted">vs otra estrategia</span>
                          <strong className={`sensitive ${
                            (liquidationMode === "avalanche"
                              ? snowball.totalInterest - avalanche.totalInterest
                              : avalanche.totalInterest - snowball.totalInterest) >= 0
                              ? "positive"
                              : "negative"
                          }`}>
                            {(() => {
                              const delta = liquidationMode === "avalanche"
                                ? snowball.totalInterest - avalanche.totalInterest
                                : avalanche.totalInterest - snowball.totalInterest;
                              if (Math.abs(delta) < 0.01) return "Empate";
                              return `${delta > 0 ? "Ahorras " : "Cuesta "}${formatEUR(Math.abs(delta))}`;
                            })()}
                          </strong>
                        </div>
                      </div>

                      <ol className="debt-strategy-list">
                        {(liquidationMode === "avalanche" ? avalancheOrder : snowballOrder).map((d, i) => {
                          const pending = d.monto_total - d.monto_pagado;
                          const payoff = (liquidationMode === "avalanche" ? avalanche : snowball).payoffMonth[d.id];
                          return (
                            <li key={d.id} className={i === 0 ? "debt-strategy-list__item--focus" : undefined}>
                              <span className="debt-strategy-list__rank">{i + 1}</span>
                              <div className="debt-strategy-list__main">
                                <strong>{d.nombre || d.acreedor}</strong>
                                <span className="muted">
                                  {liquidationMode === "avalanche"
                                    ? (Number(d.tasa_anual) > 0 ? `${d.tasa_anual}% TAE` : "Sin TAE")
                                    : formatEUR(pending)}
                                  {Number(d.tasa_anual) > 0 && liquidationMode === "snowball" ? ` · ${d.tasa_anual}%` : ""}
                                </span>
                              </div>
                              <div className="debt-strategy-list__meta">
                                <span className="sensitive">{formatEUR(pending)}</span>
                                <small className="muted">{payoff ? monthsToDate(payoff) : "—"}</small>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </>
                  ) : (
                    <p className="muted debt-strategy-empty">
                      Añade la TAE a tus deudas para priorizar Avalanche o Snowball.
                    </p>
                  )}
                </div>
              )}
            </article>
          </section>

          <DebtScheduleCalendar
            debts={debts}
            installments={debtInstallments}
            formatEUR={formatEUR}
            onRefresh={() => void loadAll({ silent: true })}
            addToast={addToast}
            initialDebtId={scheduleFocusDebtId}
            openEditorForDebtId={scheduleEditorDebtId}
            autocalculateOnOpen={scheduleAutocalc}
            initialStartDate={scheduleStartDate}
            onEditorClose={() => {
              setScheduleEditorDebtId(null);
              setScheduleAutocalc(false);
              setScheduleStartDate(null);
            }}
            onOpenPayments={(debt, installment) => setDebtPaymentsModal({
              debt,
              initialAmount: installment?.cuota_total,
              initialDate: installment?.fecha_vencimiento.slice(0, 10),
            })}
          />

          <article className="card debt-capacity-card">
            <button
              type="button"
              className="debt-panel-head"
              onClick={() => setShowDebtCapacity(v => !v)}
              aria-expanded={showDebtCapacity}
            >
              <div className="debt-panel-head__text">
                <h2>Capacidad de endeudamiento</h2>
                <p className="muted">
                  DTI actual {currentDtiPct.toFixed(1)}% · límite {debtCalc.dtiPct}%
                </p>
              </div>
              <span className="debt-panel-head__chevron" aria-hidden>{showDebtCapacity ? "▾" : "▸"}</span>
            </button>
            {showDebtCapacity && <>
            <p className="muted" style={{ fontSize: "0.82rem", marginBottom: "1rem", marginTop: "0.75rem" }}>
              Basado en tu nómina estimada y las cuotas actuales. Regla DTI (Debt-to-Income): los bancos españoles suelen exigir que la cuota total no supere el 30-35% del ingreso neto.
            </p>

            <div style={{ marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: "0.3rem" }}>
                <span>Ratio actual de endeudamiento (DTI)</span>
                <strong style={{ color: dtiColor }}>{currentDtiPct.toFixed(1)}%</strong>
              </div>
              <div style={{ height: "8px", background: "var(--border, #e2e8f0)", borderRadius: "4px", position: "relative" }}>
                <div style={{ height: "100%", width: `${Math.min(100, currentDtiPct)}%`, background: dtiColor, borderRadius: "4px", transition: "width 0.3s ease" }} />
                <div style={{ position: "absolute", top: "-3px", left: `${Math.min(100, debtCalc.dtiPct)}%`, width: "2px", height: "14px", background: "var(--muted, #6b7280)", transform: "translateX(-50%)" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", marginTop: "0.2rem" }} className="muted">
                <span>0%</span>
                <span>Límite: {debtCalc.dtiPct}%</span>
                <span>100%</span>
              </div>
            </div>

            <div className="kpi-tiles" style={{ marginBottom: "1.25rem" }}>
              {[
                { label: "Ingresos netos/mes", value: formatEUR(monthlyIncome), muted: false },
                { label: "Cuotas actuales/mes", value: formatEUR(existingPayments), muted: false },
                { label: "Cuota máxima admisible", value: formatEUR(maxPayment), muted: false },
                { label: "Cuota disponible", value: formatEUR(freePayment), muted: freePayment <= 0 },
                { label: "Préstamo máximo estimado", value: formatEUR(maxLoan), muted: maxLoan <= 0 },
              ].map(({ label, value, muted }) => (
                <div key={label} style={{ padding: "0.6rem 0.75rem", background: "var(--surface-2, rgba(0,0,0,0.04))", borderRadius: "0.4rem" }}>
                  <div style={{ fontSize: "0.72rem", opacity: 0.55, marginBottom: "0.2rem" }}>{label}</div>
                  <strong className={`sensitive ${muted ? "negative" : ""}`} style={{ fontSize: "0.95rem" }}>{value}</strong>
                </div>
              ))}
            </div>

            <div className="kpi-tiles" style={{ marginBottom: "1.25rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.83rem" }}>
                DTI máximo (%)
                <input type="number" min={10} max={60} step={5} value={debtCalc.dtiPct}
                  onChange={e => setDebtCalc(p => ({ ...p, dtiPct: parseFloat(e.target.value) || 35 }))} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.83rem" }}>
                Plazo del préstamo (años)
                <input type="number" min={1} max={40} step={1} value={debtCalc.termYears}
                  onChange={e => setDebtCalc(p => ({ ...p, termYears: parseInt(e.target.value) || 20 }))} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.83rem" }}>
                Tasa de interés TAE (%)
                <input type="number" min={0} max={30} step={0.1} value={debtCalc.tae}
                  onChange={e => setDebtCalc(p => ({ ...p, tae: parseFloat(e.target.value) || 0 }))} />
              </label>
            </div>

            <h3 style={{ fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.55, marginBottom: "0.5rem" }}>
              Comparativa de escenarios · {debtCalc.termYears} años al {debtCalc.tae}% TAE
            </h3>
            <ul className="list">
              {scenarios.map(s => (
                <li key={s.label}>
                  <span>
                    {s.label}
                    <small className="muted" style={{ marginLeft: "0.4rem" }}>DTI {s.dti}%</small>
                  </span>
                  <div className="debt-scenario-meta" style={{ display: "flex", gap: "1rem", fontSize: "0.83rem" }}>
                    <span className="muted">cuota libre: <strong>{formatEUR(s.freePayment)}/mes</strong></span>
                    <strong className={`sensitive ${s.maxLoan <= 0 ? "negative" : "positive"}`}>
                      {s.maxLoan > 0 ? formatEUR(s.maxLoan) : "Sin margen"}
                    </strong>
                  </div>
                </li>
              ))}
            </ul>

            {currentDtiPct >= debtCalc.dtiPct && (
              <p style={{ marginTop: "0.75rem", fontSize: "0.82rem", color: "#dc2626", background: "rgba(220,38,38,0.06)", padding: "0.5rem 0.75rem", borderRadius: "0.375rem" }}>
                Tus cuotas actuales ya superan el DTI configurado — con tu nómina actual los bancos denegarán nuevas operaciones de crédito.
              </p>
            )}
            </>}
          </article>
        </section>
  );
}
