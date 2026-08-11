import type { ReactNode } from "react";
import { goalProgressFillClass, mesStatusFillClass } from "../../utils/statusColors";
import type { ActiveSalary, Goal, MenuKey } from "./inicioTypes";

type GoalProgress = Goal & {
  current: number;
  pct: number;
  remaining: number;
  monthsLeft: number | null;
  daysUntilDeadline: number | null;
};

export type InicioWealthPanelsProps = {
  showMesWidget: boolean;
  mesStatus: "ok" | "warn" | "over" | null;
  monthElapsedPct: number;
  budgetSpentPct: number | null;
  monthSpent: number;
  monthlyExpense: number;
  goalsWithProgress: GoalProgress[];
  privacyMode: boolean;
  activeSalary: ActiveSalary;
  formatEUR: (v: number) => string;
  onNavigate: (key: MenuKey) => void;
  upcomingSlot?: ReactNode;
};

export function InicioWealthPanels({
  showMesWidget, mesStatus, monthElapsedPct, budgetSpentPct, monthSpent, monthlyExpense,
  goalsWithProgress, privacyMode, activeSalary, formatEUR, onNavigate, upcomingSlot,
}: InicioWealthPanelsProps) {
  return (
    <>
        {showMesWidget && (
          <div className="inicio-panel">
            <div className="inicio-panel__head">
              <h3>Cómo va el mes</h3>
              {mesStatus === "over" && <span className="badge negative">por encima</span>}
              {mesStatus === "warn" && <span className="badge badge-warn">vigilar</span>}
              {mesStatus === "ok" && <span className="badge positive">en ritmo</span>}
            </div>
            <div className="inicio-panel__body">
              <div style={{ marginBottom: "0.6rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.2rem" }}>
                  <span className="muted">Mes transcurrido</span>
                  <strong>{monthElapsedPct}%</strong>
                </div>
                <div className="progress-track">
                  <div className="progress-fill progress-fill--muted" style={{ width: `${monthElapsedPct}%` }} />
                </div>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.2rem" }}>
                  <span className="muted">Presupuesto gastado</span>
                  <strong className={mesStatus === "over" ? "negative" : mesStatus === "ok" ? "positive" : ""}>{budgetSpentPct}%</strong>
                </div>
                <div className="progress-track">
                  <div className={`progress-fill ${mesStatusFillClass(mesStatus ?? "ok")}`} style={{ width: `${Math.min(100, budgetSpentPct ?? 0)}%` }} />
                </div>
              </div>
              <div className="inicio-proj-row" style={{ marginTop: "0.6rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border-soft)" }}>
                <span className="muted" style={{ fontSize: "0.8rem" }}>Gastado este mes</span>
                <strong className="sensitive negative" style={{ fontSize: "0.85rem" }}>{formatEUR(monthSpent)}</strong>
              </div>
              <div className="inicio-proj-row">
                <span className="muted" style={{ fontSize: "0.8rem" }}>Presupuesto mensual</span>
                <strong className="sensitive" style={{ fontSize: "0.85rem" }}>{formatEUR(monthlyExpense)}</strong>
              </div>
            </div>
          </div>
        )}

      {upcomingSlot}
        {goalsWithProgress.length > 0 && !privacyMode && (
          <div className="inicio-panel">
            <div className="inicio-panel__head">
              <h3>Objetivos en curso</h3>
              <span className="badge">{goalsWithProgress.length}</span>
            </div>
            <div className="inicio-panel__body">
              {goalsWithProgress.map((g) => (
                <div key={g.id} style={{ marginBottom: "0.75rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: "0.2rem" }}>
                    <span>{g.nombre}</span>
                    <span className="muted sensitive">{g.pct.toFixed(0)}%</span>
                  </div>
                  <div className="progress-track progress-track--thin">
                    <div className={`progress-fill ${goalProgressFillClass(g.pct)}`} style={{ width: `${Math.min(100, g.pct)}%` }} />
                  </div>
                  <div style={{ fontSize: "0.75rem", marginTop: "0.15rem" }} className="muted">
                    <span className="sensitive">{formatEUR(g.current)}</span>
                    {" / "}
                    <span className="sensitive">{formatEUR(g.monto_objetivo)}</span>
                    {g.monthsLeft !== null && g.monthsLeft > 0 && (
                      <span className="muted"> · ~{g.monthsLeft} meses</span>
                    )}
                    {g.daysUntilDeadline !== null && g.daysUntilDeadline < 90 && (
                      <span className={g.daysUntilDeadline < 30 ? "negative" : "muted"}>
                        {" · "}vence en {g.daysUntilDeadline}d
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="button-secondary"
                style={{ fontSize: "0.8rem", width: "100%" }}
                onClick={() => onNavigate("Objetivos")}
              >
                Ver todos →
              </button>
            </div>
          </div>
        )}

        {activeSalary && !privacyMode && (
          <div className="inicio-panel">
            <div className="inicio-panel__head">
              <h3>Nómina — {activeSalary.empresa}</h3>
            </div>
            <div className="inicio-panel__body">
              <div className="inicio-proj-row">
                <span className="muted">Bruto mensual</span>
                <strong className="sensitive">{formatEUR(activeSalary.bruto)}</strong>
              </div>
              <div className="inicio-proj-row">
                <span className="muted">IRPF ({activeSalary.irpf_pct}%)</span>
                <strong className="sensitive negative">−{formatEUR(activeSalary.irpf)}</strong>
              </div>
              <div className="inicio-proj-row">
                <span className="muted">SS ({activeSalary.ss_pct}%)</span>
                <strong className="sensitive negative">−{formatEUR(activeSalary.ss)}</strong>
              </div>
              <div className="inicio-proj-row" style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border-soft)" }}>
                <span className="muted">Neto mensual</span>
                <strong className="sensitive positive">{formatEUR(activeSalary.neto)}</strong>
              </div>
            </div>
          </div>
        )}

    </>
  );
}
