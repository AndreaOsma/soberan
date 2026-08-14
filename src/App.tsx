import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ALL_MENU_KEYS, SECTION_TABS, menuKeyToSection, type MenuKey, type MenuSection } from "./config/ui";
import { InicioView } from "./modules/general/InicioView";
import { BudgetView } from "./modules/planning/BudgetView";
import { CompoundInterestView } from "./modules/planning/CompoundInterestView";
import { AnnualEvolutionView } from "./modules/general/AnnualEvolutionView";
import { CashFlowView } from "./modules/planning/CashFlowView";
import { IngresosView } from "./modules/planning/IngresosView";
import { CrudListsView } from "./modules/lists/CrudListsView";
import { AssetsAndServicesView } from "./modules/assets/AssetsAndServicesView";
import { WorkAndTaxesView } from "./modules/work/WorkAndTaxesView";
import { SettingsView } from "./modules/general/SettingsView";
import { PaymentsCalendarView } from "./modules/planning/PaymentsCalendarView";
import { MonthlyCloseView } from "./modules/planning/MonthlyCloseView";
import { api } from "./services/api";
import { formatEUR } from "./utils/format";
import { monthlyDebtObligation, nextDebtPayment, recurringExpenseNames } from "./utils/debtInstallments";
import { buildNetWorthProjections } from "./utils/budgetTotals";
import { isMenuKey, menuFromPopState, parseMenuFromSearch, syncMenuHistory } from "./utils/menuHistory";
import { buildEmergencyFundSnapshot, financialTrafficLightV2 } from "./utils/emergencyFund";
import { budgetExpenseAmount } from "./utils/expenseSplits";
import { buildThemeFromAccent, resolveAccentFromSettings } from "./utils/accentTheme";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "./utils/expenseCategories";
import { GlassModal } from "./components/GlassModal";
import { ModalFormError } from "./components/ModalFormError";
import { AccountForm } from "./components/forms/AccountForm";
import { TxForm } from "./components/forms/TxForm";
import { ToastContainer } from "./components/Toast";
import { ViewSkeleton } from "./components/ViewSkeleton";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { MethodGuideModal } from "./components/methodGuide/MethodGuideModal";
import { AppShell } from "./components/AppShell";
import { ChatPanel } from "./components/chat/ChatPanel";
import { useAsyncSubmit } from "./hooks/useAsyncSubmit";
import { useAppToasts } from "./hooks/useAppToasts";
import { useChat } from "./hooks/useChat";
import { useDesktopUpdates } from "./hooks/useDesktopUpdates";
import { persistOnboardingDoneLocal, useSoberanData } from "./hooks/useSoberanData";

