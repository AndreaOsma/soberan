import type { Transaction, CalendarEvent, RecurringEntry, Debt, DebtInstallment } from "../../types";
import { EmptyState } from "../../components/EmptyState";
import type { MenuKey } from "../../config/ui";
import { monthlyDebtObligation, recurringExpenseNames } from "../../utils/debtInstallments";
import { subscriptionAppliesToMonth, subscriptionMonthlyAmount, isAnnualSubscription } from "../../utils/subscriptionBudget";
import { isRealExpense, isRealIncome } from "../../utils/internalTransfer";
import { budgetExpenseAmount } from "../../utils/expenseSplits";

type Totals = {
  monthlyIncome: number;
  monthlyExpense: number;
  totalCash: number;
};

type Props = {
  month: number;
  year: number;
  transactions: Transaction[];
  monthlyTransactions: Transaction[];
  calendarEvents: CalendarEvent[];
  recurringEntries: RecurringEntry[];
  debts: Debt[];
  debtInstallments: DebtInstallment[];
  totals: Totals;
  formatEUR: (v: number) => string;
  onNavigate: (key: MenuKey) => void;
};

export function CashFlowView({
  month, year,
  transactions, monthlyTransactions, calendarEvents, recurringEntries, debts, debtInstallments, totals, formatEUR, onNavigate
}: Props) {
  const today = new Date();

  const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, 1);
  const recentExpTx = transactions.filter(
    (tx) => isRealExpense(tx) && new Date(tx.date) >= threeMonthsAgo,
  );
  const monthlyExpTotals: Record<string, number> = {};
  for (const tx of recentExpTx) {
    const key = tx.date.slice(0, 7);
    monthlyExpTotals[key] = (monthlyExpTotals[key] ?? 0) + budgetExpenseAmount(tx);  }
  const months3 = Object.values(monthlyExpTotals);
  const avgMonthlyExpense = months3.length > 0
    ? months3.reduce((s, v) => s + v, 0) / months3.length
    : totals.monthlyExpense;
  const usingRealAvg = months3.length > 0;

  const weeklyIncome = totals.monthlyIncome / 4.333;
  const weeklyExpense = avgMonthlyExpense / 4.333;

  const weeklyEvents: number[] = Array(13).fill(0);
  for (const ev of calendarEvents) {
    const evDate = new Date(ev.fecha);
    const diffDays = Math.floor((evDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const weekIdx = Math.floor(diffDays / 7);
    if (weekIdx >= 0 && weekIdx < 13) {
      weeklyEvents[weekIdx] += Math.abs(Number(ev.monto || 0));
    }
  }

  let balance = totals.totalCash;
  const weeks: Array<{ label: string; balance: number; net: number; semaphore: "ok" | "warn" | "crit" }> = [];
  for (let w = 0; w < 13; w++) {
    const net = weeklyIncome - weeklyExpense - weeklyEvents[w];
    balance += net;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + w * 7);
    const label = `S${w + 1} ${weekStart.toLocaleDateString("es", { day: "numeric", month: "short" })}`;
    const semaphore: "ok" | "warn" | "crit" =
      balance < 0 ? "crit" : balance < totals.monthlyExpense ? "warn" : "ok";
    weeks.push({ label, balance, net, semaphore });
  }

  const maxAbsNet = Math.max(...weeks.map((w) => Math.abs(w.net)), 1);
  const critCount = weeks.filter((w) => w.semaphore === "crit").length;
  const warnCount = weeks.filter((w) => w.semaphore === "warn").length;

  const threeMonths = [0, 1, 2].map((offset) => {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const label = d.toLocaleDateString("es-ES", { month: "long", year: "numeric" })
      .replace(/^./, c => c.toUpperCase());
    const subCost = recurringEntries.filter(r => r.tipo_partida === "suscripcion").reduce((s, sub) => {
      if (!subscriptionAppliesToMonth(sub, d.getMonth() + 1, d.getFullYear())) return s;
      if (isAnnualSubscription(sub.frecuencia) && sub.mes_cobro != null && sub.mes_cobro !== d.getMonth() + 1) return s;
      return s + subscriptionMonthlyAmount(sub, d.getMonth() + 1, d.getFullYear());
    }, 0);
    const debtCost = monthlyDebtObligation(
      debts,
      debtInstallments,
      d.getMonth() + 1,
      d.getFullYear(),
      recurringExpenseNames(recurringEntries),
    );
    const totalExpense = avgMonthlyExpense + subCost + debtCost;
    return { label, income: totals.monthlyIncome, expense: totalExpense, net: totals.monthlyIncome - totalExpense };
  });

  const catBreakdown: Record<string, number> = {};
  for (const tx of monthlyTransactions) {
    if (!isRealExpense(tx)) continue;
    const cat = (tx.category_anon || "Sin categoría").trim();
    catBreakdown[cat] = (catBreakdown[cat] ?? 0) + budgetExpenseAmount(tx);  }
  const catEntries = Object.entries(catBreakdown).sort((a, b) => b[1] - a[1]);
  const maxCat = catEntries[0]?.[1] ?? 1;
  const totalMonthlyIncome = monthlyTransactions
    .filter(isRealIncome)
    .reduce((s, t) => s + Number(t.amount), 0);

  return (
    <section className="grid">
      {usingRealAvg && (
        <p className="muted" style={{ fontSize: "0.78rem" }}>
          Proyección basada en promedio real de gasto de los últimos {months3.length} mes{months3.length !== 1 ? "es" : ""} ({formatEUR(avgMonthlyExpense)}/mes), no en el presupuesto estimado.
        </p>
      )}
      <div className="cf-months-row">
        {threeMonths.map((m) => (
          <div key={m.label} className="cf-month-card">
            <span className="cf-month-card__label">{m.label}</span>
            <div className="cf-month-card__rows">
              <span className="muted">Ingresos</span>
              <strong className="positive sensitive">{formatEUR(m.income)}</strong>
              <span className="muted">Gastos</span>
              <strong className="negative sensitive">{formatEUR(m.expense)}</strong>
              <span className="muted">Neto</span>
              <strong className={`sensitive ${m.net < 0 ? "negative" : "positive"}`}>{m.net >= 0 ? "+" : ""}{formatEUR(m.net)}</strong>
            </div>
          </div>
        ))}
      </div>

      <section className="grid two-col">
        <article className="card">
          <h2>Flujo de caja — 13 semanas</h2>
          <p className="muted">Neto semanal estimado. Saldo acumulado entre paréntesis.</p>
          {critCount > 0 && (
            <div className="error-banner">
              Saldo negativo en {critCount} {critCount === 1 ? "semana" : "semanas"}.
            </div>
          )}
          {critCount === 0 && warnCount > 0 && (
            <div style={{ padding: "0.6rem 0.75rem", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: "0.5rem", marginBottom: "0.75rem", fontSize: "0.875rem" }}>
              Reserva baja en {warnCount} {warnCount === 1 ? "semana" : "semanas"}.
            </div>
          )}
          <div>
            {weeks.map((w) => {
              const barPct = Math.min(100, (Math.abs(w.net) / maxAbsNet) * 100);
              return (
                <div key={w.label} className={`cashflow-week cashflow-${w.semaphore}`}>
                  <span className="cashflow-week-label">{w.label}</span>
                  <div className="cashflow-week-bar">
                    <div
                      className="cashflow-week-fill"
                      style={{
                        width: `${barPct}%`,
                        background: w.net >= 0 ? "var(--color-positive, #10b981)" : "var(--color-negative, #ef4444)",
                        opacity: 0.75
                      }}
                    />
                  </div>
                  <span className={`cashflow-week-amount ${w.net < 0 ? "negative" : "positive"}`}>
                    {w.net >= 0 ? "+" : ""}{formatEUR(w.net)}
                    <small className="muted" style={{ marginLeft: "0.5rem", fontSize: "0.75em" }}>
                      ({formatEUR(w.balance)})
                    </small>
                  </span>
                </div>
              );
            })}
          </div>
        </article>

        <article className="card">
          <h2>Gastos por categoría</h2>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.75rem" }}>
            {new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1))}
            {totalMonthlyIncome > 0 && <> · ingresos <span className="positive sensitive">{formatEUR(totalMonthlyIncome)}</span></>}
          </p>
          {catEntries.length === 0 ? (
            <EmptyState
              icon="📉"
              title="Sin gastos categorizados"
              description="Asigna categorías a tus movimientos para ver el desglose por categoría."
              actionLabel="Ir a Transacciones"
              onAction={() => onNavigate("Transacciones")}
            />
          ) : (
            <div className="sankey-bars">
              {catEntries.map(([cat, val]) => (
                <div key={cat} className="sankey-bar-row">
                  <span className="sankey-bar-label">{cat}</span>
                  <div className="sankey-bar-track">
                    <div className="sankey-bar-fill" style={{ width: `${(val / maxCat) * 100}%` }} />
                  </div>
                  <span className="sankey-bar-val sensitive">{formatEUR(val)}</span>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </section>
  );
}
