import { useEffect, useMemo, useState } from "react";
import { api } from "../../services/api";
import { EmptyState } from "../../components/EmptyState";
import { BankConnectPanel } from "../../components/data/BankConnectPanel";
import { BankStatementImportPanel } from "../../components/data/BankStatementImportPanel";
import { parseNum } from "../../utils/format";
import {
  formatBankLastSync,
  formatBankImportMessage,
  formatBankSyncMessage,
  isBankLinked,
  isBankSyncStale,
  linkedBankAccounts,
} from "../../utils/bankSync";
import { hiddenAccounts, listVisibleAccounts } from "../../utils/payrollAccount";
import type { Account } from "../../types";
import type { Dispatch, SetStateAction } from "react";

type Props = {
  accounts: Account[];
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  deleteWithUndo: (label: string, onCommit: () => Promise<void>) => void;
  onOpenAccountModal: () => void;
  notifyAfter: (action: () => Promise<void>, okText: string, failText: string) => Promise<void>;
  balanceUpdateMode: boolean;
  setBalanceUpdateMode: (v: boolean) => void;
  pendingBalances: Record<number, string>;
  setPendingBalances: Dispatch<SetStateAction<Record<number, string>>>;
  setEditAccountModal: (v: Account | null) => void;
  setEditBalanceModal: (v: { accountId: number; alias: string; current: number } | null) => void;
};

