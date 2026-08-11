import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { api } from "../../services/api";
import { EmptyState } from "../../components/EmptyState";
import { TransactionHygienePanel } from "../../components/data/TransactionHygienePanel";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  categoryOptionsForAmount,
  isLegacyCategory,
  normalizeCategory,
} from "../../utils/expenseCategories";
import { isInternalTransfer, isOmittedFromBudget } from "../../utils/internalTransfer";
import { learnableMerchantToken, maybeLearnMerchantName } from "../../utils/merchantNaming";
import { budgetExpenseAmount, hasExpenseSplits, unsettledOwedByPerson } from "../../utils/expenseSplits";
import type { Account, Transaction } from "../../types";
import type { Dispatch, SetStateAction } from "react";

const TX_PAGE_SIZE = 20;

type Props = {
  accounts: Account[];
  transactions: Transaction[];
  settings: Record<string, string>;
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  deleteWithUndo: (label: string, onCommit: () => Promise<void>, onCancel?: () => void) => void;
  onOpenTxModal: () => void;
  txSearch: string;
  setTxSearch: (v: string) => void;
  txFilterCat: string;
  setTxFilterCat: (v: string) => void;
  txFilterAccount: number | "";
  setTxFilterAccount: Dispatch<SetStateAction<number | "">>;
  bulkRecatPending: { description: string; category: string; count: number } | null;
  setBulkRecatPending: Dispatch<SetStateAction<{ description: string; category: string; count: number } | null>>;
  setEditTxModal: (v: Transaction | null) => void;
};

