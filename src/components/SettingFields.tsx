import { useEffect, useRef, useState } from "react";
import { toDateOnly } from "../utils/format";

type Props = {
  label: string;
  settingKey: string;
  value: string;
  type?: "text" | "password" | "date";
  placeholder?: string;
  onSave: (key: string, value: string) => Promise<void>;
};

function normalizeFieldValue(type: Props["type"], value: string): string {
  return type === "date" ? toDateOnly(value) : value;
}

export function SettingTextField({ label, settingKey, value, type = "text", placeholder, onSave }: Props) {
  const safeValue = normalizeFieldValue(type, value);
  const [draft, setDraft] = useState(safeValue);
  useEffect(() => setDraft(safeValue), [safeValue]);

  return (
    <label>
      {label}
      <input
        type={type}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = normalizeFieldValue(type, draft);
          if (next !== safeValue) void onSave(settingKey, next);
        }}
      />
    </label>
  );
}

type SliderProps = {
  label: string;
  settingKey: string;
  value: string;
  min: number;
  max: number;
  onSave: (key: string, value: string) => Promise<void>;
};

export function SettingSliderField({ label, settingKey, value, min, max, onSave }: SliderProps) {
  const [draft, setDraft] = useState(Number(value) || min);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => setDraft(Number(value) || min), [value, min]);

  return (
    <label>
      {label}
      <input
        type="range"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => {
          const next = Number(e.target.value) || min;
          setDraft(next);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => void onSave(settingKey, String(next)), 600);
        }}
      />
    </label>
  );
}
