import type { MenuKey } from "../config/ui";

export type AlertAction = {
  /** Short action verb for the CTA button */
  label: string;
  menu: MenuKey;
};

const ALERT_ACTIONS: Record<string, AlertAction> = {
  riesgo_liquidez: { label: "Revisar cuenta", menu: "Cuentas" },
  objetivo_proximo: { label: "Ver objetivo", menu: "Objetivos" },
  desviacion_presupuestaria: { label: "Ajustar presupuesto", menu: "Presupuesto" },
  anomalia_duplicidad: { label: "Revisar movimientos", menu: "Transacciones" },
  calidad_datos: { label: "Categorizar", menu: "Transacciones" },
  deuda_vencida: { label: "Mover pago", menu: "Pasivos" },
  dti_elevado: { label: "Revisar deudas", menu: "Pasivos" },
  sepe_renovacion: { label: "Historial laboral", menu: "Historial Laboral" },
  irpf_retencion_desviada: { label: "Ver IRPF", menu: "Impuestos" },
};

const DEFAULT_ACTION: AlertAction = {
  label: "Ir a Inicio",
  menu: "Resumen Ejecutivo",
};

export function alertActionFor(tipo: string | null | undefined): AlertAction {
  if (!tipo) return DEFAULT_ACTION;
  return ALERT_ACTIONS[tipo] ?? DEFAULT_ACTION;
}
