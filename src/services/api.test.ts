import { describe, expect, it } from "vitest";
import { parseApiError, parseApiJsonBody } from "../services/api";

describe("parseApiJsonBody", () => {
  it("parsea JSON normal", () => {
    expect(parseApiJsonBody<{ status: string }>('{"status":"ok"}', 200)).toEqual({ status: "ok" });
  });

  it("acepta cuerpo vacío", () => {
    expect(parseApiJsonBody<undefined>("", 200)).toBeUndefined();
  });

  it("falla con mensaje claro si llega HTML (Safari pattern error)", () => {
    expect(() => parseApiJsonBody("<!DOCTYPE html><html></html>", 200)).toThrow(/HTML/);
  });

  it("falla con mensaje claro si el cuerpo no es JSON", () => {
    expect(() => parseApiJsonBody("OK", 200)).toThrow(/no válida/);
  });
});

describe("parseApiError", () => {
  it("lee detail de FastAPI", () => {
    expect(parseApiError('{"detail":"Transacción no encontrada"}', "fallback")).toBe(
      "Transacción no encontrada",
    );
  });
});
