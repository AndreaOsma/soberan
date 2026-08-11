import { useEffect, useState } from "react";
import { api } from "../../services/api";
import { activeAccounts, formatPayrollHistoryRange, type PayrollAccountConfig } from "../../utils/payrollAccount";
import type { Account } from "../../types";

type Props = {
  empresa: string;
  accounts: Account[];
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
};

export function PayrollAccountCard({ empresa, accounts, addToast, loadAll }: Props) {
  const [config, setConfig] = useState<PayrollAccountConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<number | "">("");
  const [archivePrevious, setArchivePrevious] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const selectableAccounts = activeAccounts(accounts).filter((account) => account.tipo !== "inversiones");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const row = await api.getPayrollAccountConfig(empresa);
        if (!cancelled) {
          setConfig(row);
          setSelectedAccountId(row.account_id ?? "");
        }
      } catch {
        if (!cancelled) addToast("No se pudo cargar la cuenta de nómina.", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [empresa, addToast]);

  async function saveAccount() {
    if (!selectedAccountId) {
      addToast("Elige una cuenta destino.", "info");
      return;
    }
    if (config?.account_id === selectedAccountId) {
      addToast("Ya tienes esa cuenta asignada.", "info");
      return;
    }
    setSaving(true);
    try {
      const row = await api.setPayrollAccountConfig({
        empresa,
        account_id: Number(selectedAccountId),
        archive_previous_account: archivePrevious,
      });
      setConfig(row);
      await loadAll({ silent: true });
      const archivedMsg = archivePrevious && config?.account_id ? " La cuenta anterior quedó archivada." : "";
      addToast(`Cuenta de nómina actualizada.${archivedMsg}`, "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "No se pudo guardar la cuenta de nómina.", "error");
    } finally {
      setSaving(false);
    }
  }

  const currentAccount = config?.account_id
    ? accounts.find((account) => account.id === config.account_id)
    : null;

  return (
    <article className="card" style={{ marginTop: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <h3 style={{ margin: "0 0 0.35rem", fontSize: "1rem" }}>Cuenta de nómina</h3>
          <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
            Los ingresos estimados y movimientos de nómina se registrarán en esta cuenta.
          </p>
        </div>
        {currentAccount && (
          <span className="badge positive" style={{ alignSelf: "flex-start" }}>
            {currentAccount.alias_real}
            {currentAccount.banco ? ` · ${currentAccount.banco}` : ""}
          </span>
        )}
      </div>

      {loading ? (
        <p className="muted" style={{ marginTop: "0.85rem", fontSize: "0.82rem" }}>Cargando…</p>
      ) : (
        <div style={{ marginTop: "0.85rem", display: "grid", gap: "0.75rem" }}>
          <label style={{ fontSize: "0.82rem" }}>
            Cuenta destino
            <select
              value={selectedAccountId === "" ? "" : String(selectedAccountId)}
              onChange={(e) => setSelectedAccountId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">— Elige cuenta —</option>
              {selectableAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.alias_real}{account.banco ? ` · ${account.banco}` : ""}
                </option>
              ))}
            </select>
          </label>

          {config?.account_id != null && selectedAccountId !== "" && config.account_id !== selectedAccountId && (
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem" }}>
              <input
                type="checkbox"
                checked={archivePrevious}
                onChange={(e) => setArchivePrevious(e.target.checked)}
              />
              Archivar la cuenta anterior ({config.account_alias || `#${config.account_id}`})
            </label>
          )}

          <div className="inline-actions">
            <button type="button" disabled={saving || !selectedAccountId} onClick={() => void saveAccount()}>
              {saving ? "Guardando…" : config?.account_id ? "Cambiar cuenta" : "Asignar cuenta"}
            </button>
          </div>

          {config && config.history.length > 0 && (
            <div>
              <button
                type="button"
                className="button-secondary"
                style={{ fontSize: "0.82rem", padding: "0.35rem 0.65rem" }}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "Ocultar histórico" : `Ver histórico (${config.history.length})`}
              </button>
              {expanded && (
                <ul className="list" style={{ marginTop: "0.65rem", fontSize: "0.82rem" }}>
                  {[...config.history].reverse().map((entry, index) => (
                    <li key={`${entry.account_id}-${entry.from_date}-${index}`}>
                      <span>{entry.account_alias || `Cuenta #${entry.account_id}`}</span>
                      <span className="muted">{formatPayrollHistoryRange(entry)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
