import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../services/api";
import { transactionInCalendarMonth } from "../utils/format";
import { computeMonthlyBudgetTotals } from "../utils/budgetTotals";
import { getJsonSetting as readJsonSetting } from "../utils/settings";
import type {
  Account,
  AlertItem,
  CalendarEvent,
  Card,
  Debt,
  DebtInstallment,
  Goal,
  Investment,
  MoneyOwed,
  MonthlyBudget,
  Property,
  RecurringEntry,
  SalaryBreakdown,
  WorkHistory,
  Transaction,
  WishlistItem,
} from "../types";
import type { AddToastOptions } from "./useAppToasts";
import type { ToastItem } from "../components/Toast";

export const ONBOARDING_DONE_LS = "soberan-onboarding-done";

export function readOnboardingDoneLocal(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_DONE_LS) === "true";
  } catch {
    return false;
  }
}

export function persistOnboardingDoneLocal(): void {
  try {
    localStorage.setItem(ONBOARDING_DONE_LS, "true");
  } catch {
    // ignore quota / private mode
  }
}

export function isOnboardingMarkedDone(settings: Record<string, string>): boolean {
  return settings.onboarding_done === "true" || readOnboardingDoneLocal();
}

type AddToast = (
  message: string,
  type: "success" | "error" | "info",
  opts?: AddToastOptions,
) => void;

type Options = {
  addToast: AddToast;
  dismissToast: (id: number) => void;
  allocateToastId: () => number;
  pushToast: (toast: ToastItem) => void;
};

