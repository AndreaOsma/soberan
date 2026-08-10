import type { Transaction, RecurringEntry } from "../../types";
import { isRealExpense, isRealIncome } from "../../utils/internalTransfer";
import { budgetExpenseAmount } from "../../utils/expenseSplits";
import { normalizeCategory, SUBSCRIPTION_CATEGORY } from "../../utils/expenseCategories";
import type { MenuKey } from "../../config/ui";
import type { MonthlyBudgetTotals } from "../../utils/budgetTotals";
import { parseJsonValue } from "../../utils/format";
import { buildMonthlyCloseNarrative } from "../../utils/monthlyCloseNarrative";

type MatchResult = {
  entry: RecurringEntry;
  tx: Transaction | null;
};

function matchRecurringToTx(entries: RecurringEntry[], txs: Transaction[]): MatchResult[] {
  const expenses = txs.filter((tx) => isRealExpense(tx));
  const expenseEntries = entries.filter(e => !e.es_ingreso);

  type Candidate = { entryIdx: number; txId: number; score: number; tx: Transaction };
  const candidates: Candidate[] = [];

  for (let i = 0; i < expenseEntries.length; i++) {
    const entry = expenseEntries[i];
    for (const tx of expenses) {
      let score = 0;
      if (entry.categoria && tx.category_anon &&
          entry.categoria.toLowerCase() === tx.category_anon.toLowerCase()) score += 4;
      const txAmt = Math.abs(tx.amount);
      const entAmt = entry.monto_estimado;
      if (entAmt > 0) {
        const diff = Math.abs(txAmt - entAmt);
        const pct = diff / entAmt;
        if (pct <= 0.05 || diff <= 5) score += 4;
        else if (pct <= 0.15) score += 2;
        else if (pct <= 0.30) score += 1;
      }
      const desc = (tx.description_raw || "").toLowerCase();
      const name = (entry.nombre || "").toLowerCase();
      const empresa = (entry.empresa || "").toLowerCase();
      if (name && desc.includes(name)) score += 2;
      else if (empresa && desc.includes(empresa)) score += 1;
      if (score >= 3) candidates.push({ entryIdx: i, txId: tx.id, score, tx });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const matchedEntries = new Set<number>();
  const usedTxIds = new Set<number>();
  const assignedTx = new Map<number, Transaction>();

  for (const c of candidates) {
    if (!matchedEntries.has(c.entryIdx) && !usedTxIds.has(c.txId)) {
      assignedTx.set(c.entryIdx, c.tx);
      matchedEntries.add(c.entryIdx);
      usedTxIds.add(c.txId);
    }
  }

  return expenseEntries.map((entry, i) => ({ entry, tx: assignedTx.get(i) ?? null }));
}

type BudgetTotalsSnapshot = Pick<
  MonthlyBudgetTotals,
  "monthlyIncome" | "monthlyExpense" | "monthlySavings" | "monthlyConsumption" | "monthlyDebtPayments" | "monthlyAhorroInversion"
>;

type ClosureSnapshot = {
  period: string;
  real_income: number;
  real_expense: number;
  real_savings: number;
  savings_rate_pct: number | null;
  net_worth: number;
  budget_income?: number;
  budget_expense?: number;
  budget_savings?: number;
  budget_consumption?: number;
  budget_debt?: number;
  budget_ahorro?: number;
  closed_at: string;
};

const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatDelta(current: number, previous: number, formatEUR: (v: number) => string): string {
  const delta = current - previous;
  if (Math.abs(delta) < 0.01) return "sin cambio";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${formatEUR(delta)} vs mes anterior`;
}

type Props = {
  month: number;
  year: number;
  monthlyTransactions: Transaction[];
  recurringEntries: RecurringEntry[];
  netWorth: number;
  budgetTotals: BudgetTotalsSnapshot;
  targetSavingsPct: number;
  settings: Record<string, string>;
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  saveSetting: (key: string, val: string) => Promise<void>;
  onNavigateToTx: () => void;
  onNavigateToBudget: () => void;
  onNavigate: (menu: MenuKey) => void;
  onCopyBudgetToNext: () => Promise<void>;
};

const DEFAULT_CLOSURE_CHECKLIST = {
  categorized: false,
  subscriptions_reviewed: false,
  deviation_reviewed: false,
  target_reviewed: false,
  budget_copied_next: false,
} as const;

export function MonthlyCloseView({
  month, year, monthlyTransactions, recurringEntries, netWorth, budgetTotals, targetSavingsPct,
  settings, formatEUR, addToast, saveSetting, onNavigateToTx, onNavigateToBudget, onNavigate, onCopyBudgetToNext,
}: Props) {
  const closureKey = `monthly_close_${year}_${month}`;
  const readChecklist = () => parseJsonValue(settings[closureKey] || "", { ...DEFAULT_CLOSURE_CHECKLIST });
  const existing = readChecklist();

  const uncategorized = monthlyTransactions.filter(
    (tx) => isRealExpense(tx) && (!tx.category_anon || tx.category_anon.trim() === ""),
  ).length;
  const realIncome = monthlyTransactions.filter(isRealIncome)
    .reduce((s, tx) => s + tx.amount, 0);
  const realExpense = monthlyTransactions.filter(isRealExpense)
    .reduce((s, tx) => s + budgetExpenseAmount(tx), 0);
  const realSavings = realIncome - realExpense;
  const savingsRate = realIncome > 0 ? (realSavings / realIncome) * 100 : null;
  const budgetSavingsRate = budgetTotals.monthlyIncome > 0
    ? (budgetTotals.monthlySavings / budgetTotals.monthlyIncome) * 100
    : null;

  const spentByCat: Record<string, number> = {};
  for (const tx of monthlyTransactions) {
    if (!isRealExpense(tx)) continue;
    const cat = normalizeCategory(tx.category_anon) || "Sin categoría";
    spentByCat[cat] = (spentByCat[cat] || 0) + budgetExpenseAmount(tx);
  }
  const plannedByCat: Record<string, number> = {};
  for (const e of recurringEntries.filter((entry) => !entry.es_ingreso)) {
    const cat = e.tipo_partida === "suscripcion"
      ? SUBSCRIPTION_CATEGORY
      : (normalizeCategory(e.categoria) || (e.categoria || "").trim() || "Sin categoría");
    plannedByCat[cat] = (plannedByCat[cat] || 0) + e.monto_estimado;
  }
  const deviations = Object.entries(spentByCat)
    .map(([cat, spent]) => ({ cat, spent, planned: plannedByCat[cat] ?? 0, delta: spent - (plannedByCat[cat] ?? 0) }))
    .filter(d => d.planned > 0 || d.spent > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);

  const snapshots = parseJsonValue<ClosureSnapshot[]>(settings.monthly_closure_snapshots || "", []);
  const period = `${year}-${String(month).padStart(2, "0")}`;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevPeriod = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
  const prevSnapshot = snapshots.find((s) => s.period === prevPeriod) ?? null;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const recurringMatches = matchRecurringToTx(recurringEntries, monthlyTransactions);
  const recurringMatched = recurringMatches.filter((m) => m.tx !== null).length;
  const narrative = buildMonthlyCloseNarrative({
    realIncome,
    realExpense,
    realSavings,
    savingsRate,
    targetSavingsPct,
    uncategorized,
    deviations,
    prevNetWorth: prevSnapshot?.net_worth ?? null,
    netWorth,
    recurringMatched,
    recurringTotal: recurringMatches.length,
    formatEUR,
  });

  const saveCheck = (key: string, val: boolean) => {
    const current = readChecklist();
    void saveSetting(closureKey, JSON.stringify({ ...current, [key]: val, updated_at: new Date().toISOString() }));
  };

  async function closeMonth() {
    const next: ClosureSnapshot[] = [
      ...snapshots.filter((s) => s.period !== period),
      {
        period,
        real_income: Math.round(realIncome * 100) / 100,
        real_expense: Math.round(realExpense * 100) / 100,
        real_savings: Math.round(realSavings * 100) / 100,
        savings_rate_pct: savingsRate !== null ? Math.round(savingsRate * 10) / 10 : null,
        net_worth: Math.round(netWorth * 100) / 100,
        budget_income: Math.round(budgetTotals.monthlyIncome * 100) / 100,
        budget_expense: Math.round(budgetTotals.monthlyExpense * 100) / 100,
        budget_savings: Math.round(budgetTotals.monthlySavings * 100) / 100,
        budget_consumption: Math.round(budgetTotals.monthlyConsumption * 100) / 100,
        budget_debt: Math.round(budgetTotals.monthlyDebtPayments * 100) / 100,
        budget_ahorro: Math.round(budgetTotals.monthlyAhorroInversion * 100) / 100,
        closed_at: new Date().toISOString(),
      },
    ];
    await saveSetting("monthly_closure_snapshots", JSON.stringify(next.slice(-24)));
    addToast(`Snapshot ${month}/${year} guardado con totales de presupuesto.`, "success");
  }

  async function copyBudgetNext() {
    try {
      await onCopyBudgetToNext();
      saveCheck("budget_copied_next", true);
    } catch {
      addToast("No se pudo copiar el presupuesto al mes siguiente.", "error");
    }
  }

  return (
    <section className="grid">
      <div className="monthly-close-kpi" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem" }}>
        {[
          { label: "Ingresos reales", value: realIncome, cls: "positive" },
          { label: "Gastos reales", value: realExpense, cls: "negative" },
          { label: "Ahorro real", value: realSavings, cls: realSavings >= 0 ? "positive" : "negative" },
          ...(savingsRate !== null ? [{ label: "Tasa de ahorro (tx)", value: null, text: `${savingsRate.toFixed(1)}%`, cls: savingsRate >= targetSavingsPct ? "positive" : savingsRate >= 0 ? "" : "negative" }] : []),
          { label: "Sin categorizar", value: null, text: String(uncategorized), cls: uncategorized > 0 ? "negative" : "positive" },
        ].map(({ label, value, text, cls }) => (
          <div key={label} style={{ padding: "0.875rem 1rem", background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "0.625rem" }}>
            <p className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.25rem" }}>{label}</p>
            <strong className={`sensitive ${cls}`} style={{ fontSize: "1.1rem" }}>
              {value !== null && value !== undefined ? formatEUR(value) : text}
            </strong>
          </div>
        ))}
      </div>

      <article className="card monthly-close-budget">
        <h2>Presupuesto del mes (planificado)</h2>
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
          Totales desde Presupuesto — comparables con movimientos reales arriba.
        </p>
        <div className="monthly-close-budget__grid">
          <div><span className="muted">Ingresos</span><strong className="sensitive positive">{formatEUR(budgetTotals.monthlyIncome)}</strong></div>
          <div><span className="muted">Gastos asignados</span><strong className="sensitive">{formatEUR(budgetTotals.monthlyConsumption)}</strong></div>
          {budgetTotals.monthlyDebtPayments > 0 && (
            <div><span className="muted">Deudas</span><strong className="sensitive">{formatEUR(budgetTotals.monthlyDebtPayments)}</strong></div>
          )}
          {budgetTotals.monthlyAhorroInversion > 0 && (
            <div><span className="muted">Ahorro e inversión</span><strong className="sensitive positive">{formatEUR(budgetTotals.monthlyAhorroInversion)}</strong></div>
          )}
          <div><span className="muted">Ahorro neto est.</span><strong className={`sensitive ${budgetTotals.monthlySavings >= 0 ? "positive" : "negative"}`}>{formatEUR(budgetTotals.monthlySavings)}</strong></div>
        </div>
        {budgetSavingsRate !== null && (
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
            Tasa de ahorro planificada: {budgetSavingsRate.toFixed(1)}% (objetivo ≥ {targetSavingsPct}%)
          </p>
        )}
        {prevSnapshot && (
          <div className="monthly-close-diff" style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-soft)" }}>
            <strong style={{ fontSize: "0.85rem" }}>vs {MONTH_NAMES[prevMonth - 1]} {prevYear}</strong>
            <div className="inicio-proj-row">
              <span className="muted">Patrimonio neto</span>
              <span className="muted">{formatDelta(netWorth, Number(prevSnapshot.net_worth ?? 0), formatEUR)}</span>
            </div>
            {prevSnapshot.budget_savings != null && (
              <div className="inicio-proj-row">
                <span className="muted">Ahorro planificado</span>
                <span className="muted">{formatDelta(budgetTotals.monthlySavings, Number(prevSnapshot.budget_savings), formatEUR)}</span>
              </div>
            )}
            {prevSnapshot.real_savings != null && (
              <div className="inicio-proj-row">
                <span className="muted">Ahorro real (tx)</span>
                <span className="muted">{formatDelta(realSavings, Number(prevSnapshot.real_savings), formatEUR)}</span>
              </div>
            )}
          </div>
        )}
      </article>

      <article className="card monthly-close-narrative">
        <h2>Resumen ejecutivo</h2>
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.85rem" }}>
          3 aciertos · 3 desviaciones · 3 decisiones para el mes siguiente
        </p>
        <div className="monthly-close-narrative__grid">
          <div>
            <h3 className="monthly-close-narrative__heading positive">Aciertos</h3>
            <ol className="monthly-close-narrative__list">
              {narrative.wins.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="monthly-close-narrative__heading negative">Desviaciones</h3>
            <ol className="monthly-close-narrative__list">
              {narrative.misses.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="monthly-close-narrative__heading">Decisiones</h3>
            <ul className="monthly-close-narrative__decisions">
              {narrative.decisions.map((d) => (
                <li key={d.text}>
                  <span>{d.text}</span>
                  <button
                    type="button"
                    className="button-secondary monthly-close-narrative__cta"
                    onClick={() => {
                      if (d.action === "copy_budget") void copyBudgetNext();
                      else onNavigate(d.action);
                    }}
                  >
                    {d.ctaLabel} →
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </article>

      <section className="grid two-col">
        <article className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <h2>Checklist cierre</h2>
            <span className="muted" style={{ fontSize: "0.8rem" }}>{month}/{year}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {[
              { key: "categorized", label: `Movimientos categorizados${uncategorized > 0 ? ` (quedan ${uncategorized})` : " ✓"}`, warn: uncategorized > 0 },
              { key: "subscriptions_reviewed", label: "Suscripciones revisadas", warn: false },
              { key: "deviation_reviewed", label: "Desviaciones revisadas", warn: false },
              { key: "target_reviewed", label: `Objetivo de ahorro revisado (≥ ${targetSavingsPct}%)`, warn: savingsRate !== null && savingsRate < targetSavingsPct },
              { key: "budget_copied_next", label: `Presupuesto copiado a ${MONTH_NAMES[nextMonth - 1]} ${nextYear}`, warn: !((existing as Record<string, unknown>).budget_copied_next) },
            ].map(({ key, label, warn }) => (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={Boolean((existing as Record<string, unknown>)[key])}
                  onChange={e => saveCheck(key, e.target.checked)}
                />
                <span className={warn ? "negative" : ""}>{label}</span>
              </label>
            ))}
          </div>
          {uncategorized > 0 && (
            <button type="button" className="button-secondary"
              style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}
              onClick={onNavigateToTx}>
              Ver movimientos sin categoría →
            </button>
          )}
          <div className="inline-actions" style={{ marginTop: "1rem", flexWrap: "wrap" }}>
            <button type="button" onClick={() => void closeMonth()}>
              Cerrar mes y guardar snapshot
            </button>
            <button type="button" className="button-secondary" onClick={() => void copyBudgetNext()}>
              Copiar presupuesto → {MONTH_NAMES[nextMonth - 1]}
            </button>
            <button type="button" className="button-secondary" onClick={onNavigateToBudget}>
              Revisar Presupuesto
            </button>
          </div>
        </article>

        <article className="card">
          <h2>Desviaciones por categoría</h2>
          {deviations.length === 0 ? (
            <p className="muted">Sin transacciones este período.</p>
          ) : (
            <ul className="list">
              {deviations.map(({ cat, spent, planned, delta }) => (
                <li key={cat}>
                  <div>
                    <span>{cat}</span>
                    {planned > 0 && <small className="muted" style={{ marginLeft: "0.4rem" }}>plan {formatEUR(planned)}</small>}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <strong className="sensitive">{formatEUR(spent)}</strong>
                    {planned > 0 && (
                      <div style={{ fontSize: "0.75rem" }} className={delta > 0 ? "negative" : "positive"}>
                        {delta > 0 ? "+" : ""}{formatEUR(delta)}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {snapshots.length > 0 && (
            <>
              <h3 style={{ marginTop: "1.25rem", fontSize: "0.85rem" }}>Historial de cierres</h3>
              <ul className="list">
                {[...snapshots].reverse().slice(0, 6).map((s) => (
                  <li key={String(s.period)}>
                    <span className="muted">{String(s.period)}</span>
                    <div style={{ textAlign: "right", fontSize: "0.85rem" }}>
                      <strong className="sensitive">{formatEUR(Number(s.net_worth ?? 0))}</strong>
                      {s.savings_rate_pct != null && (
                        <div className="muted">{Number(s.savings_rate_pct).toFixed(1)}% ahorro real</div>
                      )}
                      {s.budget_savings != null && (
                        <div className="muted">{formatEUR(Number(s.budget_savings))} planificado</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </article>
      </section>

      {(() => {
        const matches = recurringMatches;
        if (matches.length === 0) return null;
        const found = matches.filter(m => m.tx !== null).length;
        return (
          <article className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <h2>Gastos recurrentes</h2>
              <span className={`badge ${found === matches.length ? "positive" : found > 0 ? "" : "negative"}`}>
                {found}/{matches.length} encontrados
              </span>
            </div>
            <ul className="list">
              {matches.map(({ entry, tx }) => (
                <li key={entry.id}>
                  <div>
                    <span>{entry.nombre}</span>
                    {entry.categoria && <small className="muted" style={{ marginLeft: "0.4rem" }}>· {entry.categoria}</small>}
                    {tx && (
                      <div style={{ fontSize: "0.75rem" }} className="muted">
                        {tx.description_raw || "—"}{tx.date ? ` · ${tx.date}` : ""}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {tx ? (
                      <>
                        <strong className="sensitive negative">{formatEUR(Math.abs(tx.amount))}</strong>
                        {Math.abs(Math.abs(tx.amount) - entry.monto_estimado) > 0.01 && (
                          <div style={{ fontSize: "0.75rem" }} className="muted">
                            plan {formatEUR(entry.monto_estimado)}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="muted" style={{ fontSize: "0.85rem" }}>
                        ⚠ {formatEUR(entry.monto_estimado)} esperado
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </article>
        );
      })()}
    </section>
  );
}
