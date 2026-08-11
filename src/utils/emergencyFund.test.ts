import { describe, expect, it } from "vitest";
import {
  averageNecesidadesSpending,
  buildEmergencyFundSnapshot,
  buildNecesidadesCategorySet,
  essentialMonthlyBurn,
  financialTrafficLightV2,
  profileTargetMonths,
  profileWarnMonths,
  resolveIncomeProfile,
  monthElapsedPercent,
  isCurrentCalendarMonth,
} from "./emergencyFund";
import type { RecurringEntry, Transaction } from "../types";

const necesidadesEntry: RecurringEntry = {
  id: 1,
  nombre: "Alquiler",
  monto_estimado: 800,
  es_ingreso: false,
  es_fijo: true,
  categoria: "Vivienda",
  bloque: "necesidades",
};

const deseosEntry: RecurringEntry = {
  id: 2,
  nombre: "Streaming",
  monto_estimado: 30,
  es_ingreso: false,
  es_fijo: true,
  categoria: "Ocio",
  bloque: "deseos",
};

describe("buildNecesidadesCategorySet", () => {
  it("incluye categorías de bloque necesidades", () => {
    const set = buildNecesidadesCategorySet([necesidadesEntry, deseosEntry]);
    expect(set.has("Vivienda")).toBe(true);
    expect(set.has("Ocio")).toBe(false);
  });
});

describe("averageNecesidadesSpending", () => {
  const categories = new Set(["Vivienda"]);
  const ref = new Date(2026, 6, 15); // Jul 2026

  it("promedia solo meses con movimientos en categorías necesidades", () => {
    const txs: Transaction[] = [
      { id: 1, amount: -400, category_anon: "Vivienda", description_raw: "a", date: "2026-05-10" },
      { id: 2, amount: -600, category_anon: "Vivienda", description_raw: "b", date: "2026-06-10" },
      { id: 3, amount: -200, category_anon: "Ocio", description_raw: "c", date: "2026-06-12" },
      { id: 4, amount: -500, category_anon: "Vivienda", description_raw: "d", date: "2026-07-05" },
    ];
    const { average, monthsWithData } = averageNecesidadesSpending(txs, categories, ref, 6);
    expect(monthsWithData).toBe(3);
    expect(average).toBe((400 + 600 + 500) / 3);
  });
});

describe("resolveIncomeProfile", () => {
  it("respeta setting explícito", () => {
    expect(resolveIncomeProfile("funcionario", [])).toBe("funcionario");
    expect(resolveIncomeProfile("autonomo", [])).toBe("autonomo");
  });

  it("detecta mixto con nómina y otra fuente", () => {
    const entries: RecurringEntry[] = [
      { id: 1, nombre: "Nómina Acme", monto_estimado: 2000, es_ingreso: true, es_fijo: true, categoria: "Nómina" },
      { id: 2, nombre: "Alquiler", monto_estimado: 500, es_ingreso: true, es_fijo: true, categoria: "Alquiler" },
    ];
    expect(resolveIncomeProfile("auto", entries)).toBe("mixto");
  });

  it("detecta autónomo si freelance domina", () => {
    const entries: RecurringEntry[] = [
      { id: 1, nombre: "Cliente", monto_estimado: 800, es_ingreso: true, es_fijo: true, categoria: "Freelance" },
      { id: 2, nombre: "Nómina", monto_estimado: 200, es_ingreso: true, es_fijo: true, categoria: "Nómina" },
    ];
    expect(resolveIncomeProfile("auto", entries)).toBe("autonomo");
  });
});

describe("financialTrafficLightV2", () => {
  it("óptimo con perfil funcionario a 3 meses", () => {
    expect(financialTrafficLightV2({
      efMonths: 3,
      savingsRate: 0.25,
      proj90: 1000,
      totalDebt: 0,
      totalCash: 5000,
      profile: "funcionario",
      targetSavingsPct: 20,
    })).toBe("Óptimo");
  });

  it("estable si ahorro positivo pero bajo objetivo", () => {
    expect(financialTrafficLightV2({
      efMonths: 6,
      savingsRate: 0.1,
      proj90: 1000,
      totalDebt: 0,
      totalCash: 5000,
      profile: "nomina_privada",
      targetSavingsPct: 20,
    })).toBe("Estable");
  });

  it("atención si no alcanza warn del perfil autónomo", () => {
    expect(financialTrafficLightV2({
      efMonths: 5,
      savingsRate: 0.1,
      proj90: 1000,
      totalDebt: 0,
      totalCash: 5000,
      profile: "autonomo",
    })).toBe("Atención Requerida");
    expect(profileWarnMonths("autonomo")).toBe(6);
    expect(profileTargetMonths("autonomo")).toBe(12);
  });
});

describe("monthElapsedPercent", () => {
  it("devuelve 100 para meses pasados", () => {
    expect(monthElapsedPercent(3, 2026, new Date(2026, 6, 15))).toBe(100);
  });

  it("devuelve 0 para meses futuros", () => {
    expect(monthElapsedPercent(9, 2026, new Date(2026, 6, 15))).toBe(0);
  });

  it("calcula el porcentaje en el mes actual", () => {
    const ref = new Date(2026, 6, 15);
    expect(monthElapsedPercent(7, 2026, ref)).toBe(Math.round((15 / 31) * 100));
  });
});

describe("isCurrentCalendarMonth", () => {
  it("detecta el mes calendario activo", () => {
    expect(isCurrentCalendarMonth(7, 2026, new Date(2026, 6, 10))).toBe(true);
    expect(isCurrentCalendarMonth(6, 2026, new Date(2026, 6, 10))).toBe(false);
  });
});

describe("buildEmergencyFundSnapshot", () => {
  it("suma media necesidades y deudas actuales", () => {
    const snapshot = buildEmergencyFundSnapshot({
      transactions: [
        { id: 1, amount: -300, category_anon: "Vivienda", description_raw: "x", date: "2026-07-01" },
      ],
      recurringEntries: [necesidadesEntry],
      debts: [],
      debtInstallments: [],
      month: 7,
      year: 2026,
      liquidity: 3000,
      profileSetting: "nomina_privada",
      refDate: new Date(2026, 6, 15),
    });
    expect(snapshot.avgNecesidades).toBe(300);
    expect(snapshot.currentDebt).toBe(0);
    expect(snapshot.essentialBurn).toBe(essentialMonthlyBurn(300, 0));
    expect(snapshot.efMonths).toBe(10);
    expect(snapshot.targetMonths).toBe(6);
  });
});
