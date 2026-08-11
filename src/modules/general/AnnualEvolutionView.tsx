import { useEffect, useState } from "react";
import type { Investment } from "../../types";
import { EmptyState } from "../../components/EmptyState";
import { EVOLUTION_PALETTE } from "../../utils/statusColors";
import { MONTH_NAMES } from "../../hooks/useBudgetEntries";
import { api } from "../../services/api";

type Totals = {
  totalCash: number;
  totalDebt: number;
  totalInvestments: number;
  totalAssets: number;
};

type Props = {
  year: number;
  patrimonioEvolution: Array<{ fecha: string; acumulado: number }>;
  investments: Investment[];
  totals: Totals;
  formatEUR: (v: number) => string;
};

const CURRENT_YEAR = new Date().getFullYear();

function monthLabel(fecha: string): string {
  const month = Number(fecha.slice(5, 7));
  return MONTH_NAMES[month - 1] ?? fecha;
}

export function AnnualEvolutionView({ year: initialYear, patrimonioEvolution, investments, totals, formatEUR }: Props) {
  const [year, setYear] = useState(() => Math.min(initialYear, CURRENT_YEAR));
  const [rows, setRows] = useState(patrimonioEvolution);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getPatrimonioEvolucion(year)
      .then((data) => { if (!cancelled) setRows(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year]);

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.acumulado)), 1);
  const lastRow = rows[rows.length - 1];
  const firstRow = rows[0];
  const delta = lastRow && firstRow ? lastRow.acumulado - firstRow.acumulado : null;

  const totalInvested = investments.reduce((s, i) => s + Number(i.monto_invertido), 0);
  const investmentPnl = totals.totalInvestments - totalInvested;
  const allocationItems = [
    { label: "Liquidez", value: totals.totalCash, color: EVOLUTION_PALETTE.liquidez },
    { label: "Inversiones", value: totals.totalInvestments, color: EVOLUTION_PALETTE.inversiones },
    ...(totals.totalAssets > 0 ? [{ label: "Propiedades", value: totals.totalAssets, color: EVOLUTION_PALETTE.propiedades }] : []),
    ...(totals.totalDebt > 0 ? [{ label: "Pasivos", value: -totals.totalDebt, color: EVOLUTION_PALETTE.pasivos }] : []),
  ];
  const grossPositive = allocationItems.filter(i => i.value > 0).reduce((s, i) => s + i.value, 0);

  return (
    <section className="grid">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem" }}>
        {allocationItems.map(({ label, value, color }) => (
          <div key={label} style={{ padding: "0.875rem 1rem", background: "var(--glass-bg)", border: `1px solid ${color}33`, borderLeft: `4px solid ${color}`, borderRadius: "0.625rem" }}>
            <p className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.25rem" }}>{label}</p>
            <strong className={`sensitive ${value < 0 ? "negative" : ""}`} style={{ fontSize: "1.1rem" }}>
              {value < 0 ? "−" : ""}{formatEUR(Math.abs(value))}
            </strong>
            {grossPositive > 0 && value > 0 && (
              <p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.15rem" }}>
                {((value / grossPositive) * 100).toFixed(1)}% del total
              </p>
            )}
          </div>
        ))}
        {investmentPnl !== 0 && (
          <div style={{ padding: "0.875rem 1rem", background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "0.625rem" }}>
            <p className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.25rem" }}>P&L inversiones</p>
            <strong className={`sensitive ${investmentPnl >= 0 ? "positive" : "negative"}`} style={{ fontSize: "1.1rem" }}>
              {investmentPnl >= 0 ? "+" : ""}{formatEUR(investmentPnl)}
            </strong>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="inv-summary" style={{ display: "flex", gap: "2rem", padding: "1rem 1.25rem", background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "0.75rem" }}>
          <div>
            <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Patrimonio neto ({year})</p>
            <strong className={`sensitive ${(lastRow?.acumulado ?? 0) >= 0 ? "positive" : "negative"}`} style={{ fontSize: "1.5rem" }}>
              {formatEUR(lastRow?.acumulado ?? 0)}
            </strong>
          </div>
          {delta !== null && (
            <div>
              <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Variación en {year}</p>
              <strong className={`sensitive ${delta >= 0 ? "positive" : "negative"}`} style={{ fontSize: "1.5rem" }}>
                {delta >= 0 ? "+" : ""}{formatEUR(delta)}
              </strong>
            </div>
          )}
        </div>
      )}

      <article className="card">
        <div className="budget-annual__head">
          <div className="budget-annual__head-row">
            <h2 style={{ margin: 0 }}>Evolución patrimonial ({year})</h2>
            <div className="budget-annual__period" role="group" aria-label="Seleccionar año">
              <button
                type="button"
                className="button-secondary budget-annual__period-nav"
                onClick={() => setYear((y) => y - 1)}
                aria-label="Año anterior"
              >
                ‹
              </button>
              <span style={{ minWidth: "3.5rem", textAlign: "center", fontWeight: 600 }}>{year}</span>
              {year !== CURRENT_YEAR && (
                <button
                  type="button"
                  className="button-secondary"
                  style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
                  onClick={() => setYear(CURRENT_YEAR)}
                  aria-label="Volver al año actual"
                >
                  Hoy
                </button>
              )}
              <button
                type="button"
                className="button-secondary budget-annual__period-nav"
                onClick={() => setYear((y) => y + 1)}
                aria-label="Año siguiente"
                disabled={year >= CURRENT_YEAR}
              >
                ›
              </button>
            </div>
          </div>
        </div>
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>Patrimonio neto mensual acumulado.</p>
        {loading ? (
          <p className="muted" style={{ fontSize: "0.85rem" }}>Cargando…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="📈"
            title="Sin datos en el período"
            description="Aún no hay evolución patrimonial registrada para este año."
          />
        ) : (
          <div className="evol-chart">
            {rows.map((row) => {
              const barPct = (Math.max(0, row.acumulado) / maxAbs) * 100;
              return (
                <div key={row.fecha} className="evol-row">
                  <span className="evol-row__label muted">{monthLabel(row.fecha)}</span>
                  <div className="evol-row__bar-wrap">
                    <div className={`evol-row__bar ${row.acumulado < 0 ? "negative-bar" : "positive-bar"}`} style={{ width: `${barPct}%` }} />
                  </div>
                  <span className={`evol-row__val sensitive ${row.acumulado < 0 ? "negative" : "positive"}`}>
                    {formatEUR(row.acumulado)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}
