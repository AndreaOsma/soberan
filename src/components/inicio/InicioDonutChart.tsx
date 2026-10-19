import type { CSSProperties } from "react";

export type DonutSlice = {
  label: string;
  value: number;
  color: string;
};

export type InicioDonutChartProps = {
  slices: DonutSlice[];
  centerLabel?: string;
  centerValue?: string;
  size?: number;
  thickness?: number;
  formatValue?: (v: number) => string;
  emptyText?: string;
};

/** Pure-SVG donut — no chart library. Values ≤ 0 are skipped. */
export function InicioDonutChart({
  slices,
  centerLabel,
  centerValue,
  size = 148,
  thickness = 22,
  formatValue,
  emptyText = "Sin datos",
}: InicioDonutChartProps) {
  const positive = slices.filter((s) => s.value > 0);
  const total = positive.reduce((sum, s) => sum + s.value, 0);

  if (total <= 0 || positive.length === 0) {
    return (
      <div className="inicio-donut inicio-donut--empty" style={{ "--donut-size": `${size}px` } as CSSProperties}>
        <div className="inicio-donut__ring inicio-donut__ring--empty" aria-hidden />
        <p className="muted inicio-donut__empty">{emptyText}</p>
      </div>
    );
  }

  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;
  let cursor = 0;

  const arcs = positive.map((slice) => {
    const len = (slice.value / total) * circumference;
    const dashoffset = -cursor;
    cursor += len;
    return { ...slice, len, dashoffset, pct: (slice.value / total) * 100 };
  });

  return (
    <div className="inicio-donut">
      <div className="inicio-donut__visual" style={{ width: size, height: size }}>
        <svg
          className="inicio-donut__svg"
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          role="img"
          aria-label={centerLabel ? `${centerLabel}: ${centerValue ?? ""}` : "Gráfico circular"}
        >
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="var(--border-soft)"
            strokeWidth={thickness}
            opacity={0.55}
          />
          {arcs.map((arc) => (
            <circle
              key={arc.label}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={arc.color}
              strokeWidth={thickness}
              strokeDasharray={`${arc.len} ${circumference - arc.len}`}
              strokeDashoffset={arc.dashoffset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          ))}
        </svg>
        {(centerLabel || centerValue) && (
          <div className="inicio-donut__center">
            {centerLabel && <span className="inicio-donut__center-label">{centerLabel}</span>}
            {centerValue && <strong className="inicio-donut__center-value sensitive">{centerValue}</strong>}
          </div>
        )}
      </div>
      <ul className="inicio-donut__legend">
        {arcs.map((arc) => (
          <li key={arc.label} className="inicio-donut__legend-item">
            <span className="inicio-donut__swatch" style={{ background: arc.color }} aria-hidden />
            <span className="inicio-donut__legend-label">{arc.label}</span>
            <span className="inicio-donut__legend-meta muted">
              {arc.pct.toFixed(0)}%
              {formatValue ? ` · ${formatValue(arc.value)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
