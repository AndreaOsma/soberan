import { useMemo, useState } from "react";
import { api } from "../../services/api";
import { EmptyState } from "../EmptyState";
import { BudgetGauge } from "./BudgetGauge";
import { BudgetGroupHeader } from "./BudgetGroupHeader";
import { GlassModal } from "../GlassModal";
import { ModalFormError } from "../ModalFormError";
import { IncomeSourceModal } from "../modals/IncomeSourceModal";
import { GoalProgressBlock } from "../goals/GoalProgressBlock";
import { BudgetEntryScopeActions } from "./BudgetEntryScopeActions";
import { DebtExtraPaymentControl } from "./DebtExtraPaymentControl";
import type { MenuKey } from "../../config/ui";
import type {
  Account, Debt, DebtInstallment, Goal, Investment, RecurringEntry,
  MonthlyBudget, WishlistItem,
} from "../../types";
import { destinoFromEntry } from "../../utils/budgetTipo";
import { normalizeCategory } from "../../utils/expenseCategories";
import { installmentStatus, type ExtraPaymentMode } from "../../utils/debtInstallments";
import { round2 } from "../../utils/debt/round";
import {
  projectAhorroAtBudgetMonth,
  projectAhorroLongHorizon,
  projectDebtAtBudgetMonth,
} from "../../utils/budgetMonthProjection";
import {
  subscriptionMonthExcluded, subscriptionStarted,
  subscriptionMonthlyAmount, subscriptionAmountForMonth, isAnnualSubscription,
} from "../../utils/subscriptionBudget";
import { incomeRealAmount } from "../../utils/budgetIncome";
import { isWishlistActive } from "../../utils/wishlist";
import { buildGoalProgressSnapshot, findGoalById, findGoalForEntry, formatMonthYear } from "../../utils/goalProgress";
import { isLibrePlannedGasto, useBudgetMonth } from "../../hooks/useBudgetMonth";
import { MONTH_NAMES } from "../../hooks/useBudgetEntries";

type AsyncSubmit = {
  saving: boolean;
  error: string | null;
  run: (action: () => Promise<void>) => Promise<void>;
};

type BudgetSlice = ReturnType<typeof useBudgetMonth>;

