import type { Goal } from "../../types";

type Props = {
  goals: Goal[];
  value: number | null | undefined;
  onChange: (goalId: number | null) => void;
  label?: string;
  className?: string;
};

export function GoalSelect({
  goals,
  value,
  onChange,
  label = "Objetivo vinculado",
  className,
}: Props) {
  return (
    <label className={className} style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      {label}
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">— Sin objetivo —</option>
        {[...goals]
          .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
          .map((g) => (
            <option key={g.id} value={g.id}>
              {g.nombre}
            </option>
          ))}
      </select>
    </label>
  );
}
