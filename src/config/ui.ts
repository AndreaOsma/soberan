export type MenuKey =
  | "Resumen Ejecutivo"
  | "Interés Compuesto"
  | "Evolución Anual"
  | "Flujo de Efectivo"
  | "Presupuesto"
  | "Cierre Mensual"
  | "Calendario de Pagos"
  | "Cuentas"
  | "Transacciones"
  | "Ingresos"
  | "Objetivos"
  | "Pasivos"
  | "Inversiones"
  | "Activos Fijos"
  | "Cuentas a Cobrar"
  | "Historial Laboral"
  | "Impuestos"
  | "Tarjetas"
  | "Configuración";

export type MenuSection =
  | "Inicio"
  | "Movimientos"
  | "Presupuesto"
  | "Cuentas"
  | "Inversiones"
  | "Propiedades"
  | "Laboral"
  | "Configuración";

export const MENU_SECTIONS: MenuSection[] = [
  "Inicio",
  "Movimientos",
  "Presupuesto",
  "Cuentas",
  "Inversiones",
  "Propiedades",
  "Laboral",
  "Configuración",
];

export const SECTION_ICONS: Record<MenuSection, string> = {
  "Inicio":         "🏠",
  "Movimientos":    "↕️",
  "Presupuesto":    "📊",
  "Cuentas":        "🏦",
  "Inversiones":    "📈",
  "Propiedades":    "🏗️",
  "Laboral":        "💼",
  "Configuración":  "⚙️",
};

export const SECTION_BLURBS: Record<MenuSection, string> = {
  "Inicio":         "Visión general de tu patrimonio",
  "Movimientos":    "Transacciones, ingresos, flujo de efectivo y objetivos",
  "Presupuesto":    "Presupuesto, suscripciones y calendario de pagos",
  "Cuentas":        "Cuentas bancarias, tarjetas, pasivos y cobros pendientes",
  "Inversiones":    "Cartera financiera, cripto y evolución",
  "Propiedades":    "Inmuebles y vehículos",
  "Laboral":        "Nóminas, historial e IRPF",
  "Configuración":  "Datos, ajustes y herramientas",
};

export const SECTION_TABS: Record<MenuSection, MenuKey[]> = {
  "Inicio":         ["Resumen Ejecutivo"],
  "Movimientos":    ["Transacciones", "Ingresos", "Flujo de Efectivo", "Objetivos"],
  "Presupuesto":    ["Presupuesto", "Calendario de Pagos", "Cierre Mensual"],
  "Cuentas":        ["Cuentas", "Tarjetas", "Pasivos", "Cuentas a Cobrar"],
  "Inversiones":    ["Inversiones", "Evolución Anual", "Interés Compuesto"],
  "Propiedades":    ["Activos Fijos"],
  "Laboral":        ["Historial Laboral", "Impuestos"],
  "Configuración":  ["Configuración"],
};

export function menuKeyToSection(key: MenuKey): MenuSection {
  for (const [section, tabs] of Object.entries(SECTION_TABS)) {
    if ((tabs as MenuKey[]).includes(key)) return section as MenuSection;
  }
  return "Inicio";
}

export function sectionDefaultTab(section: MenuSection): MenuKey {
  return SECTION_TABS[section][0];
}

export const menuCategories: Record<string, MenuKey[]> = Object.fromEntries(
  MENU_SECTIONS.map((section) => [section, SECTION_TABS[section]])
) as Record<string, MenuKey[]>;

/** Flat menu order for keyboard navigation — derived from sections */
export const ALL_MENU_KEYS: MenuKey[] = MENU_SECTIONS.flatMap((section) => SECTION_TABS[section]);

export function menuPlainLabel(menu: MenuKey) {
  return menu.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}
