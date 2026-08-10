import { describe, expect, it } from "vitest";
import type { RecurringEntry } from "../types";
import { entryAssignedAmount, hasNonAmountStructuralChanges } from "./budgetEntryScope";

const entry: RecurringEntry = {
  id: 1,
  nombre: "Netflix",
  monto_estimado: 15,
  es_ingreso: false,
  es_fijo: true,
  categoria: "Suscripciones",
  tipo_partida: "suscripcion",
};

describe("budgetEntryScope", () => {
  it("usa override mensual si existe", () => {
    expect(entryAssignedAmount(entry, { 1: 9.5 }, 3, 2026)).toBe(9.5);
  });

  it("detecta cambios distintos al importe", () => {
    expect(hasNonAmountStructuralChanges(entry, {
      nombre: "Netflix",
      categoria: "Suscripciones",
      monto_estimado: 15,
      es_fijo: true,
      tipo_partida: "suscripcion",
      bloque: "",
      goal_id: null,
      es_puntual: false,
      es_fondo: false,
      cuenta_destino_id: "",
      cartera_destino: "",
      objetivo_monto: "",
      objetivo_fecha: "",
      frecuencia: "mensual",
      fecha_pago: 1,
      mes_cobro: 1,
    })).toBe(false);

    expect(hasNonAmountStructuralChanges(entry, {
      nombre: "Netflix Premium",
      categoria: "Suscripciones",
      monto_estimado: 15,
      es_fijo: true,
      tipo_partida: "suscripcion",
      bloque: "",
      goal_id: null,
      es_puntual: false,
      es_fondo: false,
      cuenta_destino_id: "",
      cartera_destino: "",
      objetivo_monto: "",
      objetivo_fecha: "",
      frecuencia: "mensual",
      fecha_pago: 1,
      mes_cobro: 1,
    })).toBe(true);
  });
});
