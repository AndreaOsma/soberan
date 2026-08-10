import { useState } from "react";
import type { MoneyOwed } from "../../types";
import { api } from "../../services/api";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../ModalFormError";
import { EditModalShell } from "../EditModalShell";
import { parseNum, toDateOnly } from "../../utils/format";

const lbl = { display: "flex", flexDirection: "column" as const, gap: "0.25rem" };

interface Props { item: MoneyOwed; onClose: () => void; onSaved: () => void; }

export function MoneyOwedModal({ item, onClose, onSaved }: Props) {
  const { saving, error, run } = useAsyncSubmit();
  const [form, setForm] = useState({
    deudor: item.deudor,
    monto: String(item.monto ?? ""),
    descripcion: item.descripcion ?? "",
    pagado: item.pagado,
    tasa_anual: String(item.tasa_anual ?? ""),
    fecha_inicio: toDateOnly(item.fecha_inicio),
  });
  const set = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  return (
    <EditModalShell title={`Editar préstamo — ${item.deudor}`} onClose={onClose}>
        <ModalFormError error={error} />
        <form onSubmit={e => {
          e.preventDefault();
          void run(async () => {
            await api.updateMoneyOwed(item.id, {
            deudor: form.deudor,
            monto: parseNum(form.monto),
            descripcion: form.descripcion,
            pagado: form.pagado,
            tasa_anual: form.tasa_anual ? parseNum(form.tasa_anual) : null,
            fecha_inicio: form.fecha_inicio || null,
            });
            onSaved(); onClose();
          });
        }}>
          <label style={{ ...lbl, marginBottom: "0.75rem" }}>Deudor<input value={form.deudor} onChange={e => set("deudor", e.target.value)} required autoFocus /></label>
          <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
            <label style={lbl}>Monto (€)<input type="text" inputMode="decimal" value={form.monto} onChange={e => set("monto", e.target.value)} /></label>
            <label style={lbl}>Estado
              <select value={form.pagado ? "true" : "false"} onChange={e => set("pagado", e.target.value === "true")}>
                <option value="false">Pendiente</option>
                <option value="true">Cobrado</option>
              </select>
            </label>
            <label style={lbl}>Interés TAE (%)<input type="text" inputMode="decimal" value={form.tasa_anual} onChange={e => set("tasa_anual", e.target.value)} placeholder="ej. 5" /></label>
            <label style={lbl}>Fecha préstamo<input type="date" value={form.fecha_inicio} onChange={e => set("fecha_inicio", e.target.value)} /></label>
          </div>
          <label style={{ ...lbl, marginBottom: "1rem" }}>Descripción<input value={form.descripcion} onChange={e => set("descripcion", e.target.value)} /></label>
          <div className="modal-actions">
            <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
    </EditModalShell>
  );
}