type Props = {
  month: number;
  year: number;
  recurringEntries: RecurringEntry[];
  monthlyBudgets: MonthlyBudget[];
  debts: Debt[];
  debtInstallments: DebtInstallment[];
  accounts: Account[];
  investments: Investment[];
  goals: Goal[];
  wishlist: WishlistItem[];
  formatEUR: (value: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  onNavigate: (key: MenuKey) => void;
  budget: BudgetSlice;
  expandedGroups: Set<string>;
  toggleGroup: (name: string) => void;
  editingId: number | null;
  setEditingId: (id: number | null) => void;
  editingVal: string;
  setEditingVal: (v: string) => void;
  editingIncomeKey: string | null;
  setEditingIncomeKey: (k: string | null) => void;
  addingIncome: boolean;
  setAddingIncome: (v: boolean) => void;
  editingIncomeSource: RecurringEntry | null;
  setEditingIncomeSource: (e: RecurringEntry | null) => void;
  showWishlistPicker: boolean;
  setShowWishlistPicker: (v: boolean) => void;
  copying: boolean;
  applyingTemplate: boolean;
  fondoBalances: Record<number, number>;
  debtMarkSubmit: AsyncSubmit;
  debtExtraSubmit: AsyncSubmit;
  libreSubmit: AsyncSubmit;
  availColor: string;
  monthScopeLabel: string;
  goalProgressOpts: { debts: Debt[]; fondoBalances: Record<number, number> };
  openEdit: (entry: RecurringEntry) => void;
  restoreToMonth: (entryId: number) => Promise<void>;
  pauseEntryThisMonth: (entry: RecurringEntry) => Promise<boolean>;
  cancelEntryFromMonth: (entry: RecurringEntry) => Promise<boolean>;
  assignAvailableToLibre: () => Promise<void>;
  savePayrollReal: (empresa: string, val: number) => Promise<void>;
  saveAssigned: (entryId: number, val: number) => Promise<void>;
  copyFromPrev: () => Promise<void>;
  apply503020Template: () => Promise<void>;
  markDebtInstallmentPaid: (installmentId: number, debtId: number) => Promise<void>;
  commitDebtExtraPayment: (debtId: number, month: number, year: number, extraAmount: number, mode: ExtraPaymentMode) => Promise<void>;
  promoteWishlistItem: (wishlistId: number, nombre: string) => Promise<void>;
  saveIncomeSource: (payload: Omit<RecurringEntry, "id">) => Promise<void>;
};

export function BudgetMonthPanel(props: Props) {
  const {
    month, year, recurringEntries, monthlyBudgets, debts, debtInstallments,
    accounts, investments, goals, wishlist, formatEUR, addToast, loadAll, onNavigate,
    budget, expandedGroups, toggleGroup,
    editingId, setEditingId, editingVal, setEditingVal,
    editingIncomeKey, setEditingIncomeKey,
    addingIncome, setAddingIncome, editingIncomeSource, setEditingIncomeSource,
    showWishlistPicker, setShowWishlistPicker,
    copying, applyingTemplate, fondoBalances,
    debtMarkSubmit, debtExtraSubmit, libreSubmit, availColor, monthScopeLabel, goalProgressOpts,
    openEdit, restoreToMonth, pauseEntryThisMonth, cancelEntryFromMonth,
    assignAvailableToLibre, savePayrollReal, saveAssigned,
    copyFromPrev, apply503020Template, markDebtInstallmentPaid, commitDebtExtraPayment,
    promoteWishlistItem, saveIncomeSource,
  } = props;
  const {
    prevMonth, prevYear, hasOverrides, prevMonthHasBudget, mbMap,
    otherIncomeEntries, payrollRows, allSubscriptions, activeSubscriptions,
    fondoEntries, puntualGastoEntries, ahorroInversionEntries, excludedEntries,
    totalIncomeExpected, totalIncomeReal, totalIncomeFromTx, realIncomeTx, spentByCat,
    debtItems, activeDebts, totalFondosAssigned, totalPuntualAssigned,
    totalDeudasAssigned, totalSubsAssigned, totalGastosAssigned,
    totalAhorroInversionAssigned, availableToAssign, incomeTxMismatchPct,
    showIncomeReconcileBanner, budgetOverAssigned, showFirstMonthAssistant,
    templateSplit,
    bloqueNecesidades, bloqueDeseos, bloqueAhorroInversion, hasBloqueEntries,
  } = budget;

  /** Optimistic omit until loadAll refreshes (avoids stale "ingresos reales"). */
  const [localOmitIncomeTxIds, setLocalOmitIncomeTxIds] = useState<Set<number>>(() => new Set());
  const [omittingTxId, setOmittingTxId] = useState<number | null>(null);
  const visibleRealIncomeTx = realIncomeTx.filter((tx) => !localOmitIncomeTxIds.has(tx.id));

  async function omitIncomeTx(txId: number) {
    setOmittingTxId(txId);
    setLocalOmitIncomeTxIds((prev) => new Set(prev).add(txId));
    try {
      await api.excludeTransactionFromBudget(txId);
      await loadAll({ silent: true });
      addToast("Ingreso omitido. Ya no cuenta en ingresos reales (sigue en Movimientos → Omitidas).", "success");
    } catch {
      setLocalOmitIncomeTxIds((prev) => {
        const next = new Set(prev);
        next.delete(txId);
        return next;
      });
      addToast("No se pudo omitir.", "error");
    } finally {
      setOmittingTxId(null);
    }
  }

  const ahorroProjection = useMemo(
    () => projectAhorroAtBudgetMonth({
      viewMonth: month,
      viewYear: year,
      recurringEntries,
      monthlyBudgets,
      accounts,
      investments,
    }),
    [month, year, recurringEntries, monthlyBudgets, accounts, investments],
  );
  const debtProjection = useMemo(
    () => projectDebtAtBudgetMonth({
      viewMonth: month,
      viewYear: year,
      debts,
      debtInstallments,
    }),
    [month, year, debts, debtInstallments],
  );
  const ahorroLongHorizon = useMemo(
    () => projectAhorroLongHorizon({ recurringEntries, monthlyBudgets, accounts, investments, goals }),
    [recurringEntries, monthlyBudgets, accounts, investments, goals],
  );

  function renderGoalProgress(goalId?: number | null) {
    const goal = findGoalById(goals, goalId);
    if (!goal) return null;
    const snapshot = buildGoalProgressSnapshot(
      goal, accounts, investments, recurringEntries, monthlyBudgets, month, year, goalProgressOpts,
    );
    return <GoalProgressBlock snapshot={snapshot} formatEUR={formatEUR} compact />;
  }

  const renderEntryScopeActions = (entry: RecurringEntry) => (
    <BudgetEntryScopeActions
      monthLabel={monthScopeLabel}
      onThisMonth={() => void pauseEntryThisMonth(entry)}
      onFollowing={() => void cancelEntryFromMonth(entry)}
    />
  );

  const renderIncomeRealBtn = (
    key: string,
    real: number,
    onSave: (val: number) => Promise<void>,
  ) => {
    const isEditing = editingIncomeKey === key;
    return isEditing ? (
      <input
        type="number" step="0.01" autoFocus value={editingVal}
        className="budget-amount-input"
        onChange={e => setEditingVal(e.target.value)}
        onBlur={() => {
          void onSave(parseFloat(editingVal) || 0).finally(() => setEditingIncomeKey(null));
        }}
        onKeyDown={e => {
          if (e.key === "Enter") {
            void onSave(parseFloat(editingVal) || 0).finally(() => setEditingIncomeKey(null));
          }
          if (e.key === "Escape") setEditingIncomeKey(null);
        }}
      />
    ) : (
      <button
        type="button"
        className="button-secondary sensitive budget-amount-btn"
        title="Editar real ingresado"
        onClick={() => { setEditingIncomeKey(key); setEditingVal(String(real)); }}
      >
        {formatEUR(real)}
      </button>
    );
  };

  const renderEntryEditBtn = (id: number, assigned: number) => {
    const isEditing = editingId === id;
    return isEditing ? (
      <input
        type="number" step="0.01" autoFocus value={editingVal}
        className="budget-amount-input"
        onChange={e => setEditingVal(e.target.value)}
        onBlur={() => { if (id > 0) void saveAssigned(id, parseFloat(editingVal) || 0); else setEditingId(null); }}
        onKeyDown={e => {
          if (e.key === "Enter" && id > 0) void saveAssigned(id, parseFloat(editingVal) || 0);
          if (e.key === "Escape") setEditingId(null);
        }}
      />
    ) : (
      <button
        type="button" className="button-secondary sensitive budget-amount-btn"
        title="Editar importe"
        onClick={() => { setEditingId(id); setEditingVal(String(assigned)); }}
      >
        {formatEUR(assigned)}
      </button>
    );
  };


  return (
    <>
    {recurringEntries.length === 0 && monthlyBudgets.length === 0 ? (
      <EmptyState
        icon="📋"
        title="Presupuesto sin partidas"
        description="Añade ingresos recurrentes, suscripciones o gastos fijos para empezar a planificar el mes."
        actionLabel="Ir a Ingresos"
        onAction={() => onNavigate("Ingresos")}
      />
    ) : null}

    {showFirstMonthAssistant && (
      <div className="budget-banner budget-banner--template" role="status">
        <div>
          <strong>Primer presupuesto del mes</strong>
          <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.82rem" }}>
            Ingresos esperados: {formatEUR(totalIncomeExpected)}.
            {" "}Sugerencia 50/30/20: Libre {formatEUR(templateSplit.deseos)} · Ahorro {formatEUR(templateSplit.ahorro)}
            {" "}(necesidades ~{formatEUR(templateSplit.necesidades)} con fondos y suscripciones).
          </p>
        </div>
        <div className="inline-actions">
          <button
            type="button"
            disabled={applyingTemplate}
            onClick={() => void apply503020Template()}
          >
            {applyingTemplate ? "Aplicando…" : "Aplicar plantilla 50/30/20"}
          </button>
          {!prevMonthHasBudget && (
            <button type="button" className="button-secondary" disabled={copying} onClick={() => void copyFromPrev()}>
              {copying ? "Copiando…" : `Copiar de ${MONTH_NAMES[prevMonth - 1]}`}
            </button>
          )}
          <button type="button" className="button-secondary" onClick={() => onNavigate("Historial Laboral")}>
            Configurar nómina
          </button>
        </div>
      </div>
    )}

    {/* Sin overrides: aviso + copia */}
    {!hasOverrides && recurringEntries.length > 0 && !showFirstMonthAssistant && (
      <div className="budget-banner">
        <span className="muted">
          Mostrando valores base — este mes aún no tiene presupuesto personalizado.
        </span>
        <button
          type="button"
          className="button-secondary"
          disabled={copying}
          onClick={() => void copyFromPrev()}
        >
          {copying ? "Copiando…" : `Copiar de ${MONTH_NAMES[prevMonth - 1]} ${prevYear}`}
        </button>
      </div>
    )}

    {showIncomeReconcileBanner && (
      <div className="budget-banner budget-banner--reconcile" role="status">
        <div>
          <strong>Conciliar ingresos</strong>
          <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.82rem" }}>
            Real en presupuesto: {formatEUR(totalIncomeReal)} · En transacciones: {formatEUR(totalIncomeFromTx)}
            {" "}(diferencia {(incomeTxMismatchPct * 100).toFixed(0)}%).
            Ajusta el real en Ingresos o revisa movimientos importados.
          </p>
        </div>
        <div className="inline-actions">
          <button type="button" className="button-secondary" onClick={() => onNavigate("Ingresos")}>
            Ir a Ingresos
          </button>
          <button type="button" className="button-secondary" onClick={() => onNavigate("Historial Laboral")}>
            Historial Laboral
          </button>
        </div>
      </div>
    )}

    {budgetOverAssigned && (
      <div className="budget-banner budget-banner--warn" role="alert">
        <span>
          Presupuesto sobreasignado en <strong>{formatEUR(Math.abs(availableToAssign))}</strong>.
          {" "}Revisa partidas, ingresos reales o excluye partidas que no aplican este mes.
        </span>
      </div>
    )}

    {/* Para asignar */}
    <article className="card budget-card--assign" style={{ borderLeftColor: availColor }}>
      <div className="budget-summary-card__body">
        <div className="budget-summary-card__hero">
          <div className="budget-summary-card__label">
            Para asignar · {MONTH_NAMES[month - 1]} {year}
          </div>
          <div className="budget-summary-card__value" style={{ color: availColor }}>
            {formatEUR(availableToAssign)}
          </div>
          {Math.abs(availableToAssign) < 0.01 && (
            <div style={{ fontSize: "0.8rem", color: "var(--color-positive)", marginTop: "0.3rem" }}>
              ✓ Presupuesto en cero — cada euro tiene destino
            </div>
          )}
          {budgetOverAssigned && (
            <div style={{ fontSize: "0.8rem", color: "var(--color-negative)", marginTop: "0.3rem" }}>
              Sobreasignado — faltan {formatEUR(Math.abs(availableToAssign))} de ingresos
            </div>
          )}
          {availableToAssign > 0.01 && (
            <button
              type="button"
              className="button-secondary"
              style={{ marginTop: "0.65rem", fontSize: "0.82rem" }}
              disabled={libreSubmit.saving}
              onClick={() => void libreSubmit.run(assignAvailableToLibre)}
            >
              {libreSubmit.saving ? "Asignando…" : `Asignar ${formatEUR(availableToAssign)} a Libre (Deseos)`}
            </button>
          )}
        </div>
        <div className="budget-summary-card__meta muted">
          <div>Ingresos esperados: <strong className="sensitive">{formatEUR(totalIncomeExpected)}</strong></div>
          <div>Real ingresado: <strong className="sensitive">{formatEUR(totalIncomeFromTx)}</strong></div>
          {totalIncomeReal > 0.01 && Math.abs(totalIncomeFromTx - totalIncomeReal) > 0.01 && (
            <div><small>Según presupuesto: {formatEUR(totalIncomeReal)}</small></div>
          )}
          <div>Gastos asignados: <strong>{formatEUR(totalGastosAssigned)}</strong></div>
          {totalAhorroInversionAssigned > 0 && <div>Ahorro e inversión asignado: <strong className="positive">{formatEUR(totalAhorroInversionAssigned)}</strong></div>}
        </div>
      </div>
    </article>

    {excludedEntries.length > 0 && (
      <article className="card budget-card--excluded">
        <BudgetGroupHeader
          groupId="__excluded__"
          title={`Excluidas en ${MONTH_NAMES[month - 1]} ${year}`}
          expanded={expandedGroups.has("__excluded__")}
          onToggle={toggleGroup}
          summary={
            <>
              {excludedEntries.length} partida{excludedEntries.length !== 1 ? "s" : ""} sin contar en totales
            </>
          }
        />
        {expandedGroups.has("__excluded__") && (
          <ul className="list budget-list">
            {excludedEntries.map((entry) => (
              <li key={entry.id} className="budget-row--excluded">
                <span>
                  {entry.nombre}
                  <small className="muted" style={{ marginLeft: "0.4rem" }}>
                    {entry.es_ingreso ? "ingreso" : entry.tipo_partida ?? "gasto"}
                    {" · "}base {formatEUR(entry.monto_estimado)}
                  </small>
                </span>
                <button
                  type="button"
                  className="button-secondary"
                  style={{ fontSize: "0.78rem" }}
                  onClick={() => void restoreToMonth(entry.id)}
                >
                  Restaurar
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>
    )}

    {/* 50/30/20 gauges */}
    {hasBloqueEntries && totalIncomeReal > 0 && (
      <article className="card" style={{ padding: "0.875rem 1rem" }}>
        <div className="budget-gauges-panel__title">Regla 50/30/20</div>
        <div className="budget-gauges-panel__grid">
          <BudgetGauge label="Necesidades" pct={bloqueNecesidades / totalIncomeReal * 100} target={50} targetLabel="≤50%" favorable={false} amount={bloqueNecesidades} />
          <BudgetGauge label="Deseos" pct={bloqueDeseos / totalIncomeReal * 100} target={30} targetLabel="≤30%" favorable={false} amount={bloqueDeseos} />
          <BudgetGauge label="Ahorro e inversión" pct={bloqueAhorroInversion / totalIncomeReal * 100} target={20} targetLabel="≥20%" favorable amount={bloqueAhorroInversion} />
        </div>
      </article>
    )}

    {/* Ingresos */}
    <article className="card">
      <BudgetGroupHeader
        groupId="__income__"
        title="Ingresos"
        expanded={expandedGroups.has("__income__")}
        onToggle={toggleGroup}
        summary={
          <>Real: <strong className="sensitive">{formatEUR(totalIncomeFromTx)}</strong></>
        }
        actions={
          <button type="button" onClick={() => setAddingIncome(true)}>+ Ingreso</button>
        }
      />
      {expandedGroups.has("__income__") && (
        <ul className="list budget-list">
          {payrollRows.length === 0 && otherIncomeEntries.length === 0 && (
            <li className="muted" style={{ fontStyle: "italic" }}>
              Sin ingresos. Configura tu nómina en <button type="button" className="btn-link" onClick={() => onNavigate("Historial Laboral")}>Historial Laboral</button> o añade otras fuentes.
            </li>
          )}
          {payrollRows.map(row => {
            const real = incomeRealAmount(row.expected, row.recurringEntryId, mbMap, row.prevBreakdownNeto);
            const key = `payroll:${row.empresa}`;
            return (
              <li key={row.key}>
                  <span>
                  Nómina · {row.empresa}
                  <small className="muted" style={{ marginLeft: "0.4rem" }}>
                    esperado {formatEUR(row.expected)}
                    {row.fromBreakdown ? " · Laboral" : row.prevBreakdownNeto != null ? " · mes anterior" : " · estimado"}
                  </small>
                </span>
                <div className="inline-actions">
                  <span className="muted" style={{ fontSize: "0.78rem" }}>
                    {row.recurringEntryId != null && mbMap[row.recurringEntryId] != null ? "Real" : row.prevBreakdownNeto != null ? "Real (auto)" : "Real"}
                  </span>
                  {renderIncomeRealBtn(key, real, (val) => savePayrollReal(row.empresa, val))}
                  <button type="button" className="button-secondary" style={{ padding: "0.25rem 0.4rem" }} title="Editar en Laboral" onClick={() => onNavigate("Historial Laboral")}>Laboral</button>
                </div>
              </li>
            );
          })}
          {otherIncomeEntries.map(entry => {
            const expected = entry.monto_estimado;
            const real = incomeRealAmount(expected, entry.id, mbMap);
            const key = `income:${entry.id}`;
            return (
              <li key={entry.id}>
                <span>
                  {entry.nombre}
                  {entry.categoria && entry.categoria !== "General" && (
                    <small className="muted" style={{ marginLeft: "0.35rem" }}>{entry.categoria}</small>
                  )}
                  <small className="muted" style={{ marginLeft: "0.4rem" }}>esperado {formatEUR(expected)}</small>
                </span>
                <div className="inline-actions">
                  <span className="muted" style={{ fontSize: "0.78rem" }}>Real</span>
                  {renderIncomeRealBtn(key, real, (val) => saveAssigned(entry.id, val))}
                  <button type="button" className="button-secondary" style={{ padding: "0.25rem 0.4rem" }} title="Editar fuente" onClick={() => setEditingIncomeSource(entry)}>✎</button>
                  {renderEntryScopeActions(entry)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {expandedGroups.has("__income__") && visibleRealIncomeTx.length > 0 && (
        <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-soft)" }}>
          <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.35rem" }}>
            Registrados en Movimientos · ⊘ omite (sale de ingresos reales)
          </p>
          <ul className="list budget-list">
            {visibleRealIncomeTx.map(tx => (
              <li key={tx.id}>
                <span>
                  <span className="muted" style={{ marginRight: "0.4rem" }}>{tx.date.slice(5, 10)}</span>
                  {tx.description_raw || "—"}
                </span>
                <div className="inline-actions">
                  <strong className="sensitive positive">{formatEUR(tx.amount)}</strong>
                  <button
                    type="button"
                    className="button-secondary"
                    style={{ padding: "0.25rem 0.4rem" }}
                    title="Omitir este ingreso del presupuesto"
                    aria-label={`Omitir ingreso ${tx.description_raw || ""}`}
                    disabled={omittingTxId === tx.id}
                    onClick={() => void omitIncomeTx(tx.id)}
                  >
                    ⊘
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>

    {(addingIncome || editingIncomeSource) && (
      <IncomeSourceModal
        item={editingIncomeSource ?? undefined}
        month={month}
        year={year}
        excludeCategories={["Nómina"]}
        onClose={() => { setAddingIncome(false); setEditingIncomeSource(null); }}
        onSave={async (payload) => {
          await saveIncomeSource(payload);
        }}
      />
    )}

    {/* ── Fondos ── */}
    {fondoEntries.length > 0 && (
      <article className="card budget-card--fondos">
        <BudgetGroupHeader
          groupId="__fondos__"
          title="Fondos"
          expanded={expandedGroups.has("__fondos__")}
          onToggle={toggleGroup}
          summary={<>Aportación: <strong>{formatEUR(totalFondosAssigned)}</strong></>}
        />
        {expandedGroups.has("__fondos__") && (
          <ul className="list budget-list">
            {[...fondoEntries].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map(entry => {
              const assigned = mbMap[entry.id] ?? entry.monto_estimado;
              const balance = fondoBalances[entry.id];
              const goalBlock = entry.goal_id ? renderGoalProgress(entry.goal_id) : null;
              return (
                <li key={entry.id} style={goalBlock ? { flexDirection: "column", alignItems: "stretch", gap: "0.4rem" } : undefined}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                    <span>{entry.nombre}</span>
                    {entry.categoria && entry.categoria !== "General" && (
                      <span className="muted budget-tag">{entry.categoria}</span>
                    )}
                    {!entry.es_fijo && <span className="muted" style={{ fontSize: "0.68rem" }}>var</span>}
                  </span>
                  <div className="inline-actions" style={{ fontSize: "0.83rem" }}>
                    {balance !== undefined && (
                      <span className={balance >= 0 ? "budget-balance-positive" : "budget-balance-negative"}>{formatEUR(balance)} acum.</span>
                    )}
                    {renderEntryEditBtn(entry.id, assigned)}
                    <button type="button" className="button-secondary" style={{ padding: "0.25rem 0.4rem" }} title="Editar" onClick={() => openEdit(entry)}>✎</button>
                    {renderEntryScopeActions(entry)}
                  </div>
                  </div>
                  {goalBlock}
                </li>
              );
            })}
          </ul>
        )}
      </article>
    )}

    {/* ── Gastos planificados ── */}
    {(() => {
      const pendingWishlist = wishlist.filter(isWishlistActive);
      return (
      <article className="card budget-card--gastos">
        <BudgetGroupHeader
          groupId="__puntual__"
          title="Gastos planificados"
          expanded={expandedGroups.has("__puntual__")}
          onToggle={toggleGroup}
          summary={puntualGastoEntries.length > 0 ? <>Asignado: <strong>{formatEUR(totalPuntualAssigned)}</strong></> : undefined}
          actions={pendingWishlist.length > 0 ? (
            <button type="button" className="button-secondary" style={{ fontSize: "0.78rem", padding: "0.25rem 0.6rem" }} onClick={() => setShowWishlistPicker(true)}>
              + Lista de deseos
            </button>
          ) : undefined}
        />
        {puntualGastoEntries.length === 0 && (
          <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>Sin gastos puntuales este mes.</p>
        )}
        {expandedGroups.has("__puntual__") && puntualGastoEntries.length > 0 && (
          <ul className="list budget-list">
            {[...puntualGastoEntries].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map(entry => {
              const assigned = mbMap[entry.id] ?? entry.monto_estimado;
              const cat = normalizeCategory(entry.categoria) || (entry.categoria || "").trim() || "Sin categoría";
              const spent = spentByCat[cat] || 0;
              const available = assigned - spent;
              const goalBlock = entry.goal_id ? renderGoalProgress(entry.goal_id) : null;
              return (
                <li key={entry.id} style={goalBlock ? { flexDirection: "column", alignItems: "stretch", gap: "0.4rem" } : undefined}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                    <span>{entry.nombre}</span>
                    {isLibrePlannedGasto(entry) ? (
                      <span className="muted budget-tag">Deseos</span>
                    ) : cat !== "Sin categoría" && cat !== "General" ? (
                      <span className="muted budget-tag">{cat}</span>
                    ) : null}
                  </span>
                  <div className="inline-actions" style={{ fontSize: "0.83rem" }}>
                    {spent > 0 && <span className="muted">Gast: {formatEUR(spent)}</span>}
                    {spent > 0 && <span className={available < 0 ? "negative" : ""}>{formatEUR(available)}</span>}
                    {renderEntryEditBtn(entry.id, assigned)}
                    <button type="button" className="button-secondary" style={{ padding: "0.25rem 0.4rem" }} title="Editar" onClick={() => openEdit(entry)}>✎</button>
                    {renderEntryScopeActions(entry)}
                  </div>
                  </div>
                  {goalBlock}
                </li>
              );
            })}
          </ul>
        )}
      </article>
      );
    })()}

    <GlassModal
      isOpen={showWishlistPicker}
      onClose={() => setShowWishlistPicker(false)}
      title="Añadir desde lista de deseos"
      contentClassName="modal-content--narrow"
    >
      <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
        Se añadirá como gasto puntual en {MONTH_NAMES[month - 1]} {year}. El deseo permanece en la lista hasta marcarlo como comprado.
      </p>
      <ul className="list wishlist-picker-list">
        {wishlist.filter(isWishlistActive).sort((a, b) => {
          const order = { alta: 0, media: 1, baja: 2 };
          return order[a.prioridad] - order[b.prioridad];
        }).map(w => (
          <li key={w.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
            <span>
              {w.nombre}
              {w.recurring_entry_id && (
                <span className="muted" style={{ marginLeft: "0.35rem", fontSize: "0.72rem" }}>(en presupuesto)</span>
              )}
              {w.prioridad === "alta" && <span className="budget-priority-dot">●</span>}
              {w.monto_estimado != null && (
                <span className="muted" style={{ marginLeft: "0.4rem", fontSize: "0.8rem" }}>{formatEUR(w.monto_estimado)}</span>
              )}
            </span>
            <button type="button" style={{ fontSize: "0.8rem", padding: "0.2rem 0.6rem" }} onClick={() => void promoteWishlistItem(w.id, w.nombre)}>
              Añadir
            </button>
          </li>
        ))}
      </ul>
      <div className="modal-actions">
        <button type="button" className="button-secondary" onClick={() => setShowWishlistPicker(false)}>Cerrar</button>
      </div>
    </GlassModal>

    {/* ── Deudas ── */}
    {activeDebts.length > 0 && (
      <article className="card budget-card--deudas">
        <BudgetGroupHeader
          groupId="__deudas__"
          title="Deudas"
          expanded={expandedGroups.has("__deudas__")}
          onToggle={toggleGroup}
          summary={<>Cuotas: <strong className="negative">{formatEUR(totalDeudasAssigned)}</strong></>}
        />
        {expandedGroups.has("__deudas__") && (
          <>
          <ModalFormError error={debtMarkSubmit.error} />
          <ModalFormError error={debtExtraSubmit.error} />
          {debtProjection.isFutureOrCurrent && debtProjection.rows.length > 0 && (
            <p className="budget-projection-hint" style={{ fontSize: "0.8rem", margin: "0.35rem 0 0.65rem" }}>
              Proyectado a fin de {MONTH_NAMES[month - 1]} {year}:{" "}
              <strong className="sensitive negative">{formatEUR(debtProjection.totalProjectedRemaining)}</strong>
              {" "}pendiente
              {debtProjection.totalPlannedPayments > 0.005 && (
                <span className="muted">
                  {" "}· ahora {formatEUR(debtProjection.totalRemainingNow)}
                  {" − "}
                  plan {formatEUR(debtProjection.totalPlannedPayments)}
                </span>
              )}
            </p>
          )}
          <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 0.5rem" }}>
            <button type="button" className="button-secondary" style={{ fontSize: "inherit", padding: "0.1rem 0.35rem" }} onClick={() => onNavigate("Pasivos")}>
              Ir a Pasivos
            </button>
            {" "}para editar planilla o registrar pagos.
          </p>
          {debtItems.length === 0 ? (
            <EmptyState
              icon="📅"
              title={`Sin cuotas en ${MONTH_NAMES[month - 1]} ${year}`}
              description="Cambia de mes o revisa la planilla en Pasivos."
              actionLabel="Ir a Pasivos"
              onAction={() => onNavigate("Pasivos")}
            />
          ) : (
          <ul className="list budget-list">
            {debtItems.map(item => {
              const debt = debts.find((d) => d.id === item.debtId);
              const planilla = debtInstallments.filter((i) => i.debt_id === item.debtId);
              const inst = item.installmentId > 0
                ? debtInstallments.find((i) => i.id === item.installmentId)
                : undefined;
              const status = inst && debt ? installmentStatus(inst, debt, planilla) : null;
              const paid = debt ? Number(debt.monto_pagado ?? 0) : 0;
              const total = debt ? Number(debt.monto_total ?? 0) : 0;
              const debtPct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
              const remaining = Math.max(0, total - paid);
              const showDebtProgress = !!debt && total > 0;
              return (
              <li key={item.id} style={showDebtProgress ? { flexDirection: "column", alignItems: "stretch", gap: "0.4rem" } : undefined}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                <div>
                  <span>{item.nombre}</span>
                  {item.numeroCuota > 0 && (
                    <small className="muted" style={{ marginLeft: "0.35rem" }}>· cuota {item.numeroCuota}</small>
                  )}
                  {item.nombre !== item.acreedor && <small className="muted" style={{ marginLeft: "0.4rem" }}>· {item.acreedor}</small>}
                  {item.paidInMonth && (
                    <small className="muted" style={{ marginLeft: "0.35rem" }}>· no suma al total</small>
                  )}
                  {item.excludedFromTotal && (
                    <small className="muted" style={{ marginLeft: "0.35rem" }}>· ya en gastos fijos (no suma al total)</small>
                  )}
                  {status && (
                    <span className={`debt-inst-status debt-inst-status--${status}`} style={{ marginLeft: "0.35rem" }}>
                      {status === "pagada" ? "Pagada" : status === "vencida" ? "Vencida" : "Pendiente"}
                    </span>
                  )}
                  {item.fechaVencimiento && (
                    <small className="muted" style={{ marginLeft: "0.35rem" }}>
                      · {new Date(item.fechaVencimiento + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" })}
                    </small>
                  )}
                </div>
                <div className="inline-actions" style={{ fontSize: "0.83rem" }}>
                  <span className="muted budget-amount-btn">{formatEUR(item.assigned)} <small>este mes</small></span>
                  {item.installmentId > 0 && status !== "pagada" && !item.paidInMonth && (
                    <button
                      type="button"
                      className="button-secondary"
                      style={{ fontSize: "0.75rem", padding: "0.2rem 0.45rem" }}
                      disabled={debtMarkSubmit.saving}
                      onClick={() => void markDebtInstallmentPaid(item.installmentId, item.debtId)}
                    >
                      {debtMarkSubmit.saving ? "Guardando…" : "Marcar pagada"}
                    </button>
                  )}
                </div>
                </div>
                {showDebtProgress && (
                  <div style={{ fontSize: "0.78rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem", gap: "0.5rem", flexWrap: "wrap" }} className="muted">
                      <span>
                        Pagado: <span className="sensitive">{formatEUR(paid)}</span>
                        {" / "}
                        <span className="sensitive">{formatEUR(total)}</span>
                      </span>
                      <span>
                        <span className="sensitive">{debtPct.toFixed(1)}%</span>
                        {remaining <= 0.01 ? (
                          <span className="budget-goal-done"> · ✓ saldada</span>
                        ) : (
                          <> · pendiente <span className="sensitive negative">{formatEUR(remaining)}</span></>
                        )}
                      </span>
                    </div>
                    {(() => {
                      const proj = debtProjection.rows.find((r) => r.debtId === item.debtId);
                      if (!proj || !debtProjection.isFutureOrCurrent) return null;
                      if (Math.abs(proj.projectedRemaining - remaining) < 0.05) return null;
                      return (
                        <div className="muted" style={{ marginBottom: "0.25rem" }}>
                          Proyectado a {MONTH_NAMES[month - 1]}:{" "}
                          <strong className="sensitive negative">{formatEUR(proj.projectedRemaining)}</strong>
                          {proj.plannedPaymentsThroughView > 0.005 && (
                            <> (−{formatEUR(proj.plannedPaymentsThroughView)} en cuotas)</>
                          )}
                        </div>
                      );
                    })()}
                    <div className="budget-goal-track">
                      <div
                        className={`budget-goal-fill ${remaining <= 0.01 ? "budget-goal-fill--done" : "budget-goal-fill--debt"}`}
                        style={{ width: `${debtPct}%` }}
                      />
                    </div>
                    {debt && remaining > 0.01 && debtProjection.isFutureOrCurrent && (
                      <DebtExtraPaymentControl
                        debt={debt}
                        planilla={planilla}
                        month={month}
                        year={year}
                        formatEUR={formatEUR}
                        onCommit={commitDebtExtraPayment}
                        submitting={debtExtraSubmit.saving}
                      />
                    )}
                  </div>
                )}
              </li>
              );})}
          </ul>
          )}
          </>
        )}
      </article>
    )}


    {/* Ahorro e inversión */}
    {ahorroInversionEntries.length > 0 && (
      <article className="card budget-card--ahorro-inversion">
        <BudgetGroupHeader
          groupId="__ahorro_inversion__"
          title="Ahorro e inversión"
          expanded={expandedGroups.has("__ahorro_inversion__")}
          onToggle={toggleGroup}
          summary={<>Asignado: <strong className="positive sensitive">{formatEUR(totalAhorroInversionAssigned)}</strong></>}
        />
        {expandedGroups.has("__ahorro_inversion__") && (
          <>
          {ahorroProjection.isFutureOrCurrent && ahorroProjection.rows.length > 0 && (
            <p className="budget-projection-hint" style={{ fontSize: "0.8rem", margin: "0.35rem 0 0.65rem" }}>
              Proyectado a fin de {MONTH_NAMES[month - 1]} {year}:{" "}
              <strong className="sensitive positive">{formatEUR(ahorroProjection.totalProjectedCompound)}</strong>
              {ahorroProjection.totalPlannedThroughView > 0.005 && (
                <span className="muted">
                  {" "}· ahora {formatEUR(ahorroProjection.totalBalanceNow)}
                  {" + "}
                  plan {formatEUR(ahorroProjection.totalPlannedThroughView)}
                </span>
              )}
            </p>
          )}
          <ul className="list budget-list">
            {ahorroInversionEntries.map(entry => {
              const assigned = mbMap[entry.id] ?? entry.monto_estimado;
              const destino = destinoFromEntry(entry);
              const linkedAccount = destino === "cuenta" && entry.cuenta_destino_id ? accounts.find(a => a.id === entry.cuenta_destino_id) : null;
              const carteraTotal = destino === "cartera" && entry.cartera_destino
                ? investments.filter(i => (i.cartera || "").trim() === entry.cartera_destino).reduce((s, i) => s + Number(i.valor_actual), 0)
                : null;
              const linkedGoal = findGoalForEntry(goals, entry);
              const goalSnapshot = linkedGoal
                ? buildGoalProgressSnapshot(linkedGoal, accounts, investments, recurringEntries, monthlyBudgets, month, year, goalProgressOpts)
                : null;
              const hasSinkingGoal = !goalSnapshot && destino === "cuenta" && entry.objetivo_monto && entry.objetivo_monto > 0;
              const accumulated = linkedAccount ? Number(linkedAccount.balance_actual) : null;
              const pctAccum = hasSinkingGoal && accumulated !== null ? Math.min(accumulated / entry.objetivo_monto! * 100, 100) : null;
              const monthsToGoal = hasSinkingGoal && assigned > 0
                ? Math.ceil(((entry.objetivo_monto ?? 0) - (accumulated ?? 0)) / assigned)
                : null;
              const projRow = ahorroProjection.rows.find((r) => r.entryId === entry.id);
              const showProj = Boolean(
                projRow
                && ahorroProjection.isFutureOrCurrent
                && (projRow?.plannedThroughView ?? 0) > 0.005,
              );
              const longRow = ahorroLongHorizon.find((r) => r.entryId === entry.id);
              const showGoalBlock = goalSnapshot !== null || hasSinkingGoal || showProj || Boolean(longRow);
              return (
                <li key={entry.id} style={{ flexDirection: showGoalBlock ? "column" : undefined, alignItems: showGoalBlock ? "stretch" : undefined, gap: showGoalBlock ? "0.4rem" : undefined }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                    <div>
                      <span className="budget-destino-badge">{destino === "cuenta" ? "Cuenta" : "Cartera"}</span>
                      <span>{entry.nombre}</span>
                      {linkedAccount && (
                        <small className="muted" style={{ marginLeft: "0.4rem" }}>
                          · {linkedAccount.alias_real} (<span className="positive sensitive">{formatEUR(Number(linkedAccount.balance_actual))}</span>)
                        </small>
                      )}
                      {destino === "cartera" && entry.cartera_destino && (
                        <small className="muted" style={{ marginLeft: "0.4rem" }}>
                          · {entry.cartera_destino}
                          {carteraTotal !== null && (
                            <> (<span className="positive sensitive">{formatEUR(carteraTotal)}</span>)</>
                          )}
                        </small>
                      )}
                    </div>
                    <div className="inline-actions">
                      {renderEntryEditBtn(entry.id, assigned)}
                      <button type="button" className="button-secondary" style={{ padding: "0.25rem 0.4rem" }} title="Editar partida" onClick={() => openEdit(entry)}>✎</button>
                      {renderEntryScopeActions(entry)}
                    </div>
                  </div>
                  {goalSnapshot && (
                    <GoalProgressBlock snapshot={goalSnapshot} formatEUR={formatEUR} compact />
                  )}
                  {showProj && projRow && (
                      <div className="muted" style={{ fontSize: "0.78rem" }}>
                        Proyectado a {MONTH_NAMES[month - 1]}:{" "}
                        <strong className="sensitive positive">{formatEUR(projRow.projectedCompound ?? projRow.projected)}</strong>
                        <span>
                          {" "}({formatEUR(projRow.balanceNow)} ahora + {formatEUR(projRow.plannedThroughView)} plan
                          {projRow.projectedCompound !== null && (
                            <> + {formatEUR(round2(projRow.projectedCompound - projRow.projected))} interés</>
                          )}
                          )
                        </span>
                      </div>
                  )}
                  {longRow && (
                    <div className="muted" style={{ fontSize: "0.78rem" }}>
                      A {formatMonthYear(longRow.targetMonth, longRow.targetYear)}
                      {longRow.horizonSource === "fallback" && " (estimado)"}
                      {" "}({entry.rentabilidad_anual_pct}% anual):{" "}
                      <strong className="sensitive positive">{formatEUR(longRow.projectedCompound)}</strong>
                      <span> ({formatEUR(longRow.gains)} en intereses)</span>
                    </div>
                  )}
                  {hasSinkingGoal && (
                    <div style={{ fontSize: "0.78rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }} className="muted">
                        <span>
                          Meta: <span className="sensitive">{formatEUR(entry.objetivo_monto!)}</span>
                          {entry.objetivo_fecha && <> · {new Date(entry.objetivo_fecha).toLocaleDateString("es", { month: "short", year: "numeric" })}</>}
                        </span>
                        {monthsToGoal !== null && monthsToGoal > 0 && (
                          <span>{monthsToGoal} meses restantes</span>
                        )}
                        {pctAccum !== null && pctAccum >= 100 && <span className="budget-goal-done">✓ Objetivo alcanzado</span>}
                      </div>
                      {pctAccum !== null && (
                        <div className="budget-goal-track">
                          <div
                            className={`budget-goal-fill ${pctAccum >= 100 ? "budget-goal-fill--done" : "budget-goal-fill--progress"}`}
                            style={{ width: `${pctAccum}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          </>
        )}
      </article>
    )}

    {/* ── Suscripciones ── */}
    {(() => {
      const pausedThisMonth = allSubscriptions.filter(s => subscriptionStarted(s, month, year) && subscriptionMonthExcluded(s, month));
      const notStartedYet = allSubscriptions.filter(s => !subscriptionStarted(s, month, year));

      const nameCounts: Record<string, number> = {};
      for (const sub of allSubscriptions) {
        const key = sub.nombre.toLowerCase().trim();
        nameCounts[key] = (nameCounts[key] || 0) + 1;
      }
      const duplicates = new Set(
        Object.entries(nameCounts).filter(([, c]) => c > 1).map(([k]) => k)
      );

      const isSubsOpen = expandedGroups.has("__subs__");
      return (
        <article className="card budget-card--subs">
          <BudgetGroupHeader
            groupId="__subs__"
            title="Suscripciones y facturas"
            expanded={isSubsOpen}
            onToggle={toggleGroup}
            summary={activeSubscriptions.length > 0 ? <><strong>{formatEUR(totalSubsAssigned)}</strong>/mes</> : undefined}
          />

          {isSubsOpen && (
            <>
              {duplicates.size > 0 && (
                <div className="budget-dup-banner">
                  ⚠ Posibles duplicados: {[...duplicates].join(", ")}. Verifica que no estés pagando dos veces.
                </div>
              )}
              {notStartedYet.length > 0 && (
                <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: "0.5rem" }}>
                  Aún no activas este mes: {notStartedYet.map(s => s.nombre).join(", ")}
                </div>
              )}
              {pausedThisMonth.length > 0 && (
                <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: "0.5rem" }}>
                  Pausadas este mes: {pausedThisMonth.map(s => s.nombre).join(", ")}
                </div>
              )}
              {activeSubscriptions.length === 0 ? (
                <p className="muted" style={{ fontSize: "0.875rem", marginTop: "0.75rem" }}>Sin suscripciones registradas.</p>
              ) : (
              <ul className="list budget-list">
                {activeSubscriptions.map((sub) => {
                const isAnnual = isAnnualSubscription(sub.frecuencia);
                const hasOverride = mbMap[sub.id] !== undefined;
                const monthly = hasOverride
                  ? mbMap[sub.id]
                  : subscriptionMonthlyAmount(sub, month, year);
                const amountThisMonth = hasOverride
                  ? (isAnnual ? monthly * 12 : monthly)
                  : subscriptionAmountForMonth(sub, month, year);
                const isDupe = duplicates.has(sub.nombre.toLowerCase().trim());

                return (
                  <li key={sub.id}>
                    <span>
                      {sub.nombre}
                      {isDupe && <span className="negative" style={{ marginLeft: "0.35rem", fontSize: "0.7rem" }}>⚠ duplicado</span>}
                      {isAnnual && <small className="muted" style={{ marginLeft: "0.35rem" }}>anual</small>}
                    </span>
                    <div className="inline-actions" style={{ fontSize: "0.83rem" }}>
                      <span className="muted sensitive">
                        {formatEUR(amountThisMonth)}{isAnnual ? "/año" : "/mes"}
                        {isAnnual && <small className="muted"> ({formatEUR(monthly)}/mes)</small>}
                      </span>
                      <button type="button" className="button-secondary" style={{ padding: "0.2rem 0.4rem" }}
                        onClick={() => openEdit(sub)}>✎</button>
                      {renderEntryScopeActions(sub)}
                    </div>
                  </li>
                );
              })}
              </ul>
              )}
            </>
          )}
        </article>
      );
    })()}
    </>
  );
}
