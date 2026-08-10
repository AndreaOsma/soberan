import { useState } from "react";
import type { WorkHistory } from "../../types";
import { api } from "../../services/api";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../ModalFormError";
import { EditModalShell } from "../EditModalShell";
import { parseNum, toDateOnly } from "../../utils/format";
import { IrpfModelo145Modal } from "./IrpfModelo145Modal";

const lbl = { display: "flex", flexDirection: "column" as const, gap: "0.25rem" };

interface Props {
  item: WorkHistory;
  onClose: () => void;
  onSaved: () => void;
  settings: Record<string, string>;
  saveSetting: (key: string, val: string) => Promise<void>;
  formatEUR: (v: number) => string;
}

export function WorkHistoryModal({ item, onClose, onSaved, settings, saveSetting, formatEUR }: Props) {
  const { saving, error, run } = useAsyncSubmit();
  const [irpfWizardOpen, setIrpfWizardOpen] = useState(false);
  const [form, setForm] = useState({
    empresa: item.empresa,
    grupo_cotizacion: item.grupo_cotizacion ?? "",
    fecha_inicio: toDateOnly(item.fecha_inicio),
    fecha_fin: toDateOnly(item.fecha_fin),
    salario_bruto: String(item.salario_bruto ?? ""),
    periodicidad: item.periodicidad ?? "M",
    irpf_pct: String(item.irpf_pct ?? ""),
    ss_pct: String(item.ss_pct ?? ""),
  });
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));
  const bruto = parseNum(form.salario_bruto);
  const annualGross = form.periodicidad === "A" ? bruto : bruto * 14;

  return (
    <EditModalShell title={`Editar empleo — ${item.empresa}`} onClose={onClose}>
        <ModalFormError error={error} />
        <form onSubmit={e => {
          e.preventDefault();
          void run(async () => {
            await api.updateWorkHistory(item.id, {
            empresa: form.empresa,
            grupo_cotizacion: form.grupo_cotizacion,
            dias_alta: item.dias_alta,
            fecha_inicio: `${form.fecha_inicio}T00:00:00`,
            fecha_fin: form.fecha_fin ? `${form.fecha_fin}T00:00:00` : undefined,
            salario_bruto: form.salario_bruto ? parseNum(form.salario_bruto) : null,
            periodicidad: form.periodicidad,
            irpf_pct: parseNum(form.irpf_pct),
            ss_pct: parseNum(form.ss_pct),
            });
            onSaved(); onClose();
          });
        }}>
          <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
            <label style={lbl}>Empresa<input value={form.empresa} onChange={e => set("empresa", e.target.value)} required autoFocus /></label>
            <label style={lbl}>Grupo cotización<input value={form.grupo_cotizacion} onChange={e => set("grupo_cotizacion", e.target.value)} /></label>
            <label style={lbl}>Fecha inicio<input type="date" value={form.fecha_inicio} onChange={e => set("fecha_inicio", e.target.value)} /></label>
            <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "0.5rem", cursor: "pointer", gridColumn: "1/-1" }}>
              <input type="checkbox" checked={!form.fecha_fin} onChange={e => set("fecha_fin", e.target.checked ? "" : new Date().toISOString().slice(0, 10))} />
              Sigue activa
            </label>
            {form.fecha_fin && <label style={lbl}>Fecha fin<input type="date" value={form.fecha_fin} onChange={e => set("fecha_fin", e.target.value)} /></label>}
            <label style={lbl}>Salario bruto (€)<input type="text" inputMode="decimal" value={form.salario_bruto} onChange={e => set("salario_bruto", e.target.value)} /></label>
            <label style={lbl}>Salario introducido como
              <select value={form.periodicidad} onChange={e => set("periodicidad", e.target.value)}>
                <option value="M">Por mes (bruto mensual)</option>
                <option value="A">Por año (bruto anual ÷ 12)</option>
              </select>
            </label>
            <label style={lbl}>
              IRPF %
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <input type="text" inputMode="decimal" value={form.irpf_pct} onChange={e => set("irpf_pct", e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="button-secondary" style={{ whiteSpace: "nowrap" }} onClick={() => setIrpfWizardOpen(true)}>
                  Autocalcular
                </button>
              </div>
            </label>
            <label style={lbl}>SS % (empleado)<input type="text" inputMode="decimal" value={form.ss_pct} onChange={e => set("ss_pct", e.target.value)} /></label>
          </div>
          <div className="modal-actions">
            <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>

      <IrpfModelo145Modal
        isOpen={irpfWizardOpen}
        onClose={() => setIrpfWizardOpen(false)}
        jobId={item.id}
        jobLabel={item.empresa}
        defaultAnnualGross={annualGross}
        defaultSsPct={parseNum(form.ss_pct) || 6.5}
        settings={settings}
        saveSetting={saveSetting}
        formatEUR={formatEUR}
        onApply={({ irpf_pct, ss_pct, appliesToCurrentJob }) => {
          if (appliesToCurrentJob) {
            setForm((p) => ({ ...p, irpf_pct: String(irpf_pct), ss_pct: String(ss_pct) }));
          }
        }}
      />
    </EditModalShell>
  );
}
