import { useState } from "react";
import type { MenuKey, NextDebtPayment, TotalsSnapshot } from "./inicioTypes";

export type InicioKpisSectionProps = {
  totals: TotalsSnapshot;
  liquidity: number;
  privacyMode: boolean;
  uiDensity: "minimal" | "detailed";
  highAlertsCount: number;
  investmentPnl: number;
  pnlPct: number | null;
  dtiPct: number;
  nextDebtPayment: NextDebtPayment | null;
  projectionReturnPct: number;
  formatEUR: (v: number) => string;
  onNavigate: (key: MenuKey) => void;
  saveSetting: (key: string, val: string, notify?: boolean) => Promise<void>;
};

export function InicioKpisSection({
  totals, liquidity, privacyMode, uiDensity, highAlertsCount,
  investmentPnl, pnlPct, dtiPct, nextDebtPayment, projectionReturnPct,
  formatEUR, onNavigate, saveSetting,
}: InicioKpisSectionProps) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  return (
    <>
      <div className="inicio-kpis">
        <div className="inicio-kpi">
          <span className="inicio-kpi__label">Patrimonio neto</span>
          <strong className={`inicio-kpi__value sensitive ${totals.netWorth < 0 ? "negative" : "positive"}`}>
            {formatEUR(totals.netWorth)}
          </strong>
          <span className={`inicio-kpi__sub ${!privacyMode && totals.monthlySavings !== 0 ? (totals.monthlySavings >= 0 ? "positive" : "negative") : ""}`}>
            {!privacyMode && totals.monthlySavings !== 0
              ? `${totals.monthlySavings >= 0 ? "+" : ""}${formatEUR(totals.monthlySavings)}/mes planificado`
              : "\u00a0"}
          </span>
        </div>
        <div className="inicio-kpi inicio-kpi--sep" aria-hidden />
        <div className="inicio-kpi" title="Saldo total en cuentas bancarias">
          <span className="inicio-kpi__label">Liquidez</span>
          <strong className={`inicio-kpi__value sensitive ${liquidity < 0 ? "negative" : ""}`}>
            {formatEUR(liquidity)}
          </strong>
          <span className={`inicio-kpi__sub ${uiDensity === "detailed" && highAlertsCount > 0 ? "negative" : ""}`}>
            {uiDensity === "detailed" && highAlertsCount > 0
              ? `${highAlertsCount} alerta${highAlertsCount !== 1 ? "s" : ""} alta${highAlertsCount !== 1 ? "s" : ""}`
              : "\u00a0"}
          </span>
        </div>
        <div className="inicio-kpi inicio-kpi--sep" aria-hidden />
        <div className="inicio-kpi">
          <span className="inicio-kpi__label">Inversiones</span>
          <strong className="inicio-kpi__value sensitive">{formatEUR(totals.totalInvestments)}</strong>
          <span className={`inicio-kpi__sub ${pnlPct !== null ? (investmentPnl >= 0 ? "positive" : "negative") : ""}`}>
            {pnlPct !== null
              ? `${investmentPnl >= 0 ? "+" : ""}${formatEUR(investmentPnl)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`
              : "\u00a0"}
          </span>
        </div>
        {totals.totalAssets > 0 && (
          <>
            <div className="inicio-kpi inicio-kpi--sep" aria-hidden />
            <div className="inicio-kpi">
              <span className="inicio-kpi__label">Propiedades</span>
              <strong className="inicio-kpi__value sensitive">{formatEUR(totals.totalAssets)}</strong>
              <span className="inicio-kpi__sub">{"\u00a0"}</span>
            </div>
          </>
        )}
        <div className="inicio-kpi inicio-kpi--sep" aria-hidden />
        <div className="inicio-kpi">
          <span className="inicio-kpi__label">Pasivos</span>
          <strong className={`inicio-kpi__value sensitive ${totals.totalDebt > 0 ? "negative" : ""}`}>
            {totals.totalDebt > 0 ? `−${formatEUR(totals.totalDebt)}` : formatEUR(0)}
          </strong>
          <span className="inicio-kpi__sub">{"\u00a0"}</span>
        </div>
        {totals.totalDebt > 0 && (
          <>
            <div className="inicio-kpi inicio-kpi--sep" aria-hidden />
            <button type="button" className="inicio-kpi inicio-kpi--clickable" onClick={() => onNavigate("Pasivos")}>
              <span className="inicio-kpi__label">DTI deudas</span>
              <strong className={`inicio-kpi__value sensitive ${dtiPct >= 35 ? "negative" : dtiPct >= 28 ? "" : "positive"}`}>
                {dtiPct.toFixed(1)}%
              </strong>
              <span className={`inicio-kpi__sub ${nextDebtPayment ? "muted" : ""}`}>
                {nextDebtPayment
                  ? `Próx.: ${formatEUR(nextDebtPayment.amount)} · ${new Date(nextDebtPayment.date + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`
                  : "\u00a0"}
              </span>
            </button>
          </>
        )}
      </div>

      {!privacyMode && (
        <div className="inicio-panel inicio-breakdown-panel">
          <button
            type="button"
            className="inicio-breakdown-toggle"
            aria-expanded={breakdownOpen}
            onClick={() => setBreakdownOpen((o) => !o)}
          >
            <span>De dónde salen estos números</span>
            <span className="muted">{breakdownOpen ? "▾" : "▸"}</span>
          </button>
          {breakdownOpen && (
            <div className="inicio-panel__body inicio-breakdown-body">
              <div className="inicio-proj-row">
                <span className="muted">Ingresos planificados</span>
                <strong className="sensitive positive">{formatEUR(totals.monthlyIncome)}</strong>
              </div>
              <div className="inicio-proj-row">
                <span className="muted">Gastos asignados</span>
                <strong className="sensitive">{formatEUR(totals.monthlyConsumption ?? 0)}</strong>
              </div>
              {(totals.monthlyFondos ?? 0) > 0 && (
                <div className="inicio-proj-row inicio-proj-row--sub">
                  <span className="muted">Fondos</span>
                  <strong className="sensitive">{formatEUR(totals.monthlyFondos ?? 0)}</strong>
                </div>
              )}
              {(totals.monthlyPuntual ?? 0) > 0 && (
                <div className="inicio-proj-row inicio-proj-row--sub">
                  <span className="muted">Gastos planificados</span>
                  <strong className="sensitive">{formatEUR(totals.monthlyPuntual ?? 0)}</strong>
                </div>
              )}
              {(totals.monthlySubs ?? 0) > 0 && (
                <div className="inicio-proj-row inicio-proj-row--sub">
                  <span className="muted">Suscripciones y facturas</span>
                  <strong className="sensitive">{formatEUR(totals.monthlySubs ?? 0)}</strong>
                </div>
              )}
              {(totals.monthlyDebtPayments ?? 0) > 0 && (
                <div className="inicio-proj-row">
                  <span className="muted">Cuotas de deuda</span>
                  <strong className="sensitive">{formatEUR(totals.monthlyDebtPayments ?? 0)}</strong>
                </div>
              )}
              {(totals.monthlyAhorroInversion ?? 0) > 0 && (
                <div className="inicio-proj-row">
                  <span className="muted">Ahorro e inversión planificado</span>
                  <strong className="sensitive positive">{formatEUR(totals.monthlyAhorroInversion ?? 0)}</strong>
                </div>
              )}
              <div className="inicio-proj-row" style={{ marginTop: "0.35rem", paddingTop: "0.35rem", borderTop: "1px solid var(--border-soft)" }}>
                <span className="muted">Ahorro neto estimado/mes</span>
                <strong className={`sensitive ${totals.monthlySavings >= 0 ? "positive" : "negative"}`}>
                  {totals.monthlySavings >= 0 ? "+" : ""}{formatEUR(totals.monthlySavings)}
                </strong>
              </div>
              <div className="inicio-proj-row">
                <span className="muted">Patrimonio neto (cuentas + inversiones + activos − deudas)</span>
                <strong className="sensitive">{formatEUR(totals.netWorth)}</strong>
              </div>
              <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.75rem" }}>
                Proyecciones 1–12 meses según plan mensual y planilla de deudas
                {projectionReturnPct > 0
                  ? ` + ${projectionReturnPct}% anual compuesto sobre inversiones.`
                  : " (sin revalorizar inversiones)."}
              </p>
              <label className="inicio-proj-inline" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem", marginTop: "0.35rem" }}>
                <span className="muted">Revalorización inversiones (% anual)</span>
                <input
                  type="number"
                  min={0}
                  max={15}
                  step={0.5}
                  value={projectionReturnPct}
                  onChange={(e) => void saveSetting(
                    "projection_return_pct",
                    String(Math.max(0, Math.min(15, Number(e.target.value) || 0))),
                    false,
                  )}
                  style={{ width: "3.5rem" }}
                  aria-label="Revalorización anual de inversiones en proyección"
                />
              </label>
            </div>
          )}
        </div>
      )}
    </>
  );
}
