import type { TotalsSnapshot } from "./inicioTypes";

type ProjectionRow = {
  months: number;
  label: string;
  netWorth: number;
  cash: number;
  delta: number;
};

export type InicioProjectionsPanelProps = {
  projections: ProjectionRow[];
  totals: TotalsSnapshot;
  showLiquidityColumn: boolean;
  projectionReturnPct: number;
  formatEUR: (v: number) => string;
  saveSetting: (key: string, val: string, notify?: boolean) => Promise<void>;
};

export function InicioProjectionsPanel({
  projections, totals, showLiquidityColumn, projectionReturnPct, formatEUR, saveSetting,
}: InicioProjectionsPanelProps) {
  return (
          <div className="inicio-panel">
            <div className="inicio-panel__head">
              <h3>Proyección patrimonial</h3>
              <small className="muted">
                Plan mensual y planilla de deudas · hoy {formatEUR(totals.netWorth)}
              </small>
            </div>
            <div className="inicio-panel__body">
              <div
                className={`inicio-proj-table${showLiquidityColumn ? " inicio-proj-table--with-cash" : ""}`}
                role="table"
                aria-label="Proyección de patrimonio neto"
              >
                <div className="inicio-proj-table__head" role="row">
                  <span role="columnheader">Horizonte</span>
                  <span role="columnheader">Patrimonio</span>
                  <span role="columnheader">Δ vs hoy</span>
                  {showLiquidityColumn && <span role="columnheader">Liquidez</span>}
                </div>
                {projections.map((row) => (
                  <div key={row.months} className="inicio-proj-table__row" role="row">
                    <span className="muted" role="cell">{row.label}</span>
                    <strong
                      className={`sensitive ${row.netWorth < totals.netWorth ? "negative" : row.netWorth > totals.netWorth ? "positive" : ""}`}
                      role="cell"
                    >
                      {formatEUR(row.netWorth)}
                    </strong>
                    <span
                      className={`sensitive ${row.delta < 0 ? "negative" : row.delta > 0 ? "positive" : "muted"}`}
                      role="cell"
                    >
                      {row.delta === 0 ? "—" : `${row.delta >= 0 ? "+" : ""}${formatEUR(row.delta)}`}
                    </span>
                    {showLiquidityColumn && (
                      <span
                        className={`sensitive ${row.cash < 0 ? "negative" : ""}`}
                        role="cell"
                      >
                        {formatEUR(row.cash)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="inicio-proj-row" style={{ marginTop: "0.65rem", paddingTop: "0.55rem", borderTop: "1px solid var(--border-soft)" }}>
                <span className="muted">Ahorro estimado/mes</span>
                <strong className={`sensitive ${totals.monthlySavings < 0 ? "negative" : "positive"}`}>
                  {totals.monthlySavings >= 0 ? "+" : ""}{formatEUR(totals.monthlySavings)}
                </strong>
              </div>
              {(totals.monthlyDebtPayments ?? 0) > 0 && (
                <div className="inicio-proj-row inicio-proj-row--sub">
                  <span className="muted">Cuotas deuda (mes actual)</span>
                  <strong className="sensitive">{formatEUR(totals.monthlyDebtPayments ?? 0)}</strong>
                </div>
              )}
              <label className="inicio-proj-row" style={{ alignItems: "center" }}>
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
                  style={{ width: "4rem" }}
                  aria-label="Revalorización anual de inversiones en proyección"
                />
              </label>
              <p className="muted inicio-proj-footnote">
                Patrimonio y liquidez suman mes a mes según presupuesto y cuotas de la planilla de deudas.
                {showLiquidityColumn && " La liquidez incluye aportaciones a cartera."}
                {projectionReturnPct > 0 && ` Revalorización ${projectionReturnPct}% anual sobre cartera actual.`}
              </p>
            </div>
          </div>
  );
}
