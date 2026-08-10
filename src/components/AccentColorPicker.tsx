import { useEffect, useRef, useState } from "react";
import { DEFAULT_ACCENT, normalizeHex } from "../utils/accentTheme";

type Props = {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
  hint?: string;
};

export function AccentColorPicker({
  value,
  onChange,
  label = "Color de contraste",
  hint = "Se usa en botones, focos y acentos. El modo claro/oscuro se elige arriba en la barra.",
}: Props) {
  const initial = normalizeHex(value) ?? DEFAULT_ACCENT;
  const [hex, setHex] = useState(initial);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const next = normalizeHex(value) ?? DEFAULT_ACCENT;
    setHex(next);
  }, [value]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function commit(nextRaw: string, immediate = false) {
    const next = normalizeHex(nextRaw);
    if (!next) return;
    setHex(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (immediate) {
      onChange(next);
      return;
    }
    debounceRef.current = setTimeout(() => onChange(next), 180);
  }

  return (
    <div className="accent-picker">
      <span className="accent-picker__label">{label}</span>
      <div className="accent-picker__row">
        <label className="accent-picker__wheel-wrap" title="Abrir rueda de color">
          <span className="sr-only">Rueda de color</span>
          <input
            type="color"
            className="accent-picker__wheel"
            value={hex}
            onChange={(e) => commit(e.target.value)}
            onBlur={(e) => commit(e.target.value, true)}
            aria-label={label}
          />
        </label>
        <input
          type="text"
          className="accent-picker__hex"
          value={hex}
          spellCheck={false}
          autoComplete="off"
          inputMode="text"
          aria-label="Código hexadecimal del color"
          onChange={(e) => {
            const raw = e.target.value;
            setHex(raw.startsWith("#") ? raw : `#${raw}`);
            const normalized = normalizeHex(raw);
            if (normalized) commit(normalized);
          }}
          onBlur={() => {
            const normalized = normalizeHex(hex) ?? DEFAULT_ACCENT;
            setHex(normalized);
            onChange(normalized);
          }}
        />
        <span className="accent-picker__swatch" style={{ background: hex }} aria-hidden />
      </div>
      {hint ? <p className="muted accent-picker__hint">{hint}</p> : null}
    </div>
  );
}
