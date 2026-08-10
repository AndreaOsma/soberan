import { useState } from "react";
import type { Property } from "../../types";
import { api } from "../../services/api";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../ModalFormError";
import { EditModalShell } from "../EditModalShell";
import { parseNum } from "../../utils/format";

const lbl = { display: "flex", flexDirection: "column" as const, gap: "0.25rem" };

interface Props { item: Property; onClose: () => void; onSaved: () => void; }

export function PropertyModal({ item, onClose, onSaved }: Props) {
  const { saving, error, run } = useAsyncSubmit();
  const [form, setForm] = useState({
    tipo: item.tipo,
    nombre: item.nombre ?? "",
    valor_estimado: String(item.valor_estimado ?? ""),
    marca: item.marca ?? "",
    modelo: item.modelo ?? "",
    anio: item.anio ? String(item.anio) : "",
    color: item.color ?? "",
    matricula: item.matricula ?? "",
    km: item.km ? String(item.km) : "",
    bastidor: item.bastidor ?? "",
    estado_notas: item.estado_notas ?? "",
  });
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));
  const isV = form.tipo === "vehiculo";

  return (
    <EditModalShell title={`Editar activo — ${item.nombre}`} onClose={onClose}>
        <ModalFormError error={error} />
        <form onSubmit={e => {
          e.preventDefault();
          void run(async () => {
            await api.updateProperty(item.id, {
            nombre: form.nombre || (isV ? `${form.marca} ${form.modelo}` : ""),
            valor_estimado: parseNum(form.valor_estimado),
            tipo: form.tipo,
            marca: isV ? form.marca : null,
            modelo: isV ? form.modelo : null,
            anio: isV && form.anio ? parseInt(form.anio) : null,
            matricula: isV ? form.matricula : null,
            bastidor: isV ? form.bastidor : null,
            color: isV ? form.color : null,
            km: isV && form.km ? parseInt(form.km) : null,
            estado_notas: isV ? form.estado_notas : null,
            valor_actualizado_en: item.valor_actualizado_en ?? null,
            });
            onSaved(); onClose();
          });
        }}>
          <label style={{ ...lbl, marginBottom: "0.75rem" }}>
            Tipo
            <select value={form.tipo} onChange={e => set("tipo", e.target.value)}>
              <option value="inmueble">Inmueble</option>
              <option value="vehiculo">Vehículo</option>
              <option value="otro">Otro</option>
            </select>
          </label>
          {!isV && <label style={{ ...lbl, marginBottom: "0.75rem" }}>Nombre<input value={form.nombre} onChange={e => set("nombre", e.target.value)} required autoFocus /></label>}
          {isV && (
            <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
              <label style={lbl}>Marca<input value={form.marca} onChange={e => set("marca", e.target.value)} autoFocus /></label>
              <label style={lbl}>Modelo<input value={form.modelo} onChange={e => set("modelo", e.target.value)} /></label>
              <label style={lbl}>Año<input type="text" inputMode="numeric" value={form.anio} onChange={e => set("anio", e.target.value)} /></label>
              <label style={lbl}>Color<input value={form.color} onChange={e => set("color", e.target.value)} /></label>
              <label style={lbl}>Matrícula<input value={form.matricula} onChange={e => set("matricula", e.target.value)} /></label>
              <label style={lbl}>Km<input type="text" inputMode="numeric" value={form.km} onChange={e => set("km", e.target.value)} /></label>
              <label style={{ ...lbl, gridColumn: "1/-1" }}>Bastidor<input value={form.bastidor} onChange={e => set("bastidor", e.target.value)} /></label>
              <label style={{ ...lbl, gridColumn: "1/-1" }}>Estado / Notas<textarea rows={2} value={form.estado_notas} onChange={e => set("estado_notas", e.target.value)} /></label>
            </div>
          )}
          <label style={{ ...lbl, marginBottom: "1rem" }}>Valor estimado (€)<input type="text" inputMode="decimal" value={form.valor_estimado} onChange={e => set("valor_estimado", e.target.value)} /></label>
          <div className="modal-actions">
            <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
    </EditModalShell>
  );
}
