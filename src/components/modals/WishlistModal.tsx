import { useState } from "react";
import type { WishlistItem } from "../../types";
import { api } from "../../services/api";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../ModalFormError";
import { EditModalShell } from "../EditModalShell";
import { parseNum } from "../../utils/format";

const lbl = { display: "flex", flexDirection: "column" as const, gap: "0.25rem" };

interface Props { item: WishlistItem; onClose: () => void; onSaved: () => void; }

export function WishlistModal({ item, onClose, onSaved }: Props) {
  const { saving, error, run } = useAsyncSubmit();
  const [form, setForm] = useState({
    nombre: item.nombre,
    monto_estimado: item.monto_estimado != null ? String(item.monto_estimado) : "",
    prioridad: item.prioridad as "baja" | "media" | "alta",
    notas: item.notas ?? "",
    url: item.url ?? "",
  });
  const set = (k: string, v: string | boolean) => setForm(p => ({ ...p, [k]: v }));

  return (
    <EditModalShell title="Editar deseo" onClose={onClose}>
        <ModalFormError error={error} />
        <form onSubmit={e => {
          e.preventDefault();
          void run(async () => {
            await api.updateWishlistItem(item.id, {
            nombre: form.nombre,
            monto_estimado: form.monto_estimado ? parseNum(form.monto_estimado) : null,
            prioridad: form.prioridad,
            notas: form.notas || null,
            url: form.url || null,
            comprado: item.comprado,
            archivado: item.archivado ?? item.comprado,
            recurring_entry_id: item.recurring_entry_id ?? null,
            monto_real: item.monto_real ?? null,
            fecha_compra: item.fecha_compra ?? null,
            transaction_id: item.transaction_id ?? null,
            });
            onSaved(); onClose();
          });
        }}>
          <label style={{ ...lbl, marginBottom: "0.75rem" }}>
            Nombre<input value={form.nombre} onChange={e => set("nombre", e.target.value)} required autoFocus />
          </label>
          <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
            <label style={lbl}>
              Precio estimado (€)
              <input type="text" inputMode="decimal" value={form.monto_estimado} onChange={e => set("monto_estimado", e.target.value)} placeholder="Opcional" />
            </label>
            <label style={lbl}>
              Prioridad
              <select value={form.prioridad} onChange={e => setForm(p => ({ ...p, prioridad: e.target.value as "baja" | "media" | "alta" }))}>
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
            </label>
          </div>
          <label style={{ ...lbl, marginBottom: "0.75rem" }}>
            Enlace (URL)
            <input type="text" inputMode="url" autoComplete="url" value={form.url} onChange={e => set("url", e.target.value)} placeholder="Opcional" />
          </label>
          <label style={{ ...lbl, marginBottom: "0.75rem" }}>
            Notas
            <textarea value={form.notas} onChange={e => set("notas", e.target.value)} rows={2} placeholder="Opcional" style={{ resize: "vertical" }} />
          </label>
          <div className="modal-actions">
            <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
    </EditModalShell>
  );
}
