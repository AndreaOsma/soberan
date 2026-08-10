import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { FinancialTrafficLight } from "./inicioTypes";

export type StatusReason = {
  label: string;
  value: string;
  ok: boolean;
  detail?: string;
};

export type InicioStatusHeaderProps = {
  light: FinancialTrafficLight;
  lightColor: string;
  statusReasons: StatusReason[];
  statusCriteria: Record<FinancialTrafficLight, string>;
};

export function InicioStatusHeader({
  light, lightColor, statusReasons, statusCriteria,
}: InicioStatusHeaderProps) {
  const [statusTooltipOpen, setStatusTooltipOpen] = useState(false);
  const statusPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!statusTooltipOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStatusTooltipOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (statusPopoverRef.current && !statusPopoverRef.current.contains(e.target as Node)) {
        setStatusTooltipOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [statusTooltipOpen]);

  const STATUS_CRITERIA = statusCriteria;

  return (
      <div className="inicio-header">
        <div
          ref={statusPopoverRef}
          style={{ position: "relative", display: "inline-flex" }}
          onMouseEnter={() => setStatusTooltipOpen(true)}
          onMouseLeave={() => setStatusTooltipOpen(false)}
        >
          <div
            className="inicio-header__badge"
            role="button"
            tabIndex={0}
            aria-expanded={statusTooltipOpen}
            aria-label={`Estado financiero: ${light}. Pulsa para ver criterios.`}
            style={{ "--badge-color": lightColor, cursor: "help" } as CSSProperties}
            onClick={() => setStatusTooltipOpen(o => !o)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setStatusTooltipOpen(o => !o);
              }
            }}
          >
            <span className="inicio-header__dot" style={{ background: lightColor }} />
            {light}
          </div>

          {statusTooltipOpen && (
            <div className="inicio-status-popover">
              <p style={{ marginBottom: "0.5rem", fontWeight: 600 }}>{light}</p>
              <p className="muted" style={{ marginBottom: "0.75rem", fontSize: "0.78rem" }}>
                {STATUS_CRITERIA[light]}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {statusReasons.map(r => (
                  <div key={r.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
                      <span className="muted">{r.label}</span>
                      <span className={r.ok ? "status-check--ok" : "status-check--fail"}>
                        {r.ok ? "✓ " : "✗ "}{r.value}
                      </span>
                    </div>
                    {r.detail && (
                      <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.72rem", textAlign: "right" }}>{r.detail}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <h2 className="inicio-header__title">Finanzas personales</h2>
        <p className="inicio-header__sub muted">
          {new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}
        </p>
      </div>
  );
}
