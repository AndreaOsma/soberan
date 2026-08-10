import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCENT,
  buildThemeFromAccent,
  normalizeHex,
  resolveAccentFromSettings,
} from "./accentTheme";

describe("accentTheme", () => {
  it("normalizes hex colors", () => {
    expect(normalizeHex("#2563EB")).toBe("#2563eb");
    expect(normalizeHex("059669")).toBe("#059669");
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("nope")).toBeNull();
  });

  it("builds primary/accent/gradient from accent", () => {
    const theme = buildThemeFromAccent("#2563eb");
    expect(theme.primary).toBe("#2563eb");
    expect(theme.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.accent).not.toBe(theme.primary);
    expect(theme.gradient).toContain(theme.primary);
  });

  it("resolves stored accent or legacy theme name", () => {
    expect(resolveAccentFromSettings({ theme_accent: "#b22a4f" })).toBe("#b22a4f");
    expect(resolveAccentFromSettings({ theme_name: "Emerald Garden" })).toBe("#059669");
    expect(resolveAccentFromSettings({})).toBe(DEFAULT_ACCENT);
  });
});
