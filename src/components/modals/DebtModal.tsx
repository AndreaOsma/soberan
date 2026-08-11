import { useState } from "react";
import type { Debt, Goal } from "../../types";
import { api } from "../../services/api";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../ModalFormError";
import { EditModalShell } from "../EditModalShell";
import { parseNum } from "../../utils/format";
import { DEBT_TIPO_OPTIONS, clampDebtChargeDay } from "../../utils/debtInstallments";
import { GoalSelect } from "../goals/GoalSelect";

const lbl = { display: "flex", flexDirection: "column" as const, gap: "0.25rem" };

interface Props { item: Debt; goals: Goal[]; onClose: () => void; onSaved: () => void; }

export function DebtModal({ item, goals, onClose, onSaved }: Props) {
  const { saving, error, run } = useAsyncSubmit();
  const [form, setForm] = useState({
    nombre: item.nombre ?? "",
    acreedor: item.acreedor,
    monto_total: String(item.monto_total ?? ""),
    tipo: item.tipo ?? "Préstamo personal",
    cuota_mensual: String(item.cuota_mensual ?? ""),
    tasa_anual: String(item.tasa_anual ?? ""),
    notas: item.notas ?? "",
    dia_cargo_mensual: String(item.dia_cargo_mensual ?? ""),
    goal_id: item.goal_id ?? null as number | null,
  });
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <EditModalShell title={`Editar deuda — ${item.nombre || item.acreedor}`} onClose={onClose}>
        <ModalFormError error={error} />
        <form onSubmit={e => {
          e.preventDefault();
          void run(async () => {
            const total = parseNum(form.monto_total);
            if (total <= 0) throw new Error("El importe total debe ser mayor que 0.");
            if (total < item.monto_pagado) {
              throw new Error("El total no puede ser menor que lo ya pagado. Ajusta los pagos reales primero.");
            }
            const diaRaw = form.dia_cargo_mensual.trim()
              ? parseInt(form.dia_cargo_mensual, 10) || parseNum(form.dia_cargo_mensual)
              : 0;
            if (diaRaw > 31) throw new Error("El día de cargo debe estar entre 1 y 31.");
            const dia = diaRaw > 0 ? clampDebtChargeDay(diaRaw) : null;
            await api.updateDebt(item.id, {
            nombre: form.nombre || null,
            acreedor: form.acreedor,
            monto_total: total,
            monto_pagado: item.monto_pagado,
            tipo: form.tipo,
            fecha_vencimiento: item.fecha_vencimiento ?? null,
            cuota_mensual: form.cuota_mensual ? parseNum(form.cuota_mensual) : null,
            tasa_anual: form.tasa_anual ? parseNum(form.tasa_anual) : null,
            notas: form.notas,
            dia_cargo_mensual: dia,
            goal_id: form.goal_id,
            });
            onSaved(); onClose();
          });
        }}>
          <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
            <label style={lbl}>Nombre<input value={form.nombre} onChange={e => set("nombre", e.target.value)} placeholder="Ej: Coche Suzuki" autoFocus /></label>
            <label style={lbl}>Acreedor<input value={form.acreedor} onChange={e => set("acreedor", e.target.value)} required placeholder="Ej: Santander" /></label>
            <label style={lbl}>Total (€)<input type="text" inputMode="decimal" value={form.monto_total} onChange={e => set("monto_total", e.target.value)} /></label>
            {item.monto_pagado > 0 && (
              <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>
                Pagado: {new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(item.monto_pagado)}
                {" "}(se gestiona en Pagos reales)
              </p>
            )}
            <label style={lbl}>Cuota mensual (€)<input type="text" inputMode="decimal" value={form.cuota_mensual} onChange={e => set("cuota_mensual", e.target.value)} /></label>
            <label style={lbl}>TAE (%)<input type="text" inputMode="decimal" value={form.tasa_anual} onChange={e => set("tasa_anual", e.target.value)} /></label>
            <label style={lbl}>Tipo
              <select value={form.tipo} onChange={e => set("tipo", e.target.value)}>
                {DEBT_TIPO_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label style={lbl}>Día cargo (1–31)<input type="text" inputMode="numeric" value={form.dia_cargo_mensual} onChange={e => set("dia_cargo_mensual", e.target.value)} /></label>
            {item.fecha_vencimiento && (
              <p className="muted" style={{ fontSize: "0.82rem", margin: 0, gridColumn: "1/-1" }}>
                Vencimiento: {new Date(item.fecha_vencimiento.slice(0, 10) + "T12:00:00").toLocaleDateString("es-ES")}
                {" "}(desde planilla)
              </p>
            )}
            <GoalSelect
              goals={goals}
              value={form.goal_id}
              onChange={(goal_id) => setForm((p) => ({ ...p, goal_id }))}
              label="Objetivo vinculado (opcional)"
              className=""
            />
            <label style={{ ...lbl, gridColumn: "1/-1" }}>Notas<input value={form.notas} onChange={e => set("notas", e.target.value)} /></label>
          </div>
          <div className="modal-actions">
            <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
    </EditModalShell>
  );
}
