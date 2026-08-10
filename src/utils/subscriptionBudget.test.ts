import { describe, expect, it } from "vitest";
import {
  lastActiveMonthBefore,
  recurringEntryAppliesToMonth,
  recurringEntryEnded,
  subscriptionAppliesToMonth,
  subscriptionMonthExcluded,
  subscriptionStarted,
  applySubscriptionPriceChange,
  isAnnualSubscription,
  normalizeSubscriptionFrequency,
  subscriptionAmountForMonth,
  subscriptionMonthlyAmount,
} from "./subscriptionBudget";

const base = {
  mes_inicio: 3,
  anio_inicio: 2026,
  mes_fin: null,
  anio_fin: null,
  meses_excluidos: null,
  frecuencia: "mensual" as const,
  mes_cobro: 1,
};

describe("subscriptionStarted", () => {
  it("respeta mes y año de inicio", () => {
    expect(subscriptionStarted(base, 2, 2026)).toBe(false);
    expect(subscriptionStarted(base, 3, 2026)).toBe(true);
    expect(subscriptionStarted(base, 1, 2027)).toBe(true);
  });

  it("sin inicio definido: activa siempre (legacy)", () => {
    expect(subscriptionStarted({ ...base, mes_inicio: null, anio_inicio: null }, 1, 2020)).toBe(true);
  });
});

describe("recurringEntryEnded", () => {
  it("deja de aplicar después del mes fin inclusive", () => {
    const entry = { mes_fin: 5, anio_fin: 2026 };
    expect(recurringEntryEnded(entry, 5, 2026)).toBe(false);
    expect(recurringEntryEnded(entry, 6, 2026)).toBe(true);
    expect(recurringEntryAppliesToMonth({ ...base, es_puntual: false, ...entry }, 5, 2026)).toBe(true);
    expect(recurringEntryAppliesToMonth({ ...base, es_puntual: false, ...entry }, 6, 2026)).toBe(false);
  });
});

describe("lastActiveMonthBefore", () => {
  it("calcula el último mes activo antes del mes de cancelación", () => {
    expect(lastActiveMonthBefore(3, 2026)).toEqual({ mes_fin: 2, anio_fin: 2026 });
    expect(lastActiveMonthBefore(1, 2026)).toEqual({ mes_fin: 12, anio_fin: 2025 });
  });
});

describe("subscriptionAppliesToMonth", () => {
  it("excluye meses pausados", () => {
    const entry = { ...base, meses_excluidos: "[7]" };
    expect(subscriptionMonthExcluded(entry, 7)).toBe(true);
    expect(subscriptionAppliesToMonth(entry, 7, 2026)).toBe(false);
    expect(subscriptionAppliesToMonth(entry, 8, 2026)).toBe(true);
  });

  it("no aplica antes del inicio aunque no esté pausada", () => {
    expect(subscriptionAppliesToMonth(base, 1, 2026)).toBe(false);
    expect(subscriptionAppliesToMonth(base, 3, 2026)).toBe(true);
  });

  it("no aplica desde el mes posterior al fin", () => {
    const ended = { ...base, mes_fin: 6, anio_fin: 2026 };
    expect(subscriptionAppliesToMonth(ended, 6, 2026)).toBe(true);
    expect(subscriptionAppliesToMonth(ended, 7, 2026)).toBe(false);
  });
});

describe("normalizeSubscriptionFrequency", () => {
  it("reconoce variantes anuales legacy", () => {
    expect(normalizeSubscriptionFrequency("anual")).toBe("anual");
    expect(normalizeSubscriptionFrequency("annual")).toBe("anual");
    expect(normalizeSubscriptionFrequency("A")).toBe("anual");
    expect(isAnnualSubscription("yearly")).toBe(true);
    expect(normalizeSubscriptionFrequency("mensual")).toBe("mensual");
    expect(normalizeSubscriptionFrequency("monthly")).toBe("mensual");
  });
});

describe("subscriptionAmountForMonth", () => {
  const entry = {
    monto_estimado: 20,
    mes_inicio: 1,
    anio_inicio: 2026,
    frecuencia: "mensual" as const,
    historial_precios: null as string | null,
  };

  it("sin historial devuelve monto_estimado", () => {
    expect(subscriptionAmountForMonth(entry, 2, 2026)).toBe(20);
  });

  it("respeta tramos de precio por mes", () => {
    const withHistory = {
      ...entry,
      historial_precios: JSON.stringify([
        { desde_mes: 1, desde_anio: 2026, monto: 10 },
        { desde_mes: 3, desde_anio: 2026, monto: 15 },
      ]),
    };
    expect(subscriptionAmountForMonth(withHistory, 2, 2026)).toBe(10);
    expect(subscriptionAmountForMonth(withHistory, 3, 2026)).toBe(15);
    expect(subscriptionAmountForMonth(withHistory, 5, 2026)).toBe(15);
  });

  it("applySubscriptionPriceChange conserva precio anterior en meses previos", () => {
    const original = { ...entry, monto_estimado: 10, historial_precios: null };
    const historial = applySubscriptionPriceChange(original, 15, 3, 2026);
    const updated = { ...original, monto_estimado: 15, historial_precios: historial };
    expect(subscriptionAmountForMonth(updated, 2, 2026)).toBe(10);
    expect(subscriptionAmountForMonth(updated, 3, 2026)).toBe(15);
    expect(subscriptionMonthlyAmount(updated, 3, 2026)).toBe(15);
  });
});
