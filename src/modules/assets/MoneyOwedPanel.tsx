import { useState } from "react";
import { api } from "../../services/api";
import { GlassModal } from "../../components/GlassModal";
import { MoneyOwedModal } from "../../components/modals/MoneyOwedModal";
import type { MoneyOwed } from "../../types";
import { parseNum } from "../../utils/format";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../../components/ModalFormError";

export type MoneyOwedPanelProps = {
  moneyOwed: MoneyOwed[];
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  deleteWithUndo: (label: string, onCommit: () => Promise<void>) => void;
};

export function MoneyOwedPanel({
  moneyOwed, formatEUR, addToast, loadAll, deleteWithUndo,
}: MoneyOwedPanelProps) {
  const [isOwedFormOpen, setIsOwedFormOpen] = useState(false);
  const [owedForm, setOwedForm] = useState({ deudor: "", monto: 0, descripcion: "P", pagado: false, tasa_anual: 0, fecha_inicio: "" });
  const [editOwedModal, setEditOwedModal] = useState<MoneyOwed | null>(null);
  const createSubmit = useAsyncSubmit();

  const pendingOwed = moneyOwed.filter(o => !o.pagado);
  const totalOwed = pendingOwed.reduce((s, o) => {
    if (!o.tasa_anual || !o.fecha_inicio) return s + o.monto;
    const years = (Date.now() - new Date(o.fecha_inicio).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    return s + o.monto * (1 + (o.tasa_anual / 100) * Math.max(0, years));
  }, 0);
  return (
    <>
      <section className="grid one-col">
        <article className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2>Me deben</h2>
            <div className="inline-actions">
              {pendingOwed.length > 0 && <span className="sensitive" style={{ fontSize: "0.9rem" }}>{formatEUR(totalOwed)}</span>}
              <button onClick={() => setIsOwedFormOpen(true)}>+ Nuevo préstamo</button>
            </div>
          </div>
          {moneyOwed.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🤝</div>
              <h3>Sin préstamos a terceros</h3>
              <p>Registra aquí el dinero que otros te deben para no perder el control.</p>
              <button onClick={() => setIsOwedFormOpen(true)}>+ Añadir registro</button>
            </div>
          ) : (
            <ul className="list">
              {moneyOwed.map((item) => {
                const hasInterest = item.tasa_anual && item.fecha_inicio;
                const years = hasInterest ? (Date.now() - new Date(item.fecha_inicio!).getTime()) / (1000 * 60 * 60 * 24 * 365.25) : 0;
                const accrued = hasInterest ? item.monto * (item.tasa_anual! / 100) * Math.max(0, years) : 0;
                const totalItem = item.monto + accrued;
                return (
                  <li key={item.id} style={{ opacity: item.pagado ? 0.5 : 1 }}>
                    <div>
                      <span>{item.deudor}</span>
                      {item.descripcion && item.descripcion !== "P" && <small className="muted" style={{ marginLeft: "0.5rem" }}>— {item.descripcion}</small>}
                      {item.pagado && <small className="muted" style={{ marginLeft: "0.5rem" }}>· cobrado</small>}
                    </div>
                    <div className="inline-actions">
                      <div style={{ textAlign: "right" }}>
                        <strong className="sensitive">{formatEUR(item.monto)}</strong>
                        {hasInterest && (
                          <div style={{ fontSize: "0.75rem" }} className="muted">
                            {item.tasa_anual}% TAE · total {formatEUR(totalItem)}
                          </div>
                        )}
                      </div>
                      <button type="button" className="button-secondary" style={{ padding: "0.25rem 0.5rem" }}
                        aria-label={`Editar préstamo ${item.deudor}`} title="Editar"
                        onClick={() => setEditOwedModal(item)}>✎</button>
                      <button type="button" className="danger"
                        aria-label={`Eliminar préstamo ${item.deudor}`} title="Eliminar"
                        onClick={() => deleteWithUndo("Registro", () => api.deleteMoneyOwed(item.id).then(() => loadAll()))}>
                        🗑
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      </section>

      {editOwedModal && <MoneyOwedModal item={editOwedModal} onClose={() => setEditOwedModal(null)} onSaved={loadAll} />}

      <GlassModal isOpen={isOwedFormOpen} onClose={() => setIsOwedFormOpen(false)} title="Nuevo préstamo a terceros">
        <ModalFormError error={createSubmit.error} />
        <form onSubmit={(e) => {
          e.preventDefault();
          void createSubmit.run(async () => {
            await api.createMoneyOwed({
              ...owedForm,
              tasa_anual: owedForm.tasa_anual || null,
              fecha_inicio: owedForm.fecha_inicio || null,
            });
            setOwedForm({ deudor: "", monto: 0, descripcion: "P", pagado: false, tasa_anual: 0, fecha_inicio: "" });
            setIsOwedFormOpen(false);
            addToast("Registro creado.", "success");
            await loadAll({ silent: true });
          });
        }}>
          <label>Deudor<input value={owedForm.deudor} onChange={e => setOwedForm(p => ({ ...p, deudor: e.target.value }))} required autoFocus /></label>
          <div className="grid two-col" style={{ gap: "0.75rem", marginTop: "0.75rem" }}>
            <label>Monto (€)<input type="number" step="0.01" value={owedForm.monto || ""} onChange={e => setOwedForm(p => ({ ...p, monto: parseNum(e.target.value) }))} /></label>
            <label>Descripción<input value={owedForm.descripcion === "P" ? "" : owedForm.descripcion} placeholder="Descripción" onChange={e => setOwedForm(p => ({ ...p, descripcion: e.target.value || "P" }))} /></label>
            <label>Interés TAE (%)<input type="number" step="0.01" value={owedForm.tasa_anual || ""} onChange={e => setOwedForm(p => ({ ...p, tasa_anual: parseNum(e.target.value) }))} placeholder="ej. 5" /></label>
            <label>Fecha préstamo<input type="date" value={owedForm.fecha_inicio} onChange={e => setOwedForm(p => ({ ...p, fecha_inicio: e.target.value }))} /></label>
          </div>
          <div className="modal-actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="button-secondary" onClick={() => setIsOwedFormOpen(false)}>Cancelar</button>
            <button type="submit" disabled={createSubmit.saving}>{createSubmit.saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      </GlassModal>

      </>
    );
}
