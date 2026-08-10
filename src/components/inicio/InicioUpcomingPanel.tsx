import type { CalendarEvent, MenuKey } from "./inicioTypes";

export type InicioUpcomingPanelProps = {
  upcoming: CalendarEvent[];
  today: Date;
  formatEUR: (v: number) => string;
  onNavigate: (key: MenuKey) => void;
};

export function InicioUpcomingPanel({ upcoming, today, formatEUR, onNavigate }: InicioUpcomingPanelProps) {
  if (upcoming.length === 0) return null;
  return (
    <div className="inicio-panel">
      <div className="inicio-panel__head">
        <h3>Próximos 14 días</h3>
        <span className="badge">{upcoming.length}</span>
      </div>
      <div className="inicio-panel__body">
        {upcoming.map((ev, i) => {
          const d = new Date(ev.fecha);
          const daysAway = Math.ceil((d.getTime() - today.getTime()) / 86_400_000);
          return (
            <div key={i} className="inicio-proj-row">
              <div>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0.35rem" }}>
                  {ev.tipo === "prestacion" || ev.seccion === "Prestación" ? (
                    <span className="badge" style={{ fontSize: "0.65rem", fontWeight: 600 }}>Prestación</span>
                  ) : null}
                  <span style={{ fontSize: "0.875rem" }}>{ev.titulo}</span>
                </div>
                <small className="muted" style={{ marginLeft: "0.4rem" }}>
                  {daysAway === 0 ? "hoy" : daysAway === 1 ? "mañana" : `en ${daysAway}d`}
                  {" · "}{d.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                </small>
              </div>
              <strong className={`sensitive ${ev.monto < 0 ? "negative" : "positive"}`} style={{ fontSize: "0.875rem" }}>
                {ev.monto < 0 ? "−" : "+"}{formatEUR(Math.abs(ev.monto))}
              </strong>
            </div>
          );
        })}
        <button
          type="button"
          className="button-secondary"
          style={{ marginTop: "0.5rem", fontSize: "0.8rem", width: "100%" }}
          onClick={() => onNavigate("Calendario de Pagos")}
        >
          Ver calendario →
        </button>
      </div>
    </div>
  );
}
