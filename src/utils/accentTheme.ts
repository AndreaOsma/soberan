/** Default contrast / primary color (legacy "Soberan Blue"). */
export const DEFAULT_ACCENT = "#2563eb";

/** Map old named themes → primary hex for one-time settings migration. */
export const LEGACY_THEME_PRIMARIES: Record<string, string> = {
  "Soberan Blue": "#2563eb",
  "Emerald Garden": "#059669",
  "Sunset Gold": "#d97706",
  "Lavender Dream": "#8b5cf6",
  "Midnight Slate": "#475569",
  "Dark Mode": "#3b82f6",
  "Music Studio Noir": "#b22a4f",
};

export type AccentThemeVars = {
  primary: string;
  accent: string;
  gradient: string;
};

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function normalizeHex(input: string): string | null {
  const raw = input.trim();
  const short = raw.match(/^#?([0-9a-fA-F]{3})$/);
  if (short) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const full = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (!full) return null;
  return `#${full[1].toLowerCase()}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeHex(hex) ?? DEFAULT_ACCENT;
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clampByte(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Mix color toward white (t=0 keeps color, t=1 → white). */
function lighten(hex: string, t: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}

/** Mix color toward black. */
function darken(hex: string, t: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - t), g * (1 - t), b * (1 - t));
}

export function buildThemeFromAccent(primaryInput: string): AccentThemeVars {
  const primary = normalizeHex(primaryInput) ?? DEFAULT_ACCENT;
  const accent = lighten(primary, 0.38);
  const deep = darken(primary, 0.18);
  return {
    primary,
    accent,
    gradient: `linear-gradient(135deg, ${primary} 0%, ${deep} 100%)`,
  };
}

export function resolveAccentFromSettings(settings: Record<string, string>): string {
  const stored = normalizeHex(settings.theme_accent || "");
  if (stored) return stored;
  const legacyName = settings.theme_name || "";
  if (legacyName && LEGACY_THEME_PRIMARIES[legacyName]) {
    return LEGACY_THEME_PRIMARIES[legacyName];
  }
  return DEFAULT_ACCENT;
}
