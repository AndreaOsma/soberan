import { useState, useMemo, useEffect } from "react";
import { api } from "../../services/api";
import { BudgetAnnualGrid } from "../../components/budget/BudgetAnnualGrid";
import { BudgetMonthPanel } from "../../components/budget/BudgetMonthPanel";
import { BudgetEntryModals } from "../../components/budget/BudgetEntryModals";
import { PeriodViewToggle } from "../../components/PeriodViewToggle";
import type { MenuKey } from "../../config/ui";
import type {
  RecurringEntry, MonthlyBudget, Transaction, Account, Debt, DebtInstallment,
  Investment, WishlistItem, WorkHistory, SalaryBreakdown, Goal,
} from "../../types";
import { buildAnnualBudgetSummary } from "../../utils/annualBudget";
import { MONTH_NAMES, useBudgetEntries } from "../../hooks/useBudgetEntries";

type Props = {
  month: number;
  year: number;
  recurringEntries: RecurringEntry[];
  monthlyBudgets: MonthlyBudget[];
  workHistory: WorkHistory[];
  salaryBreakdowns: SalaryBreakdown[];
  debts: Debt[];
  debtInstallments: DebtInstallment[];
  monthlyTransactions: Transaction[];
  accounts: Account[];
  investments: Investment[];
  goals: Goal[];
  wishlist: WishlistItem[];
  settings: Record<string, string>;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  formatEUR: (value: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  onNavigate: (key: MenuKey) => void;
  onGoToMonth?: (month: number, year: number) => void;
  viewMode: "month" | "year";
  onViewModeChange: (mode: "month" | "year") => void;
  yearOptions: number[];
  onYearChange: (year: number) => void;
  onAdjustYear: (delta: number) => void;
};

export function BudgetView({
  month, year,
  recurringEntries, monthlyBudgets, workHistory, salaryBreakdowns, debts, debtInstallments,
  monthlyTransactions, accounts, investments, goals, wishlist, settings,
  loadAll, formatEUR, addToast, onNavigate, onGoToMonth,
  viewMode, onViewModeChange,
  yearOptions, onYearChange, onAdjustYear,
}: Props) {
  const [annualLoading, setAnnualLoading] = useState(false);
  const [monthlyBudgetsByMonth, setMonthlyBudgetsByMonth] = useState<Record<number, MonthlyBudget[]>>({});
  const [yearSalaryBreakdowns, setYearSalaryBreakdowns] = useState<SalaryBreakdown[]>([]);

  const entries = useBudgetEntries({
    month, year,
    recurringEntries, monthlyBudgets, workHistory, salaryBreakdowns, debts, debtInstallments,
    monthlyTransactions, accounts, investments, settings,
    loadAll, formatEUR, addToast,
  });

  useEffect(() => {
    if (viewMode !== "year") return;
    let cancelled = false;
    setAnnualLoading(true);
    Promise.all([
      api.getSalaryBreakdownYear(year),
      ...Array.from({ length: 12 }, (_, i) => api.getMonthlyBudget(i + 1, year)),
    ])
      .then(([breakdowns, ...budgets]) => {
        if (cancelled) return;
        const byMonth: Record<number, MonthlyBudget[]> = {};
        budgets.forEach((rows, idx) => { byMonth[idx + 1] = rows; });
        setYearSalaryBreakdowns(breakdowns);
        setMonthlyBudgetsByMonth(byMonth);
      })
      .catch(() => {
        if (!cancelled) addToast("No se pudo cargar el presupuesto anual.", "error");
      })
      .finally(() => {
        if (!cancelled) setAnnualLoading(false);
      });
    return () => { cancelled = true; };
  }, [viewMode, year, addToast]);

  const annualSummary = useMemo(() => {
    if (viewMode !== "year") return null;
    return buildAnnualBudgetSummary({
      year,
      recurringEntries,
      workHistory,
      salaryBreakdowns: yearSalaryBreakdowns,
      monthlyBudgetsByMonth,
      debts,
      debtInstallments,
      currentMonth: month,
      currentYear: year,
    });
  }, [viewMode, year, recurringEntries, workHistory, yearSalaryBreakdowns, monthlyBudgetsByMonth, debts, debtInstallments, month]);

  return (
    <section className="grid">
      <div className="period-view-bar">
        <PeriodViewToggle
          mode={viewMode}
          onChange={onViewModeChange}
          monthLabel={viewMode === "month" ? `${MONTH_NAMES[month - 1]} ${year}` : undefined}
          yearLabel="Año"
        />
        {viewMode === "month" && (
          <button
            type="button"
            className="period-view-bar__action"
            onClick={() => { entries.resetForm(); entries.setAddingEntry(true); }}
          >
            + Nueva partida
          </button>
        )}
      </div>

      {viewMode === "year" ? (
        annualLoading || !annualSummary ? (
          <article className="card">
            <p className="muted">Cargando presupuesto {year}…</p>
          </article>
        ) : (
          <BudgetAnnualGrid
            year={year}
            yearOptions={yearOptions}
            summary={annualSummary}
            formatEUR={formatEUR}
            onYearChange={onYearChange}
            onAdjustYear={onAdjustYear}
            onSelectMonth={(m) => {
              onViewModeChange("month");
              onGoToMonth?.(m, year);
            }}
          />
        )
      ) : (
        <>
          <BudgetMonthPanel
            month={month}
            year={year}
            recurringEntries={recurringEntries}
            monthlyBudgets={monthlyBudgets}
            debts={debts}
            debtInstallments={debtInstallments}
            accounts={accounts}
            investments={investments}
            goals={goals}
            wishlist={wishlist}
            formatEUR={formatEUR}
            addToast={addToast}
            loadAll={loadAll}
            onNavigate={onNavigate}
            budget={entries.budget}
            expandedGroups={entries.expandedGroups}
            toggleGroup={entries.toggleGroup}
            editingId={entries.editingId}
            setEditingId={entries.setEditingId}
            editingVal={entries.editingVal}
            setEditingVal={entries.setEditingVal}
            editingIncomeKey={entries.editingIncomeKey}
            setEditingIncomeKey={entries.setEditingIncomeKey}
            addingIncome={entries.addingIncome}
            setAddingIncome={entries.setAddingIncome}
            editingIncomeSource={entries.editingIncomeSource}
            setEditingIncomeSource={entries.setEditingIncomeSource}
            showWishlistPicker={entries.showWishlistPicker}
            setShowWishlistPicker={entries.setShowWishlistPicker}
            copying={entries.copying}
            applyingTemplate={entries.applyingTemplate}
            fondoBalances={entries.fondoBalances}
            debtMarkSubmit={entries.debtMarkSubmit}
            debtExtraSubmit={entries.debtExtraSubmit}
            libreSubmit={entries.libreSubmit}
            availColor={entries.availColor}
            monthScopeLabel={entries.monthScopeLabel}
            goalProgressOpts={entries.goalProgressOpts}
            openEdit={entries.openEdit}
            restoreToMonth={entries.restoreToMonth}
            pauseEntryThisMonth={entries.pauseEntryThisMonth}
            cancelEntryFromMonth={entries.cancelEntryFromMonth}
            assignAvailableToLibre={entries.assignAvailableToLibre}
            savePayrollReal={entries.savePayrollReal}
            saveAssigned={entries.saveAssigned}
            copyFromPrev={entries.copyFromPrev}
            apply503020Template={entries.apply503020Template}
            markDebtInstallmentPaid={entries.markDebtInstallmentPaid}
            commitDebtExtraPayment={entries.commitDebtExtraPayment}
            promoteWishlistItem={entries.promoteWishlistItem}
            saveIncomeSource={entries.saveIncomeSource}
          />
          <BudgetEntryModals
            month={month}
            year={year}
            accounts={accounts}
            goals={goals}
            wishlist={wishlist}
            onNavigate={onNavigate}
            setShowWishlistPicker={entries.setShowWishlistPicker}
            carteraOptions={entries.carteraOptions}
            monthScopeLabel={entries.monthScopeLabel}
            editingEntry={entries.editingEntry}
            setEditingEntry={entries.setEditingEntry}
            editForm={entries.editForm}
            setEditForm={entries.setEditForm}
            editChecklistAccountId={entries.editChecklistAccountId}
            setEditChecklistAccountId={entries.setEditChecklistAccountId}
            editChecklistMoved={entries.editChecklistMoved}
            setEditChecklistMoved={entries.setEditChecklistMoved}
            addingEntry={entries.addingEntry}
            setAddingEntry={entries.setAddingEntry}
            newEntry={entries.newEntry}
            setNewEntry={entries.setNewEntry}
            editSubmit={entries.editSubmit}
            deleteSubmit={entries.deleteSubmit}
            addSubmit={entries.addSubmit}
            submitEditEntry={entries.submitEditEntry}
            submitDeleteEntry={entries.submitDeleteEntry}
            submitNewEntry={entries.submitNewEntry}
            resetForm={entries.resetForm}
          />
        </>
      )}
    </section>
  );
}
