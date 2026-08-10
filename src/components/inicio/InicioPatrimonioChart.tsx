export type InicioPatrimonioChartProps = {
  privacyMode: boolean;
  patrimonioEvolution: Array<{ fecha: string; acumulado: number }>;
  formatEUR: (v: number) => string;
};

export function InicioPatrimonioChart({ privacyMode, patrimonioEvolution, formatEUR }: InicioPatrimonioChartProps) {
  return (
    <div className="inicio-secondary-block">
      {!privacyMode && patrimonioEvolution.length >= 2 && (() => {
        const pts = patrimonioEvolution.slice(-18);
        const vals = pts.map(p => p.acumulado);
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const range = max - min || 1;
        const W = 300, H = 48, PAD = 4;
        const points = pts.map((p, i) => {
          const x = PAD + (i / (pts.length - 1)) * (W - PAD * 2);
          const y = PAD + (1 - (p.acumulado - min) / range) * (H - PAD * 2);
          return `${x},${y}`;
        }).join(" ");
        const last = vals[vals.length - 1];
        const first = vals[0];
        const pctChange = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null;
        const trend = last >= first ? "var(--status-ok)" : "var(--status-crit)";
        return (
          <div className="inicio-panel" style={{ gridColumn: "span 2" }}>
            <div className="inicio-panel__head">
              <h3>Patrimonio neto</h3>
              {pctChange !== null && (
                <span className={`badge ${last >= first ? "positive" : "negative"}`}>
                  {pctChange >= 0 ? "+" : ""}{pctChange.toFixed(1)}% este año
                </span>
              )}
            </div>
            <div className="inicio-panel__body" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: `${H}px`, overflow: "visible" }}>
                <polyline
                  points={points}
                  fill="none"
                  stroke={trend}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity="0.85"
                />
                <circle
                  cx={PAD + (W - PAD * 2)}
                  cy={PAD + (1 - (last - min) / range) * (H - PAD * 2)}
                  r="3"
                  fill={trend}
                />
              </svg>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem" }} className="muted">
                <span>{pts[0]?.fecha?.slice(0, 7)}</span>
                <strong className="sensitive" style={{ fontSize: "0.85rem", color: trend }}>{formatEUR(last)}</strong>
                <span>{pts[pts.length - 1]?.fecha?.slice(0, 7)}</span>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