export function AccountsListPanel({
  accounts, formatEUR, addToast, loadAll, deleteWithUndo, onOpenAccountModal,
  notifyAfter, balanceUpdateMode, setBalanceUpdateMode, pendingBalances, setPendingBalances,
  setEditAccountModal, setEditBalanceModal,
}: Props) {
  const [bankPanelOpen, setBankPanelOpen] = useState(false);
  const [syncingAccountId, setSyncingAccountId] = useState<number | null>(null);
  const [syncingAllBanks, setSyncingAllBanks] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    stale_count: number;
    error_count: number;
    requisitions_needing_reauth: Array<Record<string, unknown>>;
  } | null>(null);
  const [importingHistory, setImportingHistory] = useState(false);

  const operatingAccounts = listVisibleAccounts(accounts);
  const visibleAccounts = operatingAccounts.filter((a) => a.tipo !== "inversiones");
  const archivedAccounts = accounts.filter((a) => a.archivada);
  const hiddenOnlyAccounts = hiddenAccounts(accounts).filter((a) => a.tipo !== "inversiones");
  const linkedAccounts = useMemo(() => linkedBankAccounts(visibleAccounts), [visibleAccounts]);
  const staleLinkedCount = useMemo(
    () => linkedAccounts.filter((account) => isBankSyncStale(account.last_sync_at)).length,
    [linkedAccounts],
  );

  const enterUpdateMode = () => {
    setPendingBalances(Object.fromEntries(visibleAccounts.map((a) => [a.id, String(a.balance_actual)])));
    setBalanceUpdateMode(true);
  };
  const cancelUpdateMode = () => { setBalanceUpdateMode(false); setPendingBalances({}); };
  const saveAllBalances = async () => {
    const changed = visibleAccounts.filter((a) => {
      if (isBankLinked(a)) return false;
      const pending = parseNum(pendingBalances[a.id] ?? String(a.balance_actual));
      return pending !== a.balance_actual;
    });
    if (changed.length === 0) { cancelUpdateMode(); return; }
    await notifyAfter(async () => {
      await Promise.all(changed.map((a) =>
        api.updateAccount(a.id, { ...a, balance_actual: parseNum(pendingBalances[a.id]) }),
      ));
    }, `${changed.length} saldo${changed.length > 1 ? "s" : ""} actualizado${changed.length > 1 ? "s" : ""}`, "Error al guardar saldos");
    setBalanceUpdateMode(false);
    setPendingBalances({});
  };

  async function syncLinkedAccount(account: Account) {
    setSyncingAccountId(account.id);
    try {
      const result = await api.syncBankAccounts({ account_id: account.id });
      await loadAll({ silent: true });
      const errors = Number(result.error_count ?? 0);
      addToast(
        formatBankSyncMessage(result.created, result.updated, errors),
        errors > 0 ? "error" : "success",
      );
    } catch {
      addToast("No se pudo sincronizar la cuenta.", "error");
    } finally {
      setSyncingAccountId(null);
    }
  }

  async function syncAllLinkedAccounts() {
    setSyncingAllBanks(true);
    try {
      const result = await api.syncBankAccounts({});
      await loadAll({ silent: true });
      const errors = Number(result.error_count ?? 0);
      addToast(
        formatBankSyncMessage(result.created, result.updated, errors),
        errors > 0 ? (errors >= (result.synced || 0) ? "error" : "info") : "success",
      );
    } catch {
      addToast("No se pudieron sincronizar las cuentas.", "error");
    } finally {
      setSyncingAllBanks(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const status = await api.getBankSyncStatus();
        setSyncStatus({
          stale_count: status.stale_count,
          error_count: status.error_count,
          requisitions_needing_reauth: status.requisitions_needing_reauth,
        });
      } catch {
        // GC puede no estar configurado
      }
    })();
  }, [accounts]);

  useEffect(() => {
    void (async () => {
      try {
        const imported = await api.importBankAccounts();
        const msg = formatBankImportMessage(imported.imported, imported.transactions_created);
        if (msg) {
          await loadAll({ silent: true });
          addToast(msg, "success");
        }
      } catch {
        // GoCardless puede no estar configurado.
      }
    })();
  }, [addToast, loadAll]);

  async function importHistorical() {
    setImportingHistory(true);
    try {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      const result = await api.syncBankAccounts({ date_from: d.toISOString().slice(0, 10) });
      await loadAll({ silent: true });
      const errors = Number(result.error_count ?? 0);
      addToast(
        formatBankSyncMessage(result.created, result.updated, errors),
        errors > 0 ? "info" : "success",
      );
      const status = await api.getBankSyncStatus();
      setSyncStatus({
        stale_count: status.stale_count,
        error_count: status.error_count,
        requisitions_needing_reauth: status.requisitions_needing_reauth,
      });
    } catch {
      addToast("No se pudo importar histórico.", "error");
    } finally {
      setImportingHistory(false);
    }
  }

  return (
    <section className="grid one-col">
      <article className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
          <h2 style={{ margin: 0 }}>Cuentas</h2>
          <div className="inline-actions">
            {balanceUpdateMode ? (
              <>
                <button type="button" className="button-secondary" onClick={cancelUpdateMode}>Cancelar</button>
                <button type="button" onClick={() => void saveAllBalances()}>Guardar saldos</button>
              </>
            ) : (
              <>
                {linkedAccounts.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void importHistorical()}
                      disabled={importingHistory || syncingAllBanks}
                    >
                      {importingHistory ? "Importando…" : "Importar 12 meses"}
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => void syncAllLinkedAccounts()}
                      disabled={syncingAllBanks}
                    >
                      {syncingAllBanks ? "Sincronizando…" : "Sync bancos"}
                    </button>
                  </>
                )}
                <button type="button" className="button-secondary" onClick={() => setBankPanelOpen(true)}>
                  Conectar banco
                </button>
                <button type="button" className="button-secondary" onClick={enterUpdateMode}>Actualizar saldos</button>
                <button type="button" onClick={onOpenAccountModal}>+ Nueva cuenta</button>
              </>
            )}
          </div>
        </div>

        {syncStatus && (syncStatus.stale_count > 0 || syncStatus.error_count > 0 || syncStatus.requisitions_needing_reauth.length > 0) && (
          <div className="budget-banner budget-banner--warn" style={{ marginBottom: "1rem" }} role="status">
            {syncStatus.requisitions_needing_reauth.length > 0 && (
              <span>Consentimiento bancario caducado — renueva la conexión. </span>
            )}
            {syncStatus.stale_count > 0 && (
              <span>{syncStatus.stale_count} cuenta{syncStatus.stale_count !== 1 ? "s" : ""} con sync antigua. </span>
            )}
            {syncStatus.error_count > 0 && (
              <span>{syncStatus.error_count} error{syncStatus.error_count !== 1 ? "es" : ""} de sync. </span>
            )}
            <button type="button" className="button-secondary" style={{ marginLeft: "0.5rem" }} onClick={() => setBankPanelOpen(true)}>
              Gestionar
            </button>
          </div>
        )}

        {linkedAccounts.length > 0 && (
          <div
            style={{
              marginBottom: "1rem",
              padding: "0.85rem 1rem",
              borderRadius: "0.75rem",
              border: "1px solid var(--border-soft)",
              background: "var(--surface-soft)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                  {linkedAccounts.length} cuenta{linkedAccounts.length === 1 ? "" : "s"} conectada{linkedAccounts.length === 1 ? "" : "s"} al banco
                </div>
                <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
                  Los saldos y movimientos se actualizan desde GoCardless.
                  {staleLinkedCount > 0 ? ` ${staleLinkedCount} con sync antigua.` : " Al día."}
                </p>
              </div>
              <button type="button" className="button-secondary" onClick={() => setBankPanelOpen(true)}>
                Gestionar conexión
              </button>
            </div>
          </div>
        )}

        {visibleAccounts.length === 0 ? (
          hiddenOnlyAccounts.length > 0 || archivedAccounts.length > 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No hay cuentas visibles.
              {hiddenOnlyAccounts.length > 0 && (
                <>
                  {" "}
                  <button type="button" className="button-secondary" style={{ fontSize: "inherit", padding: "0.15rem 0.45rem" }} onClick={() => setShowHidden(true)}>
                    Ver {hiddenOnlyAccounts.length} oculta{hiddenOnlyAccounts.length === 1 ? "" : "s"}
                  </button>
                </>
              )}
            </p>
          ) : (
          <EmptyState
            icon="🏦"
            title="Sin cuentas registradas"
            description="Añade tus cuentas bancarias o conéctalas con Open Banking para sincronizar saldos y movimientos."
            actionLabel="+ Añadir cuenta"
            onAction={onOpenAccountModal}
          />
          )
        ) : (() => {
          const groups: Record<string, typeof visibleAccounts> = {};
          for (const a of visibleAccounts) {
            const key = a.banco || "Sin banco";
            groups[key] = groups[key] ?? [];
            groups[key].push(a);
          }
          const renderAccount = (account: typeof visibleAccounts[0]) => {
            const linked = isBankLinked(account);
            const stale = linked && isBankSyncStale(account.last_sync_at);
            return (
              <li key={account.id}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span>{account.alias_real}</span>
                    {linked && (
                      <span className="badge positive" style={{ fontSize: "0.72rem", padding: "0.15rem 0.5rem" }}>
                        Banco
                      </span>
                    )}
                    {account.tipo ? (
                      <small className="muted" style={{ textTransform: "capitalize" }}>· {account.tipo}</small>
                    ) : null}
                  </div>
                  {linked && (
                    <div className="muted" style={{ fontSize: "0.76rem", marginTop: "0.2rem" }}>
                      Sync: {formatBankLastSync(account.last_sync_at)}
                      {stale ? " · pendiente" : ""}
                      {account.iban ? ` · ${account.iban}` : ""}
                    </div>
                  )}
                </div>
                <div className="inline-actions">
                  {balanceUpdateMode ? (
                    linked ? (
                      <span className="muted" style={{ fontSize: "0.78rem" }} title="Saldo gestionado por el banco">
                        {formatEUR(account.balance_actual)}
                      </span>
                    ) : (
                      <input
                        type="text"
                        inputMode="decimal"
                        value={pendingBalances[account.id] ?? ""}
                        onChange={(e) => setPendingBalances((p) => ({ ...p, [account.id]: e.target.value }))}
                        style={{ width: "8rem", textAlign: "right" }}
                      />
                    )
                  ) : (
                    <>
                      <strong className="sensitive">{formatEUR(account.balance_actual)}</strong>
                      {linked && (
                        <button
                          type="button"
                          className="button-secondary"
                          style={{ padding: "0.25rem 0.5rem" }}
                          aria-label={`Sincronizar ${account.alias_real}`}
                          title="Sincronizar con banco"
                          disabled={syncingAccountId === account.id}
                          onClick={() => void syncLinkedAccount(account)}
                        >
                          {syncingAccountId === account.id ? "…" : "↻"}
                        </button>
                      )}
                      <button type="button" className="button-secondary" style={{ padding: "0.25rem 0.5rem" }} aria-label={`Editar cuenta ${account.alias_real}`} title="Editar" onClick={() => setEditAccountModal(account)}>✎</button>
                      <button
                        type="button"
                        className="button-secondary"
                        style={{ padding: "0.25rem 0.5rem" }}
                        aria-label={`Ocultar ${account.alias_real}`}
                        title="Ocultar de la lista"
                        onClick={() => void notifyAfter(
                          () => api.updateAccount(account.id, { ...account, oculta: true }).then(() => loadAll()),
                          "Cuenta oculta de la lista.",
                          "No se pudo ocultar la cuenta.",
                        )}
                      >
                        👁
                      </button>
                      {!linked && (
                        <button type="button" className="button-secondary" style={{ padding: "0.25rem 0.5rem" }}
                          aria-label={`Editar saldo de ${account.alias_real}`} title="Editar saldo"
                          onClick={() => setEditBalanceModal({ accountId: account.id, alias: account.alias_real, current: account.balance_actual })}>
                          €
                        </button>
                      )}
                      <button type="button" className="danger"
                        aria-label={`Eliminar cuenta ${account.alias_real}`} title="Eliminar"
                        onClick={() => deleteWithUndo("Cuenta", () => api.deleteAccount(account.id).then(() => loadAll()))}>
                        🗑
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          };
          const bankKeys = Object.keys(groups).sort((a, b) => a === "Sin banco" ? 1 : b === "Sin banco" ? -1 : a.localeCompare(b, "es"));
          return bankKeys.length === 1 ? (
            <ul className="list accounts-list">{groups[bankKeys[0]].map(renderAccount)}</ul>
          ) : (
            <>
              {bankKeys.map((bank) => (
                <div key={bank} style={{ marginBottom: "1rem" }}>
                  <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.55, marginBottom: "0.4rem" }}>{bank}</div>
                  <ul className="list accounts-list">{groups[bank].map(renderAccount)}</ul>
                </div>
              ))}
            </>
          );
        })()}

        {hiddenOnlyAccounts.length > 0 && (
          <div style={{ marginTop: "1rem" }}>
            <button type="button" className="button-secondary" onClick={() => setShowHidden((value) => !value)}>
              {showHidden ? "Ocultar cuentas ocultas" : `Ver ocultas (${hiddenOnlyAccounts.length})`}
            </button>
            {showHidden && (
              <ul className="list accounts-list" style={{ marginTop: "0.75rem", opacity: 0.85 }}>
                {hiddenOnlyAccounts.map((account) => (
                  <li key={account.id}>
                    <div>
                      <span>{account.alias_real}</span>
                      <small className="muted" style={{ marginLeft: "0.5rem" }}>oculta</small>
                    </div>
                    <div className="inline-actions">
                      <strong className="sensitive">{formatEUR(account.balance_actual)}</strong>
                      <button
                        type="button"
                        className="button-secondary"
                        style={{ padding: "0.25rem 0.5rem" }}
                        aria-label={`Mostrar ${account.alias_real}`}
                        title="Mostrar en la lista"
                        onClick={() => void notifyAfter(
                          () => api.updateAccount(account.id, { ...account, oculta: false }).then(() => loadAll()),
                          "Cuenta visible de nuevo.",
                          "No se pudo mostrar la cuenta.",
                        )}
                      >
                        👁
                      </button>
                      <button type="button" className="button-secondary" style={{ padding: "0.25rem 0.5rem" }} aria-label={`Editar cuenta ${account.alias_real}`} title="Editar" onClick={() => setEditAccountModal(account)}>✎</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {archivedAccounts.length > 0 && (
          <div style={{ marginTop: "1rem" }}>
            <button type="button" className="button-secondary" onClick={() => setShowArchived((value) => !value)}>
              {showArchived ? "Ocultar archivadas" : `Ver archivadas (${archivedAccounts.length})`}
            </button>
            {showArchived && (
              <ul className="list accounts-list" style={{ marginTop: "0.75rem", opacity: 0.75 }}>
                {archivedAccounts.map((account) => (
                  <li key={account.id}>
                    <div>
                      <span>{account.alias_real}</span>
                      <small className="muted" style={{ marginLeft: "0.5rem" }}>archivada</small>
                    </div>
                    <strong className="sensitive">{formatEUR(account.balance_actual)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </article>
      <BankStatementImportPanel
        accounts={accounts}
        formatEUR={formatEUR}
        addToast={addToast}
        loadAll={loadAll}
      />
      <BankConnectPanel
        accounts={accounts}
        addToast={addToast}
        loadAll={loadAll}
        open={bankPanelOpen}
        onOpenChange={setBankPanelOpen}
      />
    </section>
  );
}
