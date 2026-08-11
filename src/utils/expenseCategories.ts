/** Taxonomía fija de categorías para movimientos (gasto / ingreso). */

export const EXPENSE_CATEGORIES = [
  "Alimentación",
  "Transporte",
  "Hogar",
  "Salud",
  "Ocio",
  "Suscripciones",
  "Ropa",
  "Educación",
  "Impuestos",
  "Seguros",
  "Regalos",
  "Viajes",
  "Deudas",
  "Ahorro / inversión",
  "Otros gastos",
] as const;

export const INCOME_CATEGORIES = [
  "Nómina",
  "Freelance",
  "Devolución",
  "Transferencia recibida",
  "Otros ingresos",
] as const;

export const INTERNAL_TRANSFER_CATEGORY = "Transferencia interna";
export const SUBSCRIPTION_CATEGORY = "Suscripciones";

/** Aliases legacy → categoría canónica (o "" = sin categoría). */
const CATEGORY_ALIASES: Record<string, string> = {
  "suscripciones y facturas": SUBSCRIPTION_CATEGORY,
  suscripciones: SUBSCRIPTION_CATEGORY,
  streaming: SUBSCRIPTION_CATEGORY,
  vivienda: "Hogar",
  hogar: "Hogar",
  alimentacion: "Alimentación",
  alimentación: "Alimentación",
  supermercado: "Alimentación",
  ocio: "Ocio",
  transporte: "Transporte",
  salud: "Salud",
  deudas: "Deudas",
  deuda: "Deudas",
  nomina: "Nómina",
  nómina: "Nómina",
  salario: "Nómina",
  ahorro: "Ahorro / inversión",
  inversion: "Ahorro / inversión",
  inversión: "Ahorro / inversión",
  "ahorro / inversión": "Ahorro / inversión",
  otros: "Otros gastos",
  otro: "Otros gastos",
  "otros gastos": "Otros gastos",
  "otros ingresos": "Otros ingresos",
  general: "",
  "sin categoría": "",
  "sin categoria": "",
  g: "",
  deseos: "Ocio",
  ingreso: "Otros ingresos",
};

const EXPENSE_SET = new Set(EXPENSE_CATEGORIES.map((c) => c.toLowerCase()));
const INCOME_SET = new Set(INCOME_CATEGORIES.map((c) => c.toLowerCase()));

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

export function normalizeCategory(raw: string | null | undefined): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase() === INTERNAL_TRANSFER_CATEGORY.toLowerCase()) {
    return INTERNAL_TRANSFER_CATEGORY;
  }
  const alias = CATEGORY_ALIASES[trimmed.toLowerCase()];
  if (alias !== undefined) return alias;
  // Exact canonical match (preserve casing from taxonomy)
  for (const cat of EXPENSE_CATEGORIES) {
    if (cat.toLowerCase() === trimmed.toLowerCase()) return cat;
  }
  for (const cat of INCOME_CATEGORIES) {
    if (cat.toLowerCase() === trimmed.toLowerCase()) return cat;
  }
  return trimmed;
}

export function isCanonicalExpenseCategory(cat: string): boolean {
  return EXPENSE_SET.has((cat || "").trim().toLowerCase());
}

export function isCanonicalIncomeCategory(cat: string): boolean {
  return INCOME_SET.has((cat || "").trim().toLowerCase());
}

export function isCanonicalCategory(cat: string): boolean {
  const n = normalizeCategory(cat);
  if (!n) return false;
  if (n === INTERNAL_TRANSFER_CATEGORY) return true;
  return isCanonicalExpenseCategory(n) || isCanonicalIncomeCategory(n);
}

export function isLegacyCategory(cat: string | null | undefined): boolean {
  const trimmed = (cat || "").trim();
  if (!trimmed) return false;
  const n = normalizeCategory(trimmed);
  if (!n) return true; // maps to empty via alias (General, etc.)
  if (n !== trimmed && isCanonicalCategory(n)) return true; // alias to canonical
  return !isCanonicalCategory(trimmed);
}

/** Opciones del select según signo del importe. Incluye valor actual si es legacy. */
export function categoryOptionsForAmount(
  amount: number,
  currentCategory?: string | null,
): string[] {
  const base = amount >= 0 ? [...INCOME_CATEGORIES] : [...EXPENSE_CATEGORIES];
  const current = (currentCategory || "").trim();
  if (current && current !== INTERNAL_TRANSFER_CATEGORY && !base.includes(current as never)) {
    const normalized = normalizeCategory(current);
    if (normalized && base.includes(normalized as never)) {
      return base;
    }
    return [...base, current];
  }
  return base;
}

/** Categorías de gasto para partidas del presupuesto. */
export function budgetExpenseCategoryOptions(
  currentCategory?: string | null,
): string[] {
  const base = [...EXPENSE_CATEGORIES];
  const current = normalizeCategory(currentCategory) || (currentCategory || "").trim();
  if (current && !base.includes(current as never) && current !== INTERNAL_TRANSFER_CATEGORY) {
    return [...base, current];
  }
  return base;
}
