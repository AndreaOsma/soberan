import { useEffect, useState } from "react";
import { api } from "../../services/api";
import type { Account, Debt, DebtInstallment, Goal, Investment, MonthlyBudget, RecurringEntry, Transaction, WishlistItem } from "../../types";
import { defaultScheduleStartDate } from "../../utils/debtInstallments";
import { useNotify } from "../../hooks/useNotify";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { AccountsListPanel } from "./AccountsListPanel";
import { TransactionsListPanel } from "./TransactionsListPanel";
import { GoalsWishlistPanel } from "./GoalsWishlistPanel";
import { DebtsPasivosPanel } from "./DebtsPasivosPanel";
import { ListsEditModals, type DebtFormState, type GoalFormState, type WishlistFormState } from "./ListsEditModals";

type Props = {
  currentMenu: string;
  accounts: Account[];
  transactions: Transaction[];
  goals: Goal[];
  debts: Debt[];
  debtInstallments: DebtInstallment[];
  investments: Investment[];
  wishlist: WishlistItem[];
  monthlySavings: number;
  monthlyIncome: number;
  month: number;
  year: number;
  monthlyBudgets: MonthlyBudget[];
  recurringEntries: RecurringEntry[];
  settings: Record<string, string>;
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  deleteWithUndo: (label: string, onCommit: () => Promise<void>, onCancel?: () => void) => void;
  onOpenAccountModal: () => void;
  onOpenTxModal: () => void;
};

