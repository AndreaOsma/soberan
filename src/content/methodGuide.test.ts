import { describe, expect, it } from "vitest";
import { METHOD_CYCLE_STEPS, METHOD_SECTIONS, METHOD_TIPS } from "../content/methodGuide";

describe("methodGuide", () => {
  it("expone ciclo, secciones y consejos", () => {
    expect(METHOD_CYCLE_STEPS).toHaveLength(4);
    expect(METHOD_SECTIONS.length).toBeGreaterThanOrEqual(3);
    expect(METHOD_TIPS.length).toBeGreaterThanOrEqual(3);
  });
});
