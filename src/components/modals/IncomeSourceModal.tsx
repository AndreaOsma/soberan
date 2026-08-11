import { useState } from "react";
import type { RecurringEntry } from "../../types";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../ModalFormError";
import { EditModalShell } from "../EditModalShell";

export const INCOME_CATS = [
  "Nómina",
  "Freelance",
  "Alquiler",
  "Dividendos",
  "Intereses",
  "Prestación",
  "Subvención",
  "Venta de activo",
  "Reembolso",
  "Regalo",
  "Devolución Hacienda",
  "Otros",
] as const;

const lbl = { display: "flex", flexDirection: "column" as const, gap: "0.25rem" };

interface Props {
  item?: RecurringEntry;
  month?: number;
  year?: number;
  excludeCategories?: string[];
  onClose: () => void;
  onSave: (payload: Omit<RecurringEntry, "id">) => Promise<void>;
}

export function IncomeSourceModal({ item, month, year, excludeCategories = [], onClose, onSave }: Props) {
  const { saving, error, run } = useAsyncSubmit();
  const [form, setForm] = useState({
    nombre: item?.nombre ?? "",
    monto_estimado: String(item?.monto_estimado ?? ""),
    categoria: item?.categoria ?? "Otros",
    es_fijo: item?.es_fijo ?? true,
    empresa: item?.empresa ?? "",
  });
  const set = (k: string, v: string | boolean) => setForm(p => ({ ...p, [k]: v }));

  return (
    <EditModalShell title={item ? "Editar ingreso" : "Nueva fuente de ingreso"} onClose={onClose}>
        <ModalFormError error={error} />
        <form onSubmit={e => {
          e.preventDefault();
          void run(async () => {
            await onSave({
            nombre: form.nombre,
            monto_estimado: parseFloat(form.monto_estimado.replace(",", ".")) || 0,
            es_ingreso: true,
            es_fijo: form.es_fijo,
            categoria: form.categoria,
            empresa: form.empresa || null,
            tipo_partida: null,
            cuenta_destino_id: null,
            cartera_destino: null,
            bloque: null,
            objetivo_monto: null,
            objetivo_fecha: null,
            mes_inicio: month ?? null,
            anio_inicio: year ?? null,
            es_puntual: false,
            es_fondo: false,
            frecuencia: null,
            fecha_pago: null,
            mes_cobro: null,
            meses_excluidos: null,
            });
            onClose();
          });
        }}>
          <label style={{ ...lbl, marginBottom: "0.75rem" }}>
            Nombre / descripción
            <input value={form.nombre} onChange={e => set("nombre", e.target.value)} required autoFocus placeholder="ej. Alquiler piso, Cliente X, Dividendo VOO…" />
          </label>
          <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
            <label style={lbl}>
              Importe mensual estimado (€)
              <input type="text" inputMode="decimal" value={form.monto_estimado} onChange={e => set("monto_estimado", e.target.value)} required />
            </label>
            <label style={lbl}>
              Categoría
              <select value={form.categoria} onChange={e => set("categoria", e.target.value)}>
                {INCOME_CATS.filter(c => !excludeCategories.includes(c)).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <label style={{ ...lbl, marginBottom: "0.75rem" }}>
            Empresa / fuente (opcional)
            <input value={form.empresa} onChange={e => set("empresa", e.target.value)} placeholder="ej. empresa, plataforma, banco…" />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", cursor: "pointer" }}>
            <input type="checkbox" checked={form.es_fijo} onChange={e => set("es_fijo", e.target.checked)} />
            Ingreso fijo (se repite todos los meses)
          </label>
          <div className="modal-actions">
            <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
    </EditModalShell>
  );
}
