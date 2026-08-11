import { alertActionFor } from "../../utils/alertActions";
import type { AlertItem, MenuKey } from "./inicioTypes";

const SEVERITY_LABEL: Record<string, string> = {
  alta: "Alta",
  media: "Media",
  baja: "Baja",
};

export type InicioAlertsPanelProps = {
  alerts: AlertItem[];
  highAlerts: AlertItem[];
  onNavigate: (key: MenuKey) => void;
};

export function InicioAlertsPanel({ alerts, highAlerts, onNavigate }: InicioAlertsPanelProps) {
  return (
    <div className="inicio-panel">
      <div className="inicio-panel__head">
        <h3>Alertas activas</h3>
        {highAlerts.length > 0 && (
          <span className="badge negative">{highAlerts.length} alta{highAlerts.length !== 1 ? "s" : ""}</span>
        )}
      </div>
      <div className="inicio-panel__body">
        {alerts.length === 0 ? (
          <p className="muted" style={{ fontSize: "0.875rem" }}>Sin anomalías detectadas.</p>
        ) : (
          alerts.slice(0, 5).map((a, i) => {
            const action = alertActionFor(a.tipo);
            return (
              <div key={i} className="inicio-alert-item">
                <span className={`priority-tag priority-${a.severidad}`}>{SEVERITY_LABEL[a.severidad] ?? a.severidad}</span>
                <div className="inicio-alert-item__body">
                  <span>{a.mensaje}</span>
                  <button
                    type="button"
                    className="button-secondary inicio-alert-item__cta"
                    onClick={() => onNavigate(action.menu)}
                  >
                    {action.label} →
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