export function TransactionsListPanel({
  accounts, transactions, settings, formatEUR, addToast, loadAll, deleteWithUndo,
  onOpenTxModal, txSearch, setTxSearch, txFilterCat, setTxFilterCat,
  txFilterAccount, setTxFilterAccount, bulkRecatPending, setBulkRecatPending, setEditTxModal,
}: Props) {
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<number>>(() => new Set());
  const [editingDescId, setEditingDescId] = useState<number | null>(null);
  const [editingDescValue, setEditingDescValue] = useState("");
  const [showOmitted, setShowOmitted] = useState(false);
  const [page, setPage] = useState(1);
  const deferredTxSearch = useDeferredValue(txSearch);
  const owedSummary = useMemo(() => unsettledOwedByPerson(transactions), [transactions]);
  const owedTotal = owedSummary.reduce((s, row) => s + row.amount, 0);

  const categoryOptions = useMemo(
    () => [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES],
    [],
  );
  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a.alias_real]));
  const allCats = [...new Set([...categoryOptions, ...transactions.map((t) => t.category_anon).filter(Boolean)])].sort();
  const hasFilter = deferredTxSearch !== "" || txFilterCat !== "" || txFilterAccount !== "";

  const { mainGrouped, omittedTx, mainTotal, pageCount, currentPage, omittedCount } = useMemo(() => {
    const matches = (tx: Transaction) => {
      if (deferredTxSearch && !(tx.description_raw || "").toLowerCase().includes(deferredTxSearch.toLowerCase())) return false;
      if (txFilterCat && tx.category_anon !== txFilterCat) return false;
      if (txFilterAccount !== "" && tx.account_id !== txFilterAccount) return false;
      return true;
    };
    const sorted = [...transactions].filter(matches).sort((a, b) => b.date.localeCompare(a.date));
    const main = sorted.filter((tx) => !isOmittedFromBudget(tx));
    const omitted = sorted.filter((tx) => isOmittedFromBudget(tx));
    const pages = Math.max(1, Math.ceil(main.length / TX_PAGE_SIZE));
    const clampedPage = Math.min(Math.max(1, page), pages);
    const pageItems = main.slice((clampedPage - 1) * TX_PAGE_SIZE, clampedPage * TX_PAGE_SIZE);
    const grouped = pageItems.reduce((acc, tx) => {
      const date = tx.date.slice(0, 10);
      if (!acc[date]) acc[date] = [];
      acc[date].push(tx);
      return acc;
    }, {} as Record<string, Transaction[]>);
    return {
      mainGrouped: grouped,
      omittedTx: omitted,
      mainTotal: main.length,
      pageCount: pages,
      currentPage: clampedPage,
      omittedCount: omitted.length,
    };
  }, [transactions, deferredTxSearch, txFilterCat, txFilterAccount, page]);

  useEffect(() => {
    setPage(1);
  }, [deferredTxSearch, txFilterCat, txFilterAccount]);

  const requestDelete = (tx: Transaction) => {
    setPendingDeleteIds((prev) => new Set(prev).add(tx.id));
    deleteWithUndo(
      "Transacción",
      () => api.deleteTransaction(tx.id).then(() => loadAll()),
      () => setPendingDeleteIds((prev) => {
        const next = new Set(prev);
        next.delete(tx.id);
        return next;
      }),
    );
  };

  async function saveDescription(tx: Transaction) {
    const trimmed = editingDescValue.trim();
    setEditingDescId(null);
    if (trimmed === (tx.description_raw || "").trim()) return;
    try {
      await api.updateTransaction(tx.id, {
        account_id: tx.account_id ?? null,
        amount: tx.amount,
        category_anon: tx.category_anon || "",
        description_raw: trimmed || "—",
        date: tx.date,
      });
      await maybeLearnMerchantName({
        amount: tx.amount,
        previousDescription: tx.description_raw || "",
        newDescription: trimmed || "—",
        learn: api.learnMerchantName,
      });
      await loadAll({ silent: true });
      addToast("Descripción actualizada.", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "No se pudo guardar la descripción.", "error");
      await loadAll({ silent: true });
    }
  }

  const renderTx = (tx: Transaction) => {
    const pending = pendingDeleteIds.has(tx.id);
    const displayDesc = (tx.description_raw || "").trim();
    const isPlaceholder = !displayDesc
      || displayDesc.toLowerCase() === "importado gocardless"
      || displayDesc.toLowerCase() === "importado"
      || displayDesc.toLowerCase() === "movimiento bancario";

    return (
      <li key={tx.id} className={`tx-list__item${pending ? " tx-list__item--pending-delete" : ""}${tx.es_pending ? " tx-list__item--pending" : ""}`}>
        <div className="tx-list__main">
          {editingDescId === tx.id ? (
            <input
              className="tx-list__desc-input"
              value={editingDescValue}
              onChange={(e) => setEditingDescValue(e.target.value)}
              onBlur={() => void saveDescription(tx)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditingDescId(null);
              }}
              autoFocus
              aria-label="Editar descripción del movimiento"
            />
          ) : (
            <button
              type="button"
              className={`tx-list__desc${isPlaceholder ? " muted" : ""}`}
              onClick={() => {
                setEditingDescId(tx.id);
                setEditingDescValue(tx.description_raw || "");
              }}
              title="Clic para editar descripción"
            >
              {displayDesc || "—"}
            </button>
          )}
          {isInternalTransfer(tx) && (
            <small className="badge" style={{ fontSize: "0.72rem", marginTop: "0.15rem" }}>interna</small>
          )}
          {tx.excluida_presupuesto && !isInternalTransfer(tx) && (
            <small className="badge" style={{ fontSize: "0.72rem", marginTop: "0.15rem" }}>omitida</small>
          )}
          {isLegacyCategory(tx.category_anon) && !isInternalTransfer(tx) && (
            <small className="badge" style={{ fontSize: "0.72rem", marginTop: "0.15rem" }} title="No está en la taxonomía fija">actualizar categoría</small>
          )}
          {tx.es_pending && !isInternalTransfer(tx) && (
            <small className="muted" style={{ fontSize: "0.72rem", marginTop: "0.15rem" }}>pendiente</small>
          )}
          {hasExpenseSplits(tx) && !isInternalTransfer(tx) && (
            <small
              className="badge"
              style={{ fontSize: "0.72rem", marginTop: "0.15rem" }}
              title={`Presupuesto: ${formatEUR(budgetExpenseAmount(tx))} (tu parte)`}
            >
              dividido · tu parte {formatEUR(budgetExpenseAmount(tx))}
            </small>
          )}
          <div className="tx-list__meta">
            <select
              className="tx-cat-select"
              value={normalizeCategory(tx.category_anon) || tx.category_anon || ""}
              aria-label={`Categoría de ${tx.description_raw || "movimiento"}`}
              disabled={pending}
              onChange={async (e) => {
                const newCat = e.target.value;
                try {
                  await api.patchTransactionCategory(tx, newCat);
                  const token = learnableMerchantToken(tx.description_raw || "");
                  if (token && newCat) {
                    try {
                      await api.learnCategoryRule(token, newCat);
                    } catch {
                      // regla opcional
                    }
                  }
                  await loadAll();
                  const rawDesc = tx.description_raw.trim().toLowerCase();
                  if (rawDesc && newCat) {
                    const matches = transactions.filter(
                      (t) => t.id !== tx.id
                        && t.description_raw.trim().toLowerCase() === rawDesc
                        && t.category_anon !== newCat,
                    );
                    if (matches.length > 0) {
                      setBulkRecatPending({ description: tx.description_raw.trim(), category: newCat, count: matches.length });
                    }
                  }
                } catch (err) {
                  addToast(err instanceof Error ? err.message : "No se pudo cambiar la categoría.", "error");
                  await loadAll({ silent: true });
                }
              }}
            >
              <option value="">— sin categoría —</option>
              {(() => {
                const opts = categoryOptionsForAmount(Number(tx.amount), tx.category_anon);
                const current = (tx.category_anon || "").trim();
                return (
                  <>
                    {current && !opts.includes(current) && (
                      <option value={current}>{current} (legacy)</option>
                    )}
                    {opts.map((c) => <option key={c} value={c}>{c}</option>)}
                  </>
                );
              })()}
            </select>
            {tx.account_id != null && accountMap[tx.account_id] && (
              <small className="muted">{accountMap[tx.account_id]}</small>
            )}
          </div>
        </div>
        <div className="inline-actions">
          <strong className={`sensitive ${Number(tx.amount) < 0 ? "negative" : "positive"}`}>
            {formatEUR(Number(tx.amount))}
          </strong>
          <button
            type="button"
            className="button-secondary"
            style={{ padding: "0.25rem 0.5rem" }}
            aria-label={`Editar movimiento ${tx.description_raw}`}
            title="Editar"
            disabled={pending}
            onClick={() => setEditTxModal(tx)}
          >
            ✎
          </button>
          {!isInternalTransfer(tx) && (
            <button
              type="button"
              className="button-secondary"
              style={{ padding: "0.25rem 0.5rem" }}
              title="Marcar como transferencia interna (no cuenta como gasto/ingreso)"
              aria-label="Marcar como transferencia interna"
              disabled={pending}
              onClick={() => void (async () => {
                try {
                  await api.markTransactionInternal(tx.id);
                  await loadAll({ silent: true });
                  addToast("Marcado como transferencia interna.", "success");
                } catch {
                  addToast("No se pudo marcar.", "error");
                }
              })()}
            >
              ↔
            </button>
          )}
          {isInternalTransfer(tx) && (
            <button
              type="button"
              className="button-secondary"
              style={{ padding: "0.25rem 0.5rem" }}
              title="No es transferencia interna"
              aria-label="Desmarcar transferencia interna"
              disabled={pending}
              onClick={() => void (async () => {
                try {
                  await api.unmarkTransactionInternal(tx.id);
                  await loadAll({ silent: true });
                  addToast("Transferencia interna deshecha.", "success");
                } catch {
                  addToast("No se pudo desmarcar.", "error");
                }
              })()}
            >
              ↩
            </button>
          )}
          {!tx.excluida_presupuesto && !isInternalTransfer(tx) && (
            <button
              type="button"
              className="button-secondary"
              style={{ padding: "0.25rem 0.5rem" }}
              title={Number(tx.amount) > 0
                ? "Omitir este ingreso del presupuesto (sigue en historial y saldo)"
                : "Omitir este gasto del presupuesto (sigue en historial y saldo)"}
              aria-label={Number(tx.amount) > 0 ? "Omitir ingreso del presupuesto" : "Omitir gasto del presupuesto"}
              disabled={pending}
              onClick={() => void (async () => {
                try {
                  await api.excludeTransactionFromBudget(tx.id);
                  await loadAll({ silent: true });
                  addToast(
                    Number(tx.amount) > 0
                      ? "Ingreso omitido del presupuesto."
                      : "Gasto omitido del presupuesto.",
                    "success",
                  );
                } catch {
                  addToast("No se pudo omitir.", "error");
                }
              })()}
            >
              ⊘
            </button>
          )}
          {tx.excluida_presupuesto && !isInternalTransfer(tx) && (
            <button
              type="button"
              className="button-secondary"
              style={{ padding: "0.25rem 0.5rem" }}
              title="Volver a contar en el presupuesto"
              aria-label="Incluir en presupuesto"
              disabled={pending}
              onClick={() => void (async () => {
                try {
                  await api.includeTransactionInBudget(tx.id);
                  await loadAll({ silent: true });
                  addToast(
                    Number(tx.amount) > 0
                      ? "El ingreso vuelve a contar en el presupuesto."
                      : "El gasto vuelve a contar en el presupuesto.",
                    "success",
                  );
                } catch {
                  addToast("No se pudo incluir.", "error");
                }
              })()}
            >
              ⊕
            </button>
          )}
          <button
            type="button"
            className="danger"
            aria-label={`Eliminar movimiento ${tx.description_raw}`}
            title="Eliminar"
            disabled={pending}
            onClick={() => requestDelete(tx)}
          >
            🗑
          </button>
        </div>
      </li>
    );
  };

  return (
    <section className="grid one-col">
      <article className="card">
        <div className="tx-list-head">
          <h2>Historial de Transacciones</h2>
          <div className="inline-actions">
            <button type="button" onClick={onOpenTxModal}>+ Registro Manual</button>
          </div>
        </div>

        <div className="list-filters">
          <input
            type="search"
            placeholder="Buscar descripción…"
            value={txSearch}
            onChange={(e) => setTxSearch(e.target.value)}
            style={{ flex: "1 1 160px", minWidth: 0 }}
          />
          <select value={txFilterCat} onChange={(e) => setTxFilterCat(e.target.value)} style={{ flex: "0 1 160px" }}>
            <option value="">Todas las categorías</option>
            {allCats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={txFilterAccount}
            onChange={(e) => setTxFilterAccount(e.target.value === "" ? "" : Number(e.target.value))}
            style={{ flex: "0 1 140px" }}
          >
            <option value="">Todas las cuentas</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.alias_real}</option>)}
          </select>
          {hasFilter && (
            <button type="button" className="button-secondary" onClick={() => { setTxSearch(""); setTxFilterCat(""); setTxFilterAccount(""); }}>
              Limpiar
            </button>
          )}
        </div>
        <div style={{ fontSize: "0.8rem", marginBottom: "0.5rem" }} className="muted">
          {mainTotal} movimiento{mainTotal !== 1 ? "s" : ""}
          {omittedCount > 0 && ` · ${omittedCount} omitida${omittedCount !== 1 ? "s" : ""}`}
          {pageCount > 1 && ` · página ${currentPage}/${pageCount}`}
          <span> · ↔ traspaso interno · ⊘ omitir gasto o ingreso del presupuesto</span>
        </div>

        {bulkRecatPending && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.6rem 0.875rem", background: "var(--color-accent, #2563eb)22", border: "1px solid var(--color-accent, #2563eb)55", borderRadius: "0.5rem", marginBottom: "0.75rem", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.85rem" }}>
              Hay <strong>{bulkRecatPending.count}</strong> movimiento{bulkRecatPending.count !== 1 ? "s" : ""} más con «{bulkRecatPending.description}». ¿Categorizar todos como <strong>{bulkRecatPending.category}</strong>?
            </span>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                style={{ fontSize: "0.8rem" }}
                onClick={async () => {
                  const rawDesc = bulkRecatPending.description.toLowerCase();
                  const matches = transactions.filter(
                    (t) => t.description_raw.trim().toLowerCase() === rawDesc && t.category_anon !== bulkRecatPending.category,
                  );
                  for (const t of matches) {
                    await api.patchTransactionCategory(t, bulkRecatPending.category);
                  }
                  await loadAll();
                  setBulkRecatPending(null);
                  addToast(`${matches.length} movimientos categorizados como "${bulkRecatPending.category}".`, "success");
                }}
              >
                Aplicar a todos
              </button>
              <button type="button" className="button-secondary" style={{ fontSize: "0.8rem" }} onClick={() => setBulkRecatPending(null)}>
                No
              </button>
            </div>
          </div>
        )}

        {transactions.length === 0 ? (
          <EmptyState
            icon="💳"
            title="Sin movimientos registrados"
            description="Registra movimientos manualmente o importa un extracto desde Cuentas."
            actionLabel="+ Primer movimiento"
            onAction={onOpenTxModal}
          />
        ) : (
          <>
            {Object.keys(mainGrouped).sort((a, b) => b.localeCompare(a)).map((date) => (
              <div key={date} className="tx-list-group">
                <div className="list-group-header">{date}</div>
                <ul className="list tx-list">
                  {mainGrouped[date]!.map(renderTx)}
                </ul>
              </div>
            ))}
            {mainTotal === 0 && (
              <p className="muted" style={{ padding: "1rem 0" }}>
                {omittedCount > 0
                  ? "No hay movimientos activos con estos filtros. Revisa Omitidas abajo."
                  : "Sin resultados para los filtros actuales."}
              </p>
            )}
            {pageCount > 1 && (
              <div
                className="inline-actions"
                style={{ justifyContent: "flex-end", marginTop: "0.75rem" }}
              >
                <button
                  type="button"
                  className="button-secondary"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  ← Anterior
                </button>
                <span className="muted" style={{ fontSize: "0.85rem" }}>
                  Página {currentPage} de {pageCount}
                </span>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Siguiente →
                </button>
              </div>
            )}
            {omittedCount > 0 && (
              <div style={{ marginTop: "1.25rem" }}>
                <button
                  type="button"
                  className="collapsible-card-head"
                  onClick={() => setShowOmitted((v) => !v)}
                  aria-expanded={showOmitted}
                  style={{ width: "100%", justifyContent: "space-between" }}
                >
                  <h3 style={{ margin: 0, fontSize: "0.95rem" }}>
                    Omitidas ({omittedCount})
                  </h3>
                  <span className="muted" style={{ fontSize: "0.8rem" }}>
                    No cuentan en presupuesto {showOmitted ? "▲" : "▼"}
                  </span>
                </button>
                {showOmitted && (
                  <ul className="list tx-list" style={{ marginTop: "0.5rem" }}>
                    {omittedTx.map(renderTx)}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </article>
      {owedSummary.length > 0 && (
        <article className="card">
          <h2 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>Te deben (gastos divididos)</h2>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            Pendiente de cobro: {formatEUR(owedTotal)}. Márcalo como pagado al editar el movimiento.
          </p>
          <ul className="list" style={{ fontSize: "0.9rem" }}>
            {owedSummary.map((row) => (
              <li key={row.person_name}>
                <span>{row.person_name}</span>
                <strong className="sensitive">{formatEUR(row.amount)}</strong>
              </li>
            ))}
          </ul>
        </article>
      )}
      <TransactionHygienePanel
        settings={settings}
        transactions={transactions}
        addToast={addToast}
        loadAll={loadAll}
      />
    </section>
  );
}
