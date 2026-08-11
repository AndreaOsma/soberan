import { useState } from "react";
import type { Card } from "../../types";
import { api } from "../../services/api";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../ModalFormError";
import { EditModalShell } from "../EditModalShell";
import { parseNum } from "../../utils/format";

const lbl = { display: "flex", flexDirection: "column" as const, gap: "0.25rem" };

interface Props { item: Card; onClose: () => void; onSaved: () => void; }

export function CardModal({ item, onClose, onSaved }: Props) {
  const { saving, error, run } = useAsyncSubmit();
  const [form, setForm] = useState({
    nombre: item.nombre,
    tipo: item.tipo,
    banco: item.banco ?? "",
    limite: String(item.limite ?? ""),
  });
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <EditModalShell title={`Editar tarjeta — ${item.nombre}`} onClose={onClose}>
        <ModalFormError error={error} />
        <form onSubmit={e => {
          e.preventDefault();
          void run(async () => {
            const limite = parseNum(form.limite);
            await api.updateCard(item.id, { ...form, limite: limite > 0 ? limite : undefined });
            onSaved(); onClose();
          });
        }}>
          <label style={{ ...lbl, marginBottom: "0.75rem" }}>Nombre<input value={form.nombre} onChange={e => set("nombre", e.target.value)} required autoFocus /></label>
          <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
            <label style={lbl}>Tipo
              <select value={form.tipo} onChange={e => set("tipo", e.target.value)}>
                <option value="D">Débito</option>
                <option value="C">Crédito</option>
              </select>
            </label>
            <label style={lbl}>Banco<input value={form.banco} onChange={e => set("banco", e.target.value)} /></label>
            <label style={lbl}>Límite (€)<input type="text" inputMode="decimal" value={form.limite} onChange={e => set("limite", e.target.value)} /></label>
          </div>
          <div className="modal-actions">
            <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
    </EditModalShell>
  );
}
