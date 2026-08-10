import { useMemo, useState } from "react";
import { api } from "../../services/api";
import type { RecurringEntry, Transaction } from "../../types";
import { EmptyState } from "../../components/EmptyState";
import { IncomeSourceModal } from "../../components/modals/IncomeSourceModal";
import { incomeCatClass } from "../../utils/statusColors";
import { isOmittedFromBudget, isRealIncome } from "../../utils/internalTransfer";

type Props = {
  month: number;
  year: number;
  recurringEntries: RecurringEntry[];
  monthlyTransactions: Transaction[];
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  deleteWithUndo: (label: string, onCommit: () => Promise<void>) => void;
};

export function IngresosView({
  month, year, recurringEntries, monthlyTransactions, formatEUR, addToast, loadAll, deleteWithUndo
}: Props) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<RecurringEntry | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  /** Optimistic omit until loadAll refreshes (avoids stale “ingresos reales”). */
  const [localOmitIds, setLocalOmitIds] = useState<Set<number>>(() => new Set());

  const incomeEntries = recurringEntries.filter(e => e.es_ingreso);
  const totalPlanned = incomeEntries.reduce((s, e) => s + e.monto_estimado, 0);

  const realIncomeTx = useMemo(
    () => monthlyTransactions.filter((tx) => {
      if (localOmitIds.has(tx.id) || isOmittedFromBudget(tx)) return false;
      return isRealIncome(tx);
    }),
    [monthlyTransactions, localOmitIds],
  );
  const totalReal = realIncomeTx.reduce((s, tx) => s + tx.amount, 0);

  const realBySource: Record<string, number> = {};
  for (const tx of realIncomeTx) {
    const key = tx.category_anon?.trim() || "Sin categoría";
    realBySource[key] = (realBySource[key] || 0) + tx.amount;
  }

  const plannedByCat: Record<string, { total: number; entries: RecurringEntry[] }> = {};
  for (const e of incomeEntries) {
    const cat = e.categoria || "Otros";
    if (!plannedByCat[cat]) plannedByCat[cat] = { total: 0, entries: [] };
    plannedByCat[cat].total += e.monto_estimado;
    plannedByCat[cat].entries.push(e);
  }

  async function omitIncome(tx: Transaction) {
    setBusyId(tx.id);
    setLocalOmitIds((prev) => new Set(prev).add(tx.id));
    try {
      await api.excludeTransactionFromBudget(tx.id);
      await loadAll({ silent: true });
      addToast("Ingreso omitido. Ya no cuenta en ingresos reales (sigue en Movimientos → Omitidas).", "success");
    } catch {
      setLocalOmitIds((prev) => {
        const next = new Set(prev);
        next.delete(tx.id);
        return next;
      });
      addToast("No se pudo omitir.", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <section className="grid">
        <div className="kpi-tiles">
          {[
            { label: "Ingreso planificado/mes", value: totalPlanned, cls: "positive" },
            { label: `Ingreso real ${month}/${year}`, value: totalReal, cls: totalReal > 0 ? "positive" : "" },
            { label: "Fuentes registradas", value: null, text: String(incomeEntries.length), cls: "" },
            ...(totalPlanned > 0 && totalReal > 0 ? [{
              label: "Desviación",
              value: null,
              text: `${totalReal >= totalPlanned ? "+" : ""}${((totalReal - totalPlanned) / totalPlanned * 100).toFixed(1)}%`,
              cls: totalReal >= totalPlanned ? "positive" : "negative"
            }] : []),
          ].map(({ label, value, text, cls }) => (
            <div key={label} style={{ padding: "0.875rem 1rem", background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "0.625rem" }}>
              <p className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.25rem" }}>{label}</p>
              <strong className={`sensitive ${cls}`} style={{ fontSize: "1.25rem" }}>
                {value !== null && value !== undefined ? formatEUR(value) : text}
              </strong>
            </div>
          ))}
        </div>

        <div className="grid two-col">
          <article className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <h2>Fuentes de ingreso</h2>
              <button type="button" onClick={() => setIsFormOpen(true)}>+ Nueva</button>
            </div>

            {incomeEntries.length === 0 ? (
              <EmptyState
                icon="💰"
                title="Sin fuentes registradas"
                description="Añade tus fuentes de ingreso recurrentes: nómina, alquiler, freelance, dividendos…"
                actionLabel="+ Añadir fuente"
                onAction={() => setIsFormOpen(true)}
              />
            ) : (
              <>
                {Object.entries(plannedByCat).sort(([, a], [, b]) => b.total - a.total).map(([cat, { total, entries }]) => (
                  <div key={cat} style={{ marginBottom: "1rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
                      <span className={`income-cat-dot ${incomeCatClass(cat)}`} />
                      <span style={{ fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{cat}</span>
                      <span className="muted sensitive" style={{ fontSize: "0.8rem", marginLeft: "auto" }}>{formatEUR(total)}/mes</span>
                    </div>
                    <ul className="list" style={{ paddingLeft: "1.25rem" }}>
                      {entries.map(e => (
                        <li key={e.id}>
                          <div>
                            <span>{e.nombre}</span>
                            {e.empresa && <small className="muted" style={{ marginLeft: "0.35rem" }}>· {e.empresa}</small>}
                            {!e.es_fijo && <small className="muted" style={{ marginLeft: "0.35rem" }}>variable</small>}
                          </div>
                          <div className="inline-actions">
                            <span className="sensitive" style={{ fontSize: "0.9rem" }}>{formatEUR(e.monto_estimado)}/mes</span>
                            <button type="button" className="button-secondary" style={{ padding: "0.2rem 0.4rem" }}
                              aria-label={`Editar ${e.nombre}`}
                              title="Editar"
                              onClick={() => setEditItem(e)}>✎</button>
                            <button type="button" className="danger"
                              aria-label={`Eliminar ${e.nombre}`}
                              title="Eliminar"
                              onClick={() => deleteWithUndo("Fuente de ingreso", () => api.deleteRecurringEntry(e.id).then(() => loadAll()))}>
                              🗑
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: "0.75rem", display: "flex", justifyContent: "space-between" }}>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>Total planificado</span>
                  <strong className="sensitive positive">{formatEUR(totalPlanned)}/mes</strong>
                </div>
              </>
            )}
          </article>

          <article className="card">
            <h2>Ingresos reales · {month}/{year}</h2>
            <p className="muted" style={{ fontSize: "0.78rem", marginTop: "-0.35rem", marginBottom: "0.75rem" }}>
              Sin omitidos del presupuesto. Esos solo aparecen en Movimientos → Omitidas.
            </p>
            {realIncomeTx.length === 0 ? (
              <p className="muted" style={{ fontSize: "0.875rem" }}>Sin ingresos registrados este mes.</p>
            ) : (
              <>
                {Object.entries(realBySource).sort(([, a], [, b]) => b - a).map(([source, amount]) => (
                  <div key={source} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0", borderBottom: "1px solid var(--border-soft)" }}>
                    <span style={{ fontSize: "0.9rem" }}>{source}</span>
                    <strong className="sensitive positive">{formatEUR(amount)}</strong>
                  </div>
                ))}
                <div style={{ paddingTop: "0.75rem", display: "flex", justifyContent: "space-between" }}>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>Total real</span>
                  <strong className="sensitive positive">{formatEUR(totalReal)}</strong>
                </div>
                <div style={{ marginTop: "1rem" }}>
                  <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.35rem" }}>
                    Detalle · ⊘ omite (sale de este listado)
                  </p>
                  <ul className="list">
                    {[...realIncomeTx].sort((a, b) => b.date.localeCompare(a.date)).map(tx => (
                      <li key={tx.id} style={{ fontSize: "0.85rem" }}>
                        <span>
                          <span className="muted" style={{ marginRight: "0.4rem" }}>{tx.date.slice(5, 10)}</span>
                          {tx.description_raw || "—"}
                        </span>
                        <div className="inline-actions">
                          <strong className="sensitive positive">{formatEUR(tx.amount)}</strong>
                          <button
                            type="button"
                            className="button-secondary"
                            style={{ padding: "0.2rem 0.4rem" }}
                            title="Omitir este ingreso del presupuesto"
                            aria-label={`Omitir ingreso ${tx.description_raw || ""}`}
                            disabled={busyId === tx.id}
                            onClick={() => void omitIncome(tx)}
                          >
                            ⊘
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </article>
        </div>
      </section>

      {(isFormOpen || editItem) && (
        <IncomeSourceModal
          item={editItem ?? undefined}
          month={month}
          year={year}
          onClose={() => { setIsFormOpen(false); setEditItem(null); }}
          onSave={async (payload) => {
            if (editItem) {
              await api.updateRecurringEntry(editItem.id, payload);
            } else {
              await api.createRecurringEntry(payload);
            }
            addToast(editItem ? "Fuente actualizada." : "Fuente de ingreso añadida.", "success");
            await loadAll();
          }}
        />
      )}
    </>
  );
}
