import { useState } from "react";
import type { Investment } from "../../types";
import { api } from "../../services/api";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../ModalFormError";
import { EditModalShell } from "../EditModalShell";
import { parseNum } from "../../utils/format";

const lbl = { display: "flex", flexDirection: "column" as const, gap: "0.25rem" };

interface Props { item: Investment; knownCarteras: string[]; onClose: () => void; onSaved: () => void; }

export function InvestmentModal({ item, knownCarteras, onClose, onSaved }: Props) {
  const { saving, error, run } = useAsyncSubmit();
  const [form, setForm] = useState({
    nombre: item.nombre,
    tipo: item.tipo ?? "Inv",
    cartera: item.cartera ?? "",
    monto_invertido: String(item.monto_invertido ?? ""),
    valor_actual: String(item.valor_actual ?? ""),
    fecha_inicio: item.fecha_inicio ? item.fecha_inicio.slice(0, 10) : "",
  });
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  return (
    <EditModalShell title="Editar inversión" onClose={onClose}>
        <ModalFormError error={error} />
        <form onSubmit={e => {
          e.preventDefault();
          void run(async () => {
            await api.updateInvestment(item.id, {
            nombre: form.nombre,
            tipo: form.tipo,
            cartera: form.cartera,
            monto_invertido: parseNum(form.monto_invertido),
            valor_actual: parseNum(form.valor_actual),
            fecha_inicio: form.fecha_inicio ? `${form.fecha_inicio}T00:00:00` : undefined,
            });
            onSaved(); onClose();
          });
        }}>
          <label style={{ ...lbl, marginBottom: "0.75rem" }}>Nombre<input value={form.nombre} onChange={e => set("nombre", e.target.value)} required autoFocus /></label>
          <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
            <label style={lbl}>Tipo
              <select value={form.tipo} onChange={e => set("tipo", e.target.value)}>
                <option value="fondo">Fondo indexado</option>
                <option value="ETF">ETF</option>
                <option value="accion">Acciones</option>
                <option value="crypto">Cripto</option>
                <option value="pension">Pensión / Seguro</option>
                <option value="deuda">Renta fija</option>
                <option value="Inv">General</option>
              </select>
            </label>
            <label style={lbl}>
              Cartera
              <input list="edit-cartera-list" value={form.cartera} placeholder="ej. MyInvestor, DEGIRO…" onChange={e => set("cartera", e.target.value)} />
              <datalist id="edit-cartera-list">
                {knownCarteras.map(c => <option key={c} value={c} />)}
              </datalist>
            </label>
          </div>
          <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "1rem" }}>
            <label style={lbl}>Monto invertido<input type="text" inputMode="decimal" value={form.monto_invertido} onChange={e => set("monto_invertido", e.target.value)} /></label>
            <label style={lbl}>Valor actual<input type="text" inputMode="decimal" value={form.valor_actual} onChange={e => set("valor_actual", e.target.value)} /></label>
            <label style={lbl}>Fecha inicio<input type="date" value={form.fecha_inicio} onChange={e => set("fecha_inicio", e.target.value)} /></label>
          </div>
          <div className="modal-actions">
            <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
    </EditModalShell>
  );
}
