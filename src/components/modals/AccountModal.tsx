import { useState } from "react";
import type { Account } from "../../types";
import { api } from "../../services/api";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../ModalFormError";
import { EditModalShell } from "../EditModalShell";
import { formatBankLastSync, isBankLinked } from "../../utils/bankSync";

const lbl = { display: "flex", flexDirection: "column" as const, gap: "0.25rem" };

interface Props {
  item: Account;
  onClose: () => void;
  onSaved: () => void;
}

export function AccountModal({ item, onClose, onSaved }: Props) {
  const { saving, error, run } = useAsyncSubmit();
  const [syncing, setSyncing] = useState(false);
  const linked = isBankLinked(item);
  const [form, setForm] = useState({
    alias_real: item.alias_real,
    alias_anonimo: item.alias_anonimo ?? "",
    banco: item.banco ?? "",
    iban: item.iban ?? "",
    tipo: item.tipo ?? "gasto",
    oculta: item.oculta ?? false,
  });
  const set = (k: string, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <EditModalShell title={`Editar cuenta — ${item.alias_real}`} onClose={onClose}>
      <ModalFormError error={error} />
      {linked && (
        <div
          style={{
            marginBottom: "0.85rem",
            padding: "0.85rem 1rem",
            borderRadius: "0.75rem",
            border: "1px solid var(--border-soft)",
            background: "var(--surface-soft)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: "0.2rem" }}>Conectada al banco</div>
              <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
                Saldo y movimientos se sincronizan desde GoCardless.
                Última sync: {formatBankLastSync(item.last_sync_at)}.
              </p>
            </div>
            <div className="inline-actions">
              <button
                type="button"
                className="button-secondary"
                disabled={syncing}
                onClick={() => {
                  setSyncing(true);
                  void run(async () => {
                    await api.syncBankAccounts({ account_id: item.id });
                    onSaved();
                  }).finally(() => setSyncing(false));
                }}
              >
                {syncing ? "Sincronizando…" : "Sync ahora"}
              </button>
              <button
                type="button"
                className="button-secondary"
                disabled={saving}
                onClick={() => {
                  void run(async () => {
                    await api.unlinkBankAccount(item.id);
                    onSaved();
                    onClose();
                  });
                }}
              >
                Desvincular
              </button>
            </div>
          </div>
        </div>
      )}
      <form onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await api.updateAccount(item.id, { ...item, ...form, iban: form.iban || null, oculta: form.oculta });
          onSaved();
          onClose();
        });
      }}>
        <label style={{ ...lbl, marginBottom: "0.75rem" }}>
          Nombre
          <input
            value={form.alias_real}
            onChange={(e) => set("alias_real", e.target.value)}
            required
            autoFocus
            readOnly={linked}
          />
        </label>
        <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
          <label style={lbl}>Banco<input value={form.banco} onChange={(e) => set("banco", e.target.value)} /></label>
          <label style={lbl}>Tipo
            <select value={form.tipo} onChange={(e) => set("tipo", e.target.value)}>
              <option value="gasto">Gasto</option>
              <option value="ahorro">Ahorro</option>
              <option value="inversiones">Inversiones</option>
              <option value="metas">Metas</option>
            </select>
          </label>
          <label style={{ ...lbl, gridColumn: "1/-1" }}>IBAN<input value={form.iban} onChange={(e) => set("iban", e.target.value.toUpperCase())} placeholder="ES12 3456 7890 …" /></label>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", fontSize: "0.9rem" }}>
          <input
            type="checkbox"
            checked={form.oculta}
            onChange={(e) => set("oculta", e.target.checked)}
          />
          Ocultar de la lista de cuentas (sigue activa y sus movimientos se muestran)
        </label>
        {linked && (
          <p className="modal-form__helper" style={{ marginBottom: "0.75rem" }}>
            El nombre, saldo y movimientos se actualizan desde el banco al sincronizar.
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </EditModalShell>
  );
}
