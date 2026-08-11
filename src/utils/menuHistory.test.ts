import { describe, expect, it } from "vitest";
import { isMenuKey, menuUrl, parseMenuFromSearch } from "./menuHistory";

describe("menuHistory", () => {
  it("parsea ?menu= válido", () => {
    expect(parseMenuFromSearch("?menu=Presupuesto")).toBe("Presupuesto");
    expect(parseMenuFromSearch("?menu=NoExiste")).toBeNull();
  });

  it("isMenuKey valida claves", () => {
    expect(isMenuKey("Cuentas")).toBe(true);
    expect(isMenuKey("foo")).toBe(false);
  });

  it("menuUrl omite menu en Resumen Ejecutivo", () => {
    expect(menuUrl("Resumen Ejecutivo", "https://soberan.test/")).toBe("/");
    expect(menuUrl("Pasivos", "https://soberan.test/")).toBe("/?menu=Pasivos");
  });
});