export default function App() {
  const [currentMenu, setCurrentMenuState] = useState<MenuKey>(() => {
    const urlMenu = parseMenuFromSearch();
    if (urlMenu) return urlMenu;
    const stored = localStorage.getItem("soberan_current_menu");
    const legacyMap: Record<string, MenuKey> = {
      Criptomonedas: "Inversiones",
      Suscripciones: "Presupuesto",
      "Estimación IRPF": "Impuestos",
      "Sincronización Bancaria": "Configuración",
      "API Agente": "Configuración",
      "Gestión de Datos": "Configuración",
    };
    const mapped = legacyMap[stored ?? ""] ?? stored;
    return isMenuKey(mapped) ? mapped : "Resumen Ejecutivo";
  });

  const setCurrentMenu = useCallback((menu: MenuKey) => {
    setCurrentMenuState((prev) => {
      if (prev === menu) return prev;
      syncMenuHistory(menu, "push");
      return menu;
    });
  }, []);

  useEffect(() => {
    syncMenuHistory(currentMenu, "replace");
    const onPop = (event: PopStateEvent) => {
      const menu = menuFromPopState(event) ?? "Resumen Ejecutivo";
      setCurrentMenuState(menu);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // mount-only: replaces the initial history entry once; ongoing currentMenu
    // changes are pushed via setCurrentMenu/syncMenuHistory, not re-run here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem("soberan_current_menu", currentMenu);
  }, [currentMenu]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(() => localStorage.getItem("soberan-privacy") === "1");
  useEffect(() => {
    localStorage.setItem("soberan-privacy", privacyMode ? "1" : "0");
  }, [privacyMode]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const sync = () => document.documentElement.classList.toggle("touch-viewport", mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const formatEURPrivate = useCallback((v: number) => (privacyMode ? "•••• €" : formatEUR(v)), [privacyMode]);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [budgetViewMode, setBudgetViewMode] = useState<"month" | "year">(() => {
    const stored = localStorage.getItem("soberan-budget-view-mode");
    if (stored === "month" || stored === "year") return stored;
    return window.matchMedia("(max-width: 768px)").matches ? "month" : "year";
  });
  const [dayNightMode, setDayNightMode] = useState<"day" | "night" | "auto">(
    () => (localStorage.getItem("soberan-daynight") as "day" | "night" | "auto") || "auto",
  );
  const [uiDensity, setUiDensity] = useState<"minimal" | "detailed">(
    () => (localStorage.getItem("soberan-ui-density") as "minimal" | "detailed") || "minimal",
  );
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [alertsPopoverOpen, setAlertsPopoverOpen] = useState(false);
  const [methodGuideOpen, setMethodGuideOpen] = useState(false);
  const [manualOnboarding, setManualOnboarding] = useState(false);
  const accountSubmit = useAsyncSubmit();
  const txSubmit = useAsyncSubmit();

  const { toasts, addToast, dismissToast, allocateToastId, pushToast } = useAppToasts();
  const data = useSoberanData({
    addToast,
    dismissToast,
    allocateToastId,
    pushToast,
  });
  const {
    loading,
    bootstrapped,
    error,
    message,
    monthRefreshing,
    accounts,
    transactions,
    goals,
    debts,
    debtInstallments,
    properties,
    investments,
    workHistory,
    cards,
    moneyOwed,
    wishlist,
    recurringEntries,
    monthlyBudgets,
    salaryBreakdowns,
    alerts,
    calendarEvents,
    patrimonioEvolution,
    krakenBalances,
    month,
    setMonth,
    year,
    setYear,
    settings,
    setSettings,
    monthlyTransactions,
    activeSalary,
    totals,
    onboardingRequired,
    loadAll,
    saveSetting,
    getJsonSetting,
    deleteWithUndo,
    adjustMonth,
    adjustYear,
    yearSelectOptions,
  } = data;

  const desktop = useDesktopUpdates({
    desktopCheckUpdates: settings.desktop_check_updates,
    addToast,
  });
  const { desktopMode, desktopUpdate, desktopVersion, dismissDesktopUpdate, checkDesktopUpdatesNow } = desktop;
  const nativeShellMode =
    desktopMode ||
    Boolean((globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());

  const chatEnabled = settings.chat_enabled !== "0";
  const chat = useChat({ chatEnabled, desktopMode });

  useEffect(() => {
    if (!nativeShellMode || settings.sync_auto_enabled !== "1") return;
    const provider = settings.sync_provider || "google_drive";
    const minutes = Number(settings.sync_auto_minutes || "15");
    const intervalMs = Math.max(2, Number.isFinite(minutes) ? minutes : 15) * 60_000;
    let cancelled = false;

    const runAutoSync = async () => {
      try {
        if (provider === "custom_server") {
          await api.syncCustomPush();
        } else {
          await api.syncGooglePush();
        }
        if (!cancelled) {
          await saveSetting("sync_last_push_at", new Date().toISOString(), false);
        }
      } catch {
        // Silent by design: avoid spamming toasts when offline/background.
      }
    };

    void runAutoSync();
    const timer = window.setInterval(() => void runAutoSync(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    nativeShellMode,
    saveSetting,
    settings.sync_auto_enabled,
    settings.sync_auto_minutes,
    settings.sync_provider,
  ]);

  const categoryRules = getJsonSetting<Record<string, string>>("category_rules", {});
  const txKnownCategories = useMemo(
    () => [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES],
    [],
  );

  const accentHex = resolveAccentFromSettings(settings);
  const currentTheme = useMemo(() => buildThemeFromAccent(accentHex), [accentHex]);
  const uiFontPx = Number(settings.ui_font_px || "15");
  const allMenus = ALL_MENU_KEYS;
  const highAlertsCount = alerts.filter((item) => item.severidad === "alta").length;

  useEffect(() => {
    localStorage.setItem("soberan-daynight", dayNightMode);
  }, [dayNightMode]);

  useEffect(() => {
    localStorage.setItem("soberan-ui-density", uiDensity);
  }, [uiDensity]);

  useEffect(() => {
    localStorage.setItem("soberan-budget-view-mode", budgetViewMode);
  }, [budgetViewMode]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsSidebarOpen(true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void loadAll();
        return;
      }
      if (isTyping) return;
      if (event.key === "[") {
        const currentIndex = allMenus.indexOf(currentMenu);
        const next = currentIndex <= 0 ? allMenus[allMenus.length - 1] : allMenus[currentIndex - 1];
        setCurrentMenu(next);
      }
      if (event.key === "]") {
        const currentIndex = allMenus.indexOf(currentMenu);
        const next = currentIndex >= allMenus.length - 1 ? allMenus[0] : allMenus[currentIndex + 1];
        setCurrentMenu(next);
      }
    }
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [allMenus, currentMenu, loadAll, setCurrentMenu]);

  const isBudgetYearToolbar = currentMenu === "Presupuesto" && budgetViewMode === "year";
  const showToolbarActions = (
    ["Resumen Ejecutivo", "Flujo de Efectivo", "Ingresos", "Presupuesto", "Transacciones", "Cuentas"] as MenuKey[]
  ).includes(currentMenu);
  const showToolbarPeriod = currentMenu === "Presupuesto" && !isBudgetYearToolbar;
  const showContentToolbar = showToolbarActions || showToolbarPeriod;

  function renderDashboard() {
    const monthSpent = monthlyTransactions
      .reduce((acc, tx) => acc + budgetExpenseAmount(tx), 0);
    const liquidity = totals.totalCash;
    const emergencyFund = buildEmergencyFundSnapshot({
      transactions,
      recurringEntries,
      debts,
      debtInstallments,
      month,
      year,
      liquidity,
      profileSetting: settings.emergency_income_profile || "auto",
    });
    const targetSavingsPct = Math.max(0, Number(settings.target_savings_pct || 20) || 20);
    const projectionReturnPct = Math.max(0, Number(settings.projection_return_pct || 0) || 0);
    const projectionOpts = {
      annualReturnPct: projectionReturnPct,
      investmentsNow: totals.totalInvestments,
    };
    const projectionBudget = {
      recurringEntries,
      workHistory,
      salaryBreakdowns,
      monthlyBudgets,
      debts,
      debtInstallments,
    };
    const savingsRate = totals.monthlyIncome > 0 ? totals.monthlySavings / totals.monthlyIncome : 0;
    const proj90Row = buildNetWorthProjections({
      netWorthNow: totals.netWorth,
      cashNow: totals.totalCash,
      month,
      year,
      budgetSchedule: projectionBudget,
      options: projectionOpts,
      horizons: [{ months: 3, label: "3 meses" }],
    })[0];
    const proj90 = proj90Row?.netWorth ?? totals.netWorth;
    const light = financialTrafficLightV2({
      efMonths: emergencyFund.efMonths,
      savingsRate,
      proj90,
      totalDebt: totals.totalDebt,
      totalCash: totals.totalCash,
      profile: emergencyFund.profile,
      targetSavingsPct,
    });

    const totalInvested = investments.reduce((s, i) => s + Number(i.monto_invertido || 0), 0);
    const investmentPnl = totals.totalInvestments - totalInvested;
    const nextDebt = nextDebtPayment(debts, debtInstallments);
    const dtiPct =
      totals.monthlyIncome > 0
        ? (monthlyDebtObligation(debts, debtInstallments, month, year, recurringExpenseNames(recurringEntries)) /
            totals.monthlyIncome) *
          100
        : 0;

    return (
      <InicioView
        month={month}
        year={year}
        targetSavingsPct={targetSavingsPct}
        projectionReturnPct={projectionReturnPct}
        totals={totals}
        liquidity={liquidity}
        light={light}
        alerts={alerts}
        investmentPnl={investmentPnl}
        totalInvested={totalInvested}
        activeSalary={activeSalary}
        privacyMode={privacyMode}
        formatEUR={formatEURPrivate}
        onNavigate={setCurrentMenu}
        calendarEvents={calendarEvents}
        goals={goals}
        accounts={accounts}
        monthSpent={monthSpent}
        patrimonioEvolution={patrimonioEvolution}
        transactionCount={transactions.length}
        uiDensity={uiDensity}
        nextDebtPayment={nextDebt}
        dtiPct={dtiPct}
        emergencyFund={emergencyFund}
        saveSetting={saveSetting}
        projectionBudget={projectionBudget}
        transactions={transactions}
        loadAll={loadAll}
        addToast={addToast}
      />
    );
  }

  function renderCompoundInterest() {
    return (
      <CompoundInterestView
        formatEUR={formatEURPrivate}
        totalInvestments={totals.totalInvestments}
        monthlySavings={totals.monthlySavings}
      />
    );
  }

  function renderAnnualEvolution() {
    return (
      <AnnualEvolutionView
        year={year}
        patrimonioEvolution={patrimonioEvolution}
        investments={investments}
        totals={totals}
        formatEUR={formatEURPrivate}
      />
    );
  }

  function renderCashFlow() {
    return (
      <CashFlowView
        month={month}
        year={year}
        transactions={transactions}
        monthlyTransactions={monthlyTransactions}
        calendarEvents={calendarEvents}
        recurringEntries={recurringEntries}
        debts={debts}
        debtInstallments={debtInstallments}
        totals={totals}
        formatEUR={formatEURPrivate}
        onNavigate={setCurrentMenu}
      />
    );
  }

  function renderIngresos() {
    return (
      <IngresosView
        month={month}
        year={year}
        recurringEntries={recurringEntries}
        monthlyTransactions={monthlyTransactions}
        formatEUR={formatEURPrivate}
        addToast={addToast}
        loadAll={loadAll}
        deleteWithUndo={deleteWithUndo}
      />
    );
  }

  function renderBudget() {
    return (
      <BudgetView
        month={month}
        year={year}
        recurringEntries={recurringEntries}
        monthlyBudgets={monthlyBudgets}
        workHistory={workHistory}
        salaryBreakdowns={salaryBreakdowns}
        debts={debts}
        debtInstallments={debtInstallments}
        monthlyTransactions={monthlyTransactions}
        accounts={accounts}
        investments={investments}
        goals={goals}
        wishlist={wishlist}
        settings={settings}
        loadAll={loadAll}
        formatEUR={formatEURPrivate}
        addToast={addToast}
        onNavigate={setCurrentMenu}
        viewMode={budgetViewMode}
        onViewModeChange={setBudgetViewMode}
        yearOptions={yearSelectOptions}
        onYearChange={setYear}
        onAdjustYear={adjustYear}
        onGoToMonth={(m, y) => {
          setMonth(m);
          setYear(y);
          setBudgetViewMode("month");
        }}
      />
    );
  }

  function renderPaymentsCalendar() {
    return (
      <PaymentsCalendarView
        month={month}
        year={year}
        settings={settings}
        calendarEvents={calendarEvents}
        formatEUR={formatEURPrivate}
        saveSetting={saveSetting}
        onNavigate={setCurrentMenu}
        onGoToMonth={(m, y) => {
          setMonth(m);
          setYear(y);
        }}
        onShiftPeriod={(deltaMonths) => {
          const base = new Date(year, month - 1, 1);
          base.setMonth(base.getMonth() + deltaMonths);
          setMonth(base.getMonth() + 1);
          setYear(base.getFullYear());
        }}
      />
    );
  }

  async function copyBudgetToNextMonth() {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const result = await api.copyMonthlyBudget(month, year, nextMonth, nextYear);
    addToast(`Copiadas ${result.copied} partidas a ${nextMonth}/${nextYear}.`, "success");
    await loadAll({ silent: true });
  }

  function renderMonthlyClose() {
    const targetSavingsPct = Math.max(0, Number(settings.target_savings_pct || 20) || 20);
    return (
      <MonthlyCloseView
        month={month}
        year={year}
        monthlyTransactions={monthlyTransactions}
        recurringEntries={recurringEntries}
        netWorth={totals.netWorth}
        budgetTotals={totals}
        targetSavingsPct={targetSavingsPct}
        settings={settings}
        formatEUR={formatEURPrivate}
        addToast={addToast}
        saveSetting={saveSetting}
        onNavigateToTx={() => setCurrentMenu("Transacciones")}
        onNavigateToBudget={() => setCurrentMenu("Presupuesto")}
        onNavigate={setCurrentMenu}
        onCopyBudgetToNext={copyBudgetToNextMonth}
      />
    );
  }

  function renderCrudLists() {
    return (
      <CrudListsView
        currentMenu={currentMenu}
        accounts={accounts}
        transactions={transactions}
        goals={goals}
        debts={debts}
        debtInstallments={debtInstallments}
        investments={investments}
        wishlist={wishlist}
        monthlySavings={totals.monthlySavings}
        monthlyIncome={totals.monthlyIncome}
        month={month}
        year={year}
        monthlyBudgets={monthlyBudgets}
        recurringEntries={recurringEntries}
        settings={settings}
        formatEUR={formatEURPrivate}
        addToast={addToast}
        loadAll={loadAll}
        deleteWithUndo={deleteWithUndo}
        onOpenAccountModal={() => setIsAccountModalOpen(true)}
        onOpenTxModal={() => setIsTxModalOpen(true)}
      />
    );
  }

  function renderAssetsAndServices() {
    return (
      <AssetsAndServicesView
        currentMenu={currentMenu}
        accounts={accounts}
        investments={investments}
        properties={properties}
        moneyOwed={moneyOwed}
        cards={cards}
        krakenBalances={krakenBalances}
        settings={settings}
        formatEUR={formatEURPrivate}
        addToast={addToast}
        loadAll={loadAll}
        deleteWithUndo={deleteWithUndo}
        saveSetting={saveSetting}
      />
    );
  }

  function renderWorkAndTaxes() {
    return (
      <WorkAndTaxesView
        currentMenu={currentMenu}
        year={year}
        workHistory={workHistory}
        recurringEntries={recurringEntries}
        accounts={accounts}
        settings={settings}
        activeSalary={activeSalary}
        formatEUR={formatEURPrivate}
        addToast={addToast}
        loadAll={loadAll}
        deleteWithUndo={deleteWithUndo}
        saveSetting={saveSetting}
        onNavigateToHistorialLaboral={() => setCurrentMenu("Historial Laboral")}
        onNavigate={setCurrentMenu}
      />
    );
  }

  function renderSettings() {
    return (
      <SettingsView
        settings={settings}
        saveSetting={saveSetting}
        desktopMode={desktopMode}
        nativeSyncMode={nativeShellMode}
        desktopVersion={desktopVersion}
        onCheckDesktopUpdates={checkDesktopUpdatesNow}
        onChatEnabledChange={(enabled) => {
          if (!enabled) chat.setChatOpen(false);
        }}
        onRelaunchOnboarding={() => setManualOnboarding(true)}
        tableCounts={{
          accounts: accounts.length,
          transactions: transactions.length,
          "recurring-entries": recurringEntries.length,
          goals: goals.length,
          debts: debts.length,
          investments: investments.length,
          properties: properties.length,
          "work-history": workHistory.length,
          "salary-breakdown": salaryBreakdowns.length,
        }}
        addToast={addToast}
        loadAll={loadAll}
      />
    );
  }

  function SectionTabs({ section }: { section: MenuSection }) {
    const tabs = SECTION_TABS[section];
    const tabsRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      if (tabs.length <= 1) return;
      const container = tabsRef.current;
      if (!container) return;
      const activeTab = container.querySelector<HTMLButtonElement>(".section-tab--active");
      if (!activeTab) return;
      activeTab.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }, [tabs]);

    if (tabs.length <= 1) return null;

    return (
      <div className="section-tabs" role="tablist" aria-label={`Navegación ${section.toLowerCase()}`} ref={tabsRef}>
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`section-tab${currentMenu === tab ? " section-tab--active" : ""}`}
            onClick={() => setCurrentMenu(tab)}
            role="tab"
            aria-selected={currentMenu === tab}
            aria-current={currentMenu === tab ? "page" : undefined}
          >
            {tab}
          </button>
        ))}
      </div>
    );
  }

  function renderCurrentMenu() {
    const section = menuKeyToSection(currentMenu);
    const tabs = section !== "Inicio" ? <SectionTabs section={section} /> : null;

    if (currentMenu === "Resumen Ejecutivo") return <>{tabs}{renderDashboard()}</>;
    if (currentMenu === "Interés Compuesto") return <>{tabs}{renderCompoundInterest()}</>;
    if (currentMenu === "Evolución Anual") return <>{tabs}{renderAnnualEvolution()}</>;
    if (currentMenu === "Flujo de Efectivo") return <>{tabs}{renderCashFlow()}</>;
    if (currentMenu === "Ingresos") return <>{tabs}{renderIngresos()}</>;
    if (currentMenu === "Presupuesto") return <>{tabs}{renderBudget()}</>;
    if (currentMenu === "Calendario de Pagos") return <>{tabs}{renderPaymentsCalendar()}</>;
    if (currentMenu === "Cierre Mensual") return <>{tabs}{renderMonthlyClose()}</>;
    if (["Cuentas", "Transacciones", "Objetivos", "Pasivos"].includes(currentMenu)) return <>{tabs}{renderCrudLists()}</>;
    if (["Inversiones", "Activos Fijos", "Cuentas a Cobrar", "Tarjetas"].includes(currentMenu))
      return <>{tabs}{renderAssetsAndServices()}</>;
    if (["Historial Laboral", "Impuestos"].includes(currentMenu)) return <>{tabs}{renderWorkAndTaxes()}</>;
    if (currentMenu === "Configuración") return <>{tabs}{renderSettings()}</>;
    return <section className="card">Módulo en construcción.</section>;
  }

  const effectiveDark = dayNightMode === "night" ? true : dayNightMode === "day" ? false : systemDark;

  if (!bootstrapped || loading) {
    return (
      <main className="app-shell theme-light">
        <section className="card" style={{ margin: "2rem auto", maxWidth: 720 }}>
          <ViewSkeleton rows={4} />
        </section>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </main>
    );
  }

  if (onboardingRequired || manualOnboarding) {
    return (
      <>
        <OnboardingWizard
          initialSettings={settings}
          onCancel={manualOnboarding ? () => setManualOnboarding(false) : undefined}
          onComplete={(patch) => {
            persistOnboardingDoneLocal();
            setSettings((prev) => ({ ...prev, ...patch }));
            void loadAll({ silent: true });
            setManualOnboarding(false);
          }}
          onNavigateToLaboral={() => { setManualOnboarding(false); setCurrentMenu("Historial Laboral"); }}
        />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  const shellStyle = {
    "--primary": currentTheme.primary,
    "--accent": currentTheme.accent,
    "--gradient": currentTheme.gradient,
    "--ui-font": `${Math.min(22, Math.max(12, uiFontPx))}px`,
  } as CSSProperties;

  return (
    <AppShell
      effectiveDark={effectiveDark}
      privacyMode={privacyMode}
      uiDensity={uiDensity}
      shellStyle={shellStyle}
      currentMenu={currentMenu}
      setCurrentMenu={setCurrentMenu}
      isSidebarOpen={isSidebarOpen}
      setIsSidebarOpen={setIsSidebarOpen}
      dayNightMode={dayNightMode}
      setDayNightMode={setDayNightMode}
      setUiDensity={setUiDensity}
      setPrivacyMode={setPrivacyMode}
      setMethodGuideOpen={setMethodGuideOpen}
      alerts={alerts}
      highAlertsCount={highAlertsCount}
      alertsPopoverOpen={alertsPopoverOpen}
      setAlertsPopoverOpen={setAlertsPopoverOpen}
      desktopMode={desktopMode}
      desktopUpdate={desktopUpdate}
      dismissDesktopUpdate={dismissDesktopUpdate}
      showContentToolbar={showContentToolbar}
      showToolbarActions={showToolbarActions}
      showToolbarPeriod={showToolbarPeriod}
      monthRefreshing={monthRefreshing}
      month={month}
      year={year}
      adjustMonth={adjustMonth}
      setMonth={setMonth}
      setYear={setYear}
      setIsTxModalOpen={setIsTxModalOpen}
      setIsAccountModalOpen={setIsAccountModalOpen}
      loading={loading}
      error={error}
      message={message}
      modals={
        <>
          <GlassModal isOpen={isAccountModalOpen} onClose={() => setIsAccountModalOpen(false)} title="Nueva cuenta">
            <ModalFormError error={accountSubmit.error} />
            {isAccountModalOpen && (
              <AccountForm
                saving={accountSubmit.saving}
                onSubmit={(values) => {
                  void accountSubmit.run(async () => {
                    await api.createAccount({
                      ...values,
                      alias_anonimo: values.alias_anonimo || undefined,
                    });
                    setIsAccountModalOpen(false);
                    addToast("Cuenta creada.", "success");
                    await loadAll({ silent: true });
                  });
                }}
              />
            )}
          </GlassModal>

          <GlassModal isOpen={isTxModalOpen} onClose={() => setIsTxModalOpen(false)} title="Nuevo movimiento">
            <ModalFormError error={txSubmit.error} />
            {isTxModalOpen && (
              <TxForm
                accounts={accounts}
                knownCategories={txKnownCategories}
                categoryRules={categoryRules}
                initialAccountId={accounts[0]?.id ?? 0}
                saving={txSubmit.saving}
                onSubmit={(values) => {
                  void txSubmit.run(async () => {
                    const text = (values.description_raw || "").toLowerCase();
                    const matched = Object.entries(categoryRules).find(([pattern]) =>
                      text.includes(pattern.toLowerCase()),
                    );
                    const finalCategory = values.category_anon || matched?.[1] || "";
                    if (!finalCategory.trim()) {
                      throw new Error("Usa una categoría específica para el movimiento.");
                    }
                    await api.createTransaction({
                      ...values,
                      category_anon: finalCategory.trim(),
                      date: values.date || undefined,
                      tipo_meta: values.tipo_meta || undefined,
                    });
                    const token = values.description_raw.trim().split(" ")[0]?.toLowerCase() || "";
                    if (token.length >= 4 && !categoryRules[token]) {
                      await api.setSetting(
                        "category_rules",
                        JSON.stringify({ ...categoryRules, [token]: finalCategory.trim() }),
                      );
                    }
                    setIsTxModalOpen(false);
                    addToast("Movimiento guardado.", "success");
                    await loadAll({ silent: true });
                  });
                }}
              />
            )}
          </GlassModal>

          {chatEnabled && (
            <ChatPanel
              desktopMode={desktopMode}
              chatOpen={chat.chatOpen}
              setChatOpen={chat.setChatOpen}
              chatMessages={chat.chatMessages}
              setChatMessages={chat.setChatMessages}
              chatLoading={chat.chatLoading}
              chatStatus={chat.chatStatus}
              chatOnline={chat.chatOnline}
              sendMessage={chat.sendMessage}
              pendingConfirm={chat.pendingConfirm}
              confirmLoading={chat.confirmLoading}
              confirmWrites={chat.confirmWrites}
              cancelWrites={chat.cancelWrites}
            />
          )}

          <ToastContainer toasts={toasts} onDismiss={dismissToast} />
          <MethodGuideModal isOpen={methodGuideOpen} onClose={() => setMethodGuideOpen(false)} />
        </>
      }
    >
      {renderCurrentMenu()}
    </AppShell>
  );
}