export function CrudListsView({
  currentMenu, accounts, transactions, goals, debts, debtInstallments, investments, wishlist,
  monthlySavings: _monthlySavings, monthlyIncome, month, year, monthlyBudgets, recurringEntries, settings,
  formatEUR, addToast, loadAll, deleteWithUndo,
  onOpenAccountModal, onOpenTxModal,
}: Props) {
  const [txSearch, setTxSearch] = useState("");
  const [txFilterCat, setTxFilterCat] = useState("");
  const [txFilterAccount, setTxFilterAccount] = useState<number | "">("");
  const [debtExtraMonthly, setDebtExtraMonthly] = useState(0);
  const [debtCalc, setDebtCalc] = useState({ dtiPct: 35, termYears: 20, tae: 3.5 });
  const [bulkRecatPending, setBulkRecatPending] = useState<{ description: string; category: string; count: number } | null>(null);
  const [editAccountModal, setEditAccountModal] = useState<Account | null>(null);
  const [editBalanceModal, setEditBalanceModal] = useState<{ accountId: number; alias: string; current: number } | null>(null);
  const [editGoalModal, setEditGoalModal] = useState<Goal | null>(null);
  const [editWishlistModal, setEditWishlistModal] = useState<WishlistItem | null>(null);
  const [wishlistForm, setWishlistForm] = useState<WishlistFormState>({ nombre: "", monto_estimado: "", prioridad: "media", notas: "", url: "" });
  const [isWishlistFormOpen, setIsWishlistFormOpen] = useState(false);
  const [promoteModal, setPromoteModal] = useState<WishlistItem | null>(null);
  const [purchaseModal, setPurchaseModal] = useState<WishlistItem | null>(null);
  const [promoteMonth, setPromoteMonth] = useState(() => new Date().getMonth() + 1);
  const [promoteYear, setPromoteYear] = useState(() => new Date().getFullYear());
  const [showArchivedWishlist, setShowArchivedWishlist] = useState(false);
  const [editDebtModal, setEditDebtModal] = useState<Debt | null>(null);
  const [debtPaymentsModal, setDebtPaymentsModal] = useState<{
    debt: Debt;
    initialAmount?: number;
    initialDate?: string;
  } | null>(null);
  const [scheduleFocusDebtId, setScheduleFocusDebtId] = useState<number | null>(null);
  const [scheduleEditorDebtId, setScheduleEditorDebtId] = useState<number | null>(null);
  const [scheduleAutocalc, setScheduleAutocalc] = useState(false);
  const [scheduleStartDate, setScheduleStartDate] = useState<string | null>(null);
  const [showLiquidatedDebts, setShowLiquidatedDebts] = useState(false);
  const [editTxModal, setEditTxModal] = useState<Transaction | null>(null);
  const [isGoalFormOpen, setIsGoalFormOpen] = useState(false);
  const [showCompletedGoals, setShowCompletedGoals] = useState(false);
  const [balanceUpdateMode, setBalanceUpdateMode] = useState(false);
  const [showLiquidation, setShowLiquidation] = useState(true);
  const [showDebtCapacity, setShowDebtCapacity] = useState(false);
  const [liquidationMode, setLiquidationMode] = useState<"avalanche" | "snowball">("avalanche");
  const [pendingBalances, setPendingBalances] = useState<Record<number, string>>({});
  const [isDebtFormOpen, setIsDebtFormOpen] = useState(false);
  const [goalForm, setGoalForm] = useState<GoalFormState>({
    nombre: "", monto_objetivo: 0, fecha_limite: "",
    account_id: undefined, cartera_destino: "",
  });
  const emptyDebtForm = (): DebtFormState => ({
    nombre: "", acreedor: "", monto_total: 0, monto_pagado: 0, tipo: "Préstamo personal",
    fecha_inicio: defaultScheduleStartDate({ dia_cargo_mensual: null }),
    cuota_mensual: 0, tasa_anual: 0, notas: "", dia_cargo_mensual: "", numero_pagos: "",
    goal_id: null,
  });
  const [debtForm, setDebtForm] = useState(emptyDebtForm);
  const [fondoBalances, setFondoBalances] = useState<Record<number, number>>({});

  useEffect(() => {
    if (currentMenu !== "Objetivos") return;
    api.getFondoBalances().then((list) => {
      const m: Record<number, number> = {};
      for (const f of list) m[f.id] = f.balance;
      setFondoBalances(m);
    }).catch(() => setFondoBalances({}));
  }, [currentMenu, recurringEntries]);

  const { notifyAfter } = useNotify({ addToast, loadAll });
  const wishlistSubmit = useAsyncSubmit();
  const goalSubmit = useAsyncSubmit();
  const debtSubmit = useAsyncSubmit();
  const promoteSubmit = useAsyncSubmit();

  const editModals = (
    <ListsEditModals
      accounts={accounts}
      goals={goals}
      investments={investments}
      recurringEntries={recurringEntries}
      transactions={transactions}
      formatEUR={formatEUR}
      addToast={addToast}
      loadAll={loadAll}
      editAccountModal={editAccountModal}
      setEditAccountModal={setEditAccountModal}
      editGoalModal={editGoalModal}
      setEditGoalModal={setEditGoalModal}
      editWishlistModal={editWishlistModal}
      setEditWishlistModal={setEditWishlistModal}
      purchaseModal={purchaseModal}
      setPurchaseModal={setPurchaseModal}
      promoteModal={promoteModal}
      setPromoteModal={setPromoteModal}
      promoteMonth={promoteMonth}
      setPromoteMonth={setPromoteMonth}
      promoteYear={promoteYear}
      setPromoteYear={setPromoteYear}
      promoteSubmit={promoteSubmit}
      editDebtModal={editDebtModal}
      setEditDebtModal={setEditDebtModal}
      debtPaymentsModal={debtPaymentsModal}
      setDebtPaymentsModal={setDebtPaymentsModal}
      editTxModal={editTxModal}
      setEditTxModal={setEditTxModal}
      editBalanceModal={editBalanceModal}
      setEditBalanceModal={setEditBalanceModal}
      isWishlistFormOpen={isWishlistFormOpen}
      setIsWishlistFormOpen={setIsWishlistFormOpen}
      wishlistForm={wishlistForm}
      setWishlistForm={setWishlistForm}
      wishlistSubmit={wishlistSubmit}
      isGoalFormOpen={isGoalFormOpen}
      setIsGoalFormOpen={setIsGoalFormOpen}
      goalForm={goalForm}
      setGoalForm={setGoalForm}
      goalSubmit={goalSubmit}
      isDebtFormOpen={isDebtFormOpen}
      setIsDebtFormOpen={setIsDebtFormOpen}
      debtForm={debtForm}
      setDebtForm={setDebtForm}
      emptyDebtForm={emptyDebtForm}
      debtSubmit={debtSubmit}
      setScheduleFocusDebtId={setScheduleFocusDebtId}
      setScheduleEditorDebtId={setScheduleEditorDebtId}
      setScheduleAutocalc={setScheduleAutocalc}
      setScheduleStartDate={setScheduleStartDate}
    />
  );

  if (currentMenu === "Cuentas") {
    return (
      <>
        <AccountsListPanel
          accounts={accounts}
          formatEUR={formatEUR}
          addToast={addToast}
          loadAll={loadAll}
          deleteWithUndo={deleteWithUndo}
          onOpenAccountModal={onOpenAccountModal}
          notifyAfter={notifyAfter}
          balanceUpdateMode={balanceUpdateMode}
          setBalanceUpdateMode={setBalanceUpdateMode}
          pendingBalances={pendingBalances}
          setPendingBalances={setPendingBalances}
          setEditAccountModal={setEditAccountModal}
          setEditBalanceModal={setEditBalanceModal}
        />
        {editModals}
      </>
    );
  }

  if (currentMenu === "Transacciones") {
    return (
      <>
        <TransactionsListPanel
          accounts={accounts}
          transactions={transactions}
          settings={settings}
          formatEUR={formatEUR}
          addToast={addToast}
          loadAll={loadAll}
          deleteWithUndo={deleteWithUndo}
          onOpenTxModal={onOpenTxModal}
          txSearch={txSearch}
          setTxSearch={setTxSearch}
          txFilterCat={txFilterCat}
          setTxFilterCat={setTxFilterCat}
          txFilterAccount={txFilterAccount}
          setTxFilterAccount={setTxFilterAccount}
          bulkRecatPending={bulkRecatPending}
          setBulkRecatPending={setBulkRecatPending}
          setEditTxModal={setEditTxModal}
        />
        {editModals}
      </>
    );
  }

  if (currentMenu === "Objetivos") {
    return (
      <>
        <GoalsWishlistPanel
          accounts={accounts}
          goals={goals}
          debts={debts}
          investments={investments}
          wishlist={wishlist}
          recurringEntries={recurringEntries}
          monthlyBudgets={monthlyBudgets}
          month={month}
          year={year}
          formatEUR={formatEUR}
          loadAll={loadAll}
          deleteWithUndo={deleteWithUndo}
          fondoBalances={fondoBalances}
          showCompletedGoals={showCompletedGoals}
          setShowCompletedGoals={setShowCompletedGoals}
          showArchivedWishlist={showArchivedWishlist}
          setShowArchivedWishlist={setShowArchivedWishlist}
          setIsGoalFormOpen={setIsGoalFormOpen}
          setIsWishlistFormOpen={setIsWishlistFormOpen}
          setEditGoalModal={setEditGoalModal}
          setEditWishlistModal={setEditWishlistModal}
          setPromoteModal={setPromoteModal}
          setPromoteMonth={setPromoteMonth}
          setPromoteYear={setPromoteYear}
          setPurchaseModal={setPurchaseModal}
        />
        {editModals}
      </>
    );
  }

  if (currentMenu === "Pasivos") {
    return (
      <>
        <DebtsPasivosPanel
          debts={debts}
          debtInstallments={debtInstallments}
          recurringEntries={recurringEntries}
          monthlyIncome={monthlyIncome}
          formatEUR={formatEUR}
          addToast={addToast}
          loadAll={loadAll}
          deleteWithUndo={deleteWithUndo}
          debtExtraMonthly={debtExtraMonthly}
          setDebtExtraMonthly={setDebtExtraMonthly}
          debtCalc={debtCalc}
          setDebtCalc={setDebtCalc}
          showLiquidatedDebts={showLiquidatedDebts}
          setShowLiquidatedDebts={setShowLiquidatedDebts}
          showLiquidation={showLiquidation}
          setShowLiquidation={setShowLiquidation}
          showDebtCapacity={showDebtCapacity}
          setShowDebtCapacity={setShowDebtCapacity}
          liquidationMode={liquidationMode}
          setLiquidationMode={setLiquidationMode}
          scheduleFocusDebtId={scheduleFocusDebtId}
          scheduleEditorDebtId={scheduleEditorDebtId}
          scheduleAutocalc={scheduleAutocalc}
          scheduleStartDate={scheduleStartDate}
          setScheduleFocusDebtId={setScheduleFocusDebtId}
          setScheduleEditorDebtId={setScheduleEditorDebtId}
          setScheduleAutocalc={setScheduleAutocalc}
          setScheduleStartDate={setScheduleStartDate}
          emptyDebtForm={emptyDebtForm}
          setDebtForm={setDebtForm}
          setIsDebtFormOpen={setIsDebtFormOpen}
          setEditDebtModal={setEditDebtModal}
          setDebtPaymentsModal={setDebtPaymentsModal}
        />
        {editModals}
      </>
    );
  }

  return null;
}