export function useSoberanData({
  addToast,
  dismissToast,
  allocateToastId,
  pushToast,
}: Options) {
  const [loading, setLoading] = useState(true);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [coreDataLoaded, setCoreDataLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [monthRefreshing, setMonthRefreshing] = useState(false);
  const initialLoadDone = useRef(false);
  const bankAutoSyncDone = useRef(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [debtInstallments, setDebtInstallments] = useState<DebtInstallment[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [workHistory, setWorkHistory] = useState<WorkHistory[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [moneyOwed, setMoneyOwed] = useState<MoneyOwed[]>([]);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [recurringEntries, setRecurringEntries] = useState<RecurringEntry[]>([]);
  const [monthlyBudgets, setMonthlyBudgets] = useState<MonthlyBudget[]>([]);
  const [salaryBreakdowns, setSalaryBreakdowns] = useState<SalaryBreakdown[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [patrimonioEvolution, setPatrimonioEvolution] = useState<Array<{ fecha: string; acumulado: number }>>([]);
  const [krakenBalances, setKrakenBalances] = useState<
    Array<{ asset: string; amount: number; eur_value: number | null; eur_price: number | null; type: string }>
  >([]);

  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [settings, setSettings] = useState<Record<string, string>>({});

  function deleteWithUndo(label: string, onCommit: () => Promise<void>, onCancel?: () => void) {
    const id = allocateToastId();
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        await onCommit();
      } catch {
        addToast("No se pudo eliminar.", "error");
        onCancel?.();
      }
      dismissToast(id);
    }, 5000);
    pushToast({
      id,
      message: `${label} — se eliminará en 5 s`,
      type: "info" as const,
      duration: 5500,
      action: {
        label: "Deshacer",
        onClick: () => {
          cancelled = true;
          window.clearTimeout(timer);
          onCancel?.();
        },
      },
    });
  }

  const monthlyTransactions = useMemo(() => {
    return transactions.filter((tx) => transactionInCalendarMonth(tx.date, month, year));
  }, [month, transactions, year]);

  const activeSalary = useMemo(() => {
    const job = workHistory.find((w) => !w.fecha_fin && w.salario_bruto);
    if (!job) return null;
    const bruto = job.periodicidad === "A" ? (job.salario_bruto ?? 0) / 12 : (job.salario_bruto ?? 0);
    const irpf = (bruto * (job.irpf_pct ?? 0)) / 100;
    const ss = (bruto * (job.ss_pct ?? 0)) / 100;
    return {
      empresa: job.empresa,
      bruto,
      irpf,
      ss,
      neto: bruto - irpf - ss,
      irpf_pct: job.irpf_pct ?? 0,
      ss_pct: job.ss_pct ?? 0,
    };
  }, [workHistory]);

  const totals = useMemo(() => {
    const totalCash = accounts.reduce((acc, item) => acc + Number(item.balance_actual || 0), 0);
    const totalDebt = debts.reduce(
      (acc, item) => acc + (Number(item.monto_total || 0) - Number(item.monto_pagado || 0)),
      0,
    );
    const totalAssets = properties.reduce((acc, item) => acc + Number(item.valor_estimado || 0), 0);
    const totalInvestments = investments.reduce((acc, item) => acc + Number(item.valor_actual || 0), 0);
    const netWorth = totalCash + totalAssets + totalInvestments - totalDebt;
    const budgetTotals = computeMonthlyBudgetTotals({
      recurringEntries,
      month,
      year,
      workHistory,
      salaryBreakdowns,
      monthlyBudgets,
      debts,
      debtInstallments,
    });
    return {
      totalCash,
      totalDebt,
      totalAssets,
      totalInvestments,
      netWorth,
      ...budgetTotals,
      monthlyCashOutflows: budgetTotals.monthlyLiquidityOutflows,
    };
  }, [
    accounts,
    debts,
    debtInstallments,
    investments,
    properties,
    recurringEntries,
    workHistory,
    salaryBreakdowns,
    monthlyBudgets,
    month,
    year,
  ]);

  const hasExistingAppData =
    accounts.length > 0 ||
    transactions.length > 0 ||
    recurringEntries.length > 0 ||
    debts.length > 0 ||
    debtInstallments.length > 0 ||
    goals.length > 0 ||
    investments.length > 0 ||
    properties.length > 0 ||
    workHistory.length > 0 ||
    cards.length > 0 ||
    moneyOwed.length > 0 ||
    wishlist.length > 0;

  const onboardingDone = isOnboardingMarkedDone(settings);
  const onboardingRequired =
    bootstrapped && coreDataLoaded && !error && !onboardingDone && !hasExistingAppData;

  const loadSettings = useCallback(async () => {
    const keys = [
      "theme_accent",
      "theme_name",
      "ui_font_px",
      "birth_date",
      "backup_passphrase",
      "public_calendar_host",
      "public_calendar_scheme",
      "public_calendar_port",
      "ical_feed_version",
      "recurring_income_mode",
      "recurring_income_day",
      "recurring_expense_day",
      "recurring_income_advance_days",
      "target_savings_pct",
      "projection_return_pct",
      "budget_thresholds",
      "decision_log",
      "monthly_closure_snapshots",
      "category_rules",
      "merchant_names",
      "bank_import_templates",
      "category_import_templates",
      "onboarding_done",
      "emergency_income_profile",
      "payroll_company_config",
      "sepe_status",
      "sepe_ultima_renovacion",
      "sepe_intervalo_dias",
      "kraken_api_key",
      "kraken_api_secret",
      "myinvestor_last_import_at",
      "desktop_check_updates",
      "sync_custom_url",
      "sync_custom_token",
      "sync_provider",
      "sync_auto_enabled",
      "sync_auto_minutes",
      "sync_last_push_at",
      "sync_last_pull_at",
      "chat_enabled",
      "ollama_base_url",
      "ollama_model",
      `monthly_close_${year}_${month}`,
    ];
    const uniqueKeys = [...new Set(keys)];
    const bulk = await api.getSettings(uniqueKeys);
    const next: Record<string, string> = {};
    for (const key of uniqueKeys) {
      next[key] = bulk[key] ?? "";
    }
    setSettings(next);
  }, [month, year]);

  const loadCoreData = useCallback(async () => {
    const [
      accountsData,
      txData,
      goalsData,
      debtsData,
      debtInstallmentsData,
      propsData,
      invData,
      workData,
      cardsData,
      owedData,
      recurringData,
      alertsData,
      wishlistData,
    ] = await Promise.all([
      api.getAccounts(),
      api.getTransactions(),
      api.getGoals(),
      api.getDebts(),
      api.getAllDebtInstallments(),
      api.getProperties(),
      api.getInvestments(),
      api.getWorkHistory(),
      api.getCards(),
      api.getMoneyOwed(),
      api.getRecurringEntries(),
      api.getAlerts(),
      api.getWishlist(),
    ]);

    setAccounts(accountsData);
    setTransactions(txData);
    setGoals(goalsData);
    setDebts(debtsData);
    setDebtInstallments(debtInstallmentsData);
    setProperties(propsData);
    setInvestments(invData);
    setWorkHistory(workData);
    setCards(cardsData);
    setMoneyOwed(owedData);
    setRecurringEntries(recurringData);
    setWishlist(wishlistData);
    setAlerts(alertsData);
  }, []);

  const loadMonthData = useCallback(async () => {
    const [eventsData, evolutionData, monthlyBudgetsData, salaryData] = await Promise.all([
      api.getCalendarPagos(month, year),
      api.getPatrimonioEvolucion(year),
      api.getMonthlyBudget(month, year),
      api.getSalaryBreakdown(month, year),
    ]);
    setCalendarEvents(eventsData);
    setPatrimonioEvolution(evolutionData);
    setMonthlyBudgets(monthlyBudgetsData);
    setSalaryBreakdowns(salaryData);
  }, [month, year]);

  const hydrateSettings = useCallback(async () => {
    try {
      await loadSettings();
    } catch {
      // La app puede seguir sin ajustes opcionales.
    }
  }, [loadSettings]);

  const refreshAccountsAndTransactions = useCallback(async () => {
    const [accountsData, txData] = await Promise.all([api.getAccounts(), api.getTransactions()]);
    setAccounts(accountsData);
    setTransactions(txData);
  }, []);

  const loadAll = useCallback(
    async (opts?: { silent?: boolean }) => {
      const keepScroll = Boolean(opts?.silent);
      const scrollY = keepScroll ? window.scrollY : 0;
      if (!opts?.silent) setLoading(true);
      setError(null);
      let coreOk = false;
      try {
        const [coreResult, monthResult] = await Promise.allSettled([loadCoreData(), loadMonthData()]);
        coreOk = coreResult.status === "fulfilled";
        const failures = [coreResult, monthResult].filter(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        if (failures.length > 0) {
          const first = failures[0]!.reason;
          setError(first instanceof Error ? first.message : "No se pudo cargar la aplicación.");
        }
      } finally {
        setCoreDataLoaded(coreOk);
        setBootstrapped(true);
        if (!opts?.silent) setLoading(false);
        if (keepScroll) {
          requestAnimationFrame(() => {
            window.scrollTo({ top: scrollY, behavior: "auto" });
          });
        }
        // Settings after first paint — do not block splash
        void hydrateSettings();
      }
    },
    [loadCoreData, loadMonthData, hydrateSettings],
  );

  async function saveSetting(key: string, value: string, notify = false) {
    try {
      await api.setSetting(key, value);
      setSettings((prev) => ({ ...prev, [key]: value }));
      if (notify) addToast("Ajuste guardado.", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "No se pudo guardar.", "error");
    }
  }

  function getJsonSetting<T>(key: string, fallback: T): T {
    return readJsonSetting(settings, key, fallback);
  }

  async function notifyAfter(action: () => Promise<void>, okText: string, failText: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      addToast(okText, "success");
      await loadAll({ silent: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : failText;
      addToast(msg, "error");
    }
  }

  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      void loadAll();
      return;
    }
    setMonthRefreshing(true);
    void loadMonthData()
      .catch((err) => {
        addToast(err instanceof Error ? err.message : "No se pudo actualizar el período.", "error");
      })
      .finally(() => {
        void hydrateSettings();
        setMonthRefreshing(false);
      });
    // addToast intentionally omitted — same as App monolith
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year, loadAll, loadMonthData, hydrateSettings]);

  useEffect(() => {
    if (!bootstrapped) return;

    if (settings.onboarding_done === "true") {
      persistOnboardingDoneLocal();
      return;
    }

    if (readOnboardingDoneLocal()) {
      setSettings((prev) => ({ ...prev, onboarding_done: "true" }));
      void api.setSetting("onboarding_done", "true").catch(() => {});
      return;
    }

    if (!hasExistingAppData) return;

    persistOnboardingDoneLocal();
    setSettings((prev) => ({ ...prev, onboarding_done: "true" }));
    void api.setSetting("onboarding_done", "true").catch(() => {});
  }, [bootstrapped, hasExistingAppData, settings.onboarding_done]);

  // Soft-refresh bank accounts after GoCardless import (off critical path)
  useEffect(() => {
    if (!bootstrapped) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .importBankAccounts()
        .then((result) => {
          if (cancelled) return;
          if ((result.imported ?? 0) > 0 || (result.transactions_created ?? 0) > 0) {
            void refreshAccountsAndTransactions();
          }
        })
        .catch(() => {
          // GoCardless puede no estar configurado
        });
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bootstrapped, refreshAccountsAndTransactions]);

  // Defer Kraken / vehicles / bank sync until after first paint
  useEffect(() => {
    if (!bootstrapped) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      void api
        .syncKraken()
        .then(() => api.getKrakenBalance().then((d) => {
          if (!cancelled) setKrakenBalances(d.balances);
        }))
        .catch(() => {});
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bootstrapped]);

  useEffect(() => {
    if (!bootstrapped || !coreDataLoaded || bankAutoSyncDone.current) return;
    const linked = accounts.filter((account) => account.gocardless_account_id);
    if (linked.length === 0) return;

    bankAutoSyncDone.current = true;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      void api
        .syncBankAccounts({})
        .then(() => {
          if (!cancelled) return refreshAccountsAndTransactions();
        })
        .catch(() => {});
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [accounts, bootstrapped, coreDataLoaded, refreshAccountsAndTransactions]);

  useEffect(() => {
    if (!bootstrapped) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      void api
        .refreshDueVehicleValuations()
        .then((result) => {
          if (cancelled) return;
          if (result.refreshed.length > 0) {
            const n = result.refreshed.length;
            addToast(
              n === 1
                ? "Valoración de 1 vehículo actualizada"
                : `Valoración de ${n} vehículos actualizada`,
              "success",
            );
            void refreshAccountsAndTransactions();
            void api.getProperties().then((propsData) => {
              if (!cancelled) setProperties(propsData);
            });
          } else if (result.errors.length > 0) {
            addToast("No se pudo actualizar alguna valoración de vehículo.", "info");
          }
        })
        .catch(() => {
          /* silent: app usable without market scrapers */
        });
    }, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- post-paint once per boot
  }, [bootstrapped]);

  function adjustMonth(offset: number) {
    const base = new Date(year, month - 1, 1);
    base.setMonth(base.getMonth() + offset);
    setMonth(base.getMonth() + 1);
    setYear(base.getFullYear());
  }

  const currentCalendarYear = new Date().getFullYear();
  const yearSelectOptions = useMemo(
    () => Array.from({ length: 41 }, (_, i) => currentCalendarYear - 20 + i),
    [currentCalendarYear],
  );

  function adjustYear(offset: number) {
    const min = currentCalendarYear - 20;
    const max = currentCalendarYear + 20;
    setYear((y) => Math.min(max, Math.max(min, y + offset)));
  }

  return {
    loading,
    bootstrapped,
    coreDataLoaded,
    error,
    message,
    setMessage,
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
    hasExistingAppData,
    onboardingDone,
    onboardingRequired,
    loadAll,
    loadMonthData,
    hydrateSettings,
    saveSetting,
    getJsonSetting,
    notifyAfter,
    deleteWithUndo,
    adjustMonth,
    adjustYear,
    yearSelectOptions,
  };
}
