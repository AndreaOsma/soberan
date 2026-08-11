import { useState } from "react";
import type { Account, Goal, Investment } from "../../types";
import { api } from "../../services/api";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../ModalFormError";
import { EditModalShell } from "../EditModalShell";
import { parseNum } from "../../utils/format";
import { carteraTotal, goalCurrentAmount } from "../../utils/goalProgress";

const lbl = "modal-field";

interface Props { item: Goal; accounts: Account[]; investments: Investment[]; onClose: () => void; onSaved: () => void; }

export function GoalModal({ item, accounts, investments, onClose, onSaved }: Props) {
  const { saving, error, run } = useAsyncSubmit();
  const [form, setForm] = useState({
    nombre: item.nombre,
    monto_objetivo: String(item.monto_objetivo ?? ""),
    fecha_limite: item.fecha_limite?.slice(0, 10) ?? "",
    account_id: item.account_id ? String(item.account_id) : "",
    cartera_destino: item.cartera_destino ?? "",
  });
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const carteras = [...new Set(investments.map(i => (i.cartera || "").trim()).filter(Boolean))].sort();
  const linkedPreview = form.account_id
    ? accounts.find(a => a.id === Number(form.account_id))
    : form.cartera_destino
      ? carteraTotal(investments, form.cartera_destino)
      : null;

  return (
    <EditModalShell title="Editar meta" onClose={onClose}>
        <ModalFormError error={error} />
        <form onSubmit={e => {
          e.preventDefault();
          void run(async () => {
            if (form.account_id && form.cartera_destino) {
              throw new Error("Elige solo cuenta o cartera, no ambas.");
            }
            const draft: Goal = {
              ...item,
              account_id: form.account_id ? Number(form.account_id) : null,
              cartera_destino: form.cartera_destino || null,
            };
            await api.updateGoal(item.id, {
            nombre: form.nombre,
            monto_objetivo: parseNum(form.monto_objetivo),
            monto_actual: goalCurrentAmount(draft, accounts, investments),
            fecha_limite: form.fecha_limite || null,
            account_id: form.account_id ? Number(form.account_id) : null,
            cartera_destino: form.cartera_destino || null,
            });
            onSaved(); onClose();
          });
        }}>
          <label className={lbl} style={{ marginBottom: "0.75rem" }}>Nombre<input value={form.nombre} onChange={e => set("nombre", e.target.value)} required autoFocus /></label>
          <label className={lbl} style={{ marginBottom: "0.75rem" }}>
            Objetivo (€)
            <input type="text" inputMode="decimal" value={form.monto_objetivo} onChange={e => set("monto_objetivo", e.target.value)} required />
          </label>
          <label className={`${lbl} modal-field--wide`} style={{ marginBottom: "0.75rem" }}>
            Cuenta vinculada (opcional)
            <select value={form.account_id} onChange={e => { set("account_id", e.target.value); if (e.target.value) set("cartera_destino", ""); }}>
              <option value="">— Ninguna —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.alias_real}</option>)}
            </select>
            {typeof linkedPreview === "object" && linkedPreview && (
              <small className="muted">Saldo actual: {linkedPreview.balance_actual.toLocaleString("es", { style: "currency", currency: "EUR" })}</small>
            )}
          </label>
          <label className={`${lbl} modal-field--wide`} style={{ marginBottom: "0.75rem" }}>
            Cartera vinculada (opcional)
            <select value={form.cartera_destino} onChange={e => { set("cartera_destino", e.target.value); if (e.target.value) set("account_id", ""); }}>
              <option value="">— Ninguna —</option>
              {carteras.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {typeof linkedPreview === "number" && (
              <small className="muted">Valor actual: {linkedPreview.toLocaleString("es", { style: "currency", currency: "EUR" })}</small>
            )}
          </label>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "1rem" }}>
            También puedes vincular deudas y gastos planificados al crearlas. Si no eliges cuenta/cartera, el progreso sale de esas partidas.
          </p>
          <label className={lbl} style={{ marginBottom: "1rem" }}>Fecha límite (opcional)<input type="date" value={form.fecha_limite} onChange={e => set("fecha_limite", e.target.value)} /></label>
          <div className="modal-actions">
            <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
    </EditModalShell>
  );
}
