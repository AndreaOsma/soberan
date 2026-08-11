import { describe, expect, it } from "vitest";
import { alertActionFor } from "./alertActions";

describe("alertActionFor", () => {
  it("mapea cada tipo conocido a menú y CTA", () => {
    expect(alertActionFor("riesgo_liquidez")).toEqual({ label: "Revisar cuenta", menu: "Cuentas" });
    expect(alertActionFor("objetivo_proximo")).toEqual({ label: "Ver objetivo", menu: "Objetivos" });
    expect(alertActionFor("desviacion_presupuestaria")).toEqual({
      label: "Ajustar presupuesto",
      menu: "Presupuesto",
    });
    expect(alertActionFor("anomalia_duplicidad")).toEqual({
      label: "Revisar movimientos",
      menu: "Transacciones",
    });
    expect(alertActionFor("calidad_datos")).toEqual({ label: "Categorizar", menu: "Transacciones" });
    expect(alertActionFor("deuda_vencida")).toEqual({ label: "Mover pago", menu: "Pasivos" });
    expect(alertActionFor("dti_elevado")).toEqual({ label: "Revisar deudas", menu: "Pasivos" });
    expect(alertActionFor("sepe_renovacion")).toEqual({
      label: "Historial laboral",
      menu: "Historial Laboral",
    });
    expect(alertActionFor("irpf_retencion_desviada")).toEqual({
      label: "Ver IRPF",
      menu: "Impuestos",
    });
  });

  it("usa fallback para tipo desconocido o vacío", () => {
    expect(alertActionFor("desconocido")).toEqual({ label: "Ir a Inicio", menu: "Resumen Ejecutivo" });
    expect(alertActionFor("")).toEqual({ label: "Ir a Inicio", menu: "Resumen Ejecutivo" });
    expect(alertActionFor(null)).toEqual({ label: "Ir a Inicio", menu: "Resumen Ejecutivo" });
    expect(alertActionFor(undefined)).toEqual({ label: "Ir a Inicio", menu: "Resumen Ejecutivo" });
  });
});
