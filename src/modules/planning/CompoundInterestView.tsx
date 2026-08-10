import { useState } from "react";

import { parseNum } from "../../utils/format";

type Props = {
  formatEUR: (v: number) => string;
  totalInvestments: number;
  monthlySavings: number;
};

export function CompoundInterestView({ formatEUR, totalInvestments, monthlySavings }: Props) {
  const [capital, setCapital] = useState(1000);
  const [monthly, setMonthly] = useState(100);
  const [annualRate, setAnnualRate] = useState(6);
  const [years, setYears] = useState(10);

  const monthlyRate = annualRate / 100 / 12;
  const yearRows: Array<{ year: number; value: number; totalDeposited: number; gains: number }> = [];
  let value = capital;
  for (let y = 1; y <= Math.max(1, years); y++) {
    for (let m = 0; m < 12; m++) {
      value = value * (1 + monthlyRate) + monthly;
    }
    const totalDeposited = capital + monthly * 12 * y;
    yearRows.push({ year: y, value, totalDeposited, gains: value - totalDeposited });
  }
  const finalValue = yearRows[yearRows.length - 1]?.value ?? capital;

  return (
    <section className="grid two-col">
      <form className="card">
        <h2>Parámetros</h2>
        <label>
          Capital inicial
          <input type="number" value={capital} onChange={(e) => setCapital(parseNum(e.target.value))} />
        </label>
        <label>
          Aporte mensual
          <input type="number" value={monthly} onChange={(e) => setMonthly(parseNum(e.target.value))} />
        </label>
        <label>
          Interés anual (%)
          <input type="number" step="0.1" value={annualRate} onChange={(e) => setAnnualRate(parseNum(e.target.value))} />
        </label>
        <label>
          Años
          <input type="number" value={years} onChange={(e) => setYears(parseNum(e.target.value))} />
        </label>
        <div style={{ marginTop: "1rem", padding: "1rem", background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "0.5rem" }}>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>Capital final estimado</p>
          <strong className="sensitive" style={{ fontSize: "1.75rem" }}>{formatEUR(finalValue)}</strong>
          {years > 0 && (
            <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.35rem" }}>
              de los cuales <span className="positive">{formatEUR(yearRows[yearRows.length - 1]?.gains ?? 0)}</span> son intereses
            </p>
          )}
        </div>
        {totalInvestments > 0 && (
          <button
            type="button"
            className="button-secondary"
            style={{ marginTop: "0.75rem", width: "100%", fontSize: "0.85rem" }}
            title={`Portfolio actual: ${formatEUR(totalInvestments)}${monthlySavings > 0 ? ` · Ahorro/mes: ${formatEUR(monthlySavings)}` : ""}`}
            onClick={() => {
              setCapital(Math.round(totalInvestments));
              if (monthlySavings > 0) setMonthly(Math.round(monthlySavings));
            }}
          >
            Prefill desde portfolio actual ({formatEUR(totalInvestments)})
          </button>
        )}
      </form>
      <article className="card">
        <h2>Proyección anual</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Año</th>
                <th>Total aportado</th>
                <th>Intereses</th>
                <th>Capital total</th>
              </tr>
            </thead>
            <tbody>
              {yearRows.map((r) => (
                <tr key={r.year}>
                  <td className="muted">Año {r.year}</td>
                  <td className="sensitive">{formatEUR(r.totalDeposited)}</td>
                  <td className={r.gains >= 0 ? "positive" : "negative"}>{formatEUR(r.gains)}</td>
                  <td><strong className="sensitive">{formatEUR(r.value)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
