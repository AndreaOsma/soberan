/** Colores semánticos alineados con tokens CSS (--status-*) */
export const HEALTH_LIGHT_COLOR: Record<string, string> = {
  "Óptimo": "var(--status-ok)",
  Estable: "var(--status-info)",
  "Atención Requerida": "var(--status-warn)",
  "Riesgo Crítico": "var(--status-crit)",
};

export function healthLightColor(light: string): string {
  return HEALTH_LIGHT_COLOR[light] ?? "var(--text-muted)";
}

export function mesStatusFillClass(status: "ok" | "warn" | "over"): string {
  if (status === "over") return "progress-fill--crit";
  if (status === "warn") return "progress-fill--warn";
  return "progress-fill--ok";
}

export function goalProgressFillClass(pct: number): string {
  return pct >= 80 ? "progress-fill--ok" : "progress-fill--info";
}

/** Categorías de ingreso → clase CSS (income-cat--*) */
export const INCOME_CAT_CLASS: Record<string, string> = {
  "Nómina": "income-cat--nomina",
  Freelance: "income-cat--freelance",
  Alquiler: "income-cat--alquiler",
  Dividendos: "income-cat--dividendos",
  Intereses: "income-cat--intereses",
  Prestación: "income-cat--prestacion",
  Subvención: "income-cat--subvencion",
  "Venta de activo": "income-cat--venta",
  Reembolso: "income-cat--reembolso",
  Regalo: "income-cat--regalo",
  "Devolución Hacienda": "income-cat--hacienda",
  Otros: "income-cat--default",
};

export function incomeCatClass(cat: string): string {
  return INCOME_CAT_CLASS[cat] ?? "income-cat--default";
}

/** Tipos de evento en calendario → clase CSS (cal-event--*) */
const CAL_EVENT_MATCHERS: Array<{ includes: string[]; className: string; label: string }> = [
  { includes: ["subscription", "suscripcion"], className: "cal-event--suscripcion", label: "Suscripción" },
  { includes: ["prestacion", "prestación"], className: "cal-event--prestacion", label: "Prestación" },
  { includes: ["recurring_income", "ingreso"], className: "cal-event--ingreso", label: "Ingreso" },
  { includes: ["deuda"], className: "cal-event--deuda", label: "Deuda" },
];

export function calendarEventClass(tipo: string): string {
  const key = tipo.toLowerCase().replace("ó", "o").replace("ú", "u");
  for (const matcher of CAL_EVENT_MATCHERS) {
    if (matcher.includes.some((token) => key.includes(token))) return matcher.className;
  }
  return "cal-event--other";
}

export function calendarEventLabel(tipo: string): string {
  const key = tipo.toLowerCase().replace("ó", "o").replace("ú", "u");
  for (const matcher of CAL_EVENT_MATCHERS) {
    if (matcher.includes.some((token) => key.includes(token))) return matcher.label;
  }
  return tipo;
}

export const CAL_LEGEND_ITEMS = [
  { className: "cal-legend-dot--ingreso", label: "Ingreso" },
  { className: "cal-legend-dot--prestacion", label: "Prestación" },
  { className: "cal-legend-dot--suscripcion", label: "Suscripción" },
  { className: "cal-legend-dot--deuda", label: "Deuda" },
] as const;

export function wishlistPriorityClass(prioridad: string): string {
  if (prioridad === "alta") return "wishlist-priority--alta";
  if (prioridad === "media") return "wishlist-priority--media";
  return "wishlist-priority--baja";
}

export const EVOLUTION_PALETTE = {
  liquidez: "var(--status-info)",
  inversiones: "var(--status-ok)",
  propiedades: "var(--status-accent)",
  pasivos: "var(--status-crit)",
} as const;
