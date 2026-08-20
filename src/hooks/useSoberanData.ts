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

// Client-side (WebView) mirror of the last successful fetch for every core/month
// dataset + settings, hydrated synchronously into useState's lazy initializer below —
// the very first render already has the last-known data instead of empty arrays that
// silently fill in a beat later once the network round-trip (even a local one, to the
// embedded backend) resolves. loadAll()/loadMonthData()/loadSettings() write through to
// this on every successful fetch, so it's never more than one load cycle stale.
const CACHE_PREFIX = "soberan-cache-v1:";

function readCache<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw !== null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or localStorage unavailable (private mode) — caching is a nice-to-
    // have for instant paint, never required for correctness, so this is silently skipped.
  }
}

// Written once loadCoreData() has ever succeeded — checked synchronously (not via an
// effect) to seed `loading`'s initial value below. Populating accounts/transactions/etc.
// from cache alone wasn't enough: AppShell renders <ViewSkeleton> in place of real
// content for as long as `loading` is true, and that used to start true unconditionally,
// hiding the already-hydrated cached data behind a skeleton until the real network round
// trip finished anyway — the exact "still slow to load" a second app open shouldn't be.
function hasCachedSnapshot(): boolean {
  try {
    return localStorage.getItem(CACHE_PREFIX + "hasSnapshot") === "1";
  } catch {
    return false;
  }
}

function markCachedSnapshot(): void {
  try {
    localStorage.setItem(CACHE_PREFIX + "hasSnapshot", "1");
  } catch {
    // best-effort, see writeCache
  }
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
  // Starts false when a previous successful load already left a cached snapshot — that
  // data is already hydrated into accounts/transactions/etc.'s useState below, so there's
  // real content to paint immediately instead of hiding it behind <ViewSkeleton> for the
  // duration of a fresh network round trip. loadAll() still runs in the background either
  // way to refresh it; only the *first-ever* load (nothing cached yet) blocks on it.
  const [loading, setLoading] = useState(() => !hasCachedSnapshot());
  const [bootstrapped, setBootstrapped] = useState(false);
  const [coreDataLoaded, setCoreDataLoaded] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const settingsLoadedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [monthRefreshing, setMonthRefreshing] = useState(false);
  const initialLoadDone = useRef(false);
  const bankAutoSyncDone = useRef(false);

  const [accounts, setAccounts] = useState<Account[]>(() => readCache("accounts", []));
  const [transactions, setTransactions] = useState<Transaction[]>(() => readCache("transactions", []));
  const [goals, setGoals] = useState<Goal[]>(() => readCache("goals", []));
  const [debts, setDebts] = useState<Debt[]>(() => readCache("debts", []));
  const [debtInstallments, setDebtInstallments] = useState<DebtInstallment[]>(() => readCache("debtInstallments", []));
  const [properties, setProperties] = useState<Property[]>(() => readCache("properties", []));
  const [investments, setInvestments] = useState<Investment[]>(() => readCache("investments", []));
  const [workHistory, setWorkHistory] = useState<WorkHistory[]>(() => readCache("workHistory", []));
  const [cards, setCards] = useState<Card[]>(() => readCache("cards", []));
  const [moneyOwed, setMoneyOwed] = useState<MoneyOwed[]>(() => readCache("moneyOwed", []));
  const [wishlist, setWishlist] = useState<WishlistItem[]>(() => readCache("wishlist", []));
  const [recurringEntries, setRecurringEntries] = useState<RecurringEntry[]>(() => readCache("recurringEntries", []));
  const [monthlyBudgets, setMonthlyBudgets] = useState<MonthlyBudget[]>(() => readCache("monthlyBudgets", []));
  const [salaryBreakdowns, setSalaryBreakdowns] = useState<SalaryBreakdown[]>(() => readCache("salaryBreakdowns", []));
  const [alerts, setAlerts] = useState<AlertItem[]>(() => readCache("alerts", []));
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(() => readCache("calendarEvents", []));
  const [patrimonioEvolution, setPatrimonioEvolution] = useState<Array<{ fecha: string; acumulado: number }>>(() =>
    readCache("patrimonioEvolution", []),
  );
  const [krakenBalances, setKrakenBalances] = useState<
    Array<{ asset: string; amount: number; eur_value: number | null; eur_price: number | null; type: string }>
  >([]);

  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [settings, setSettings] = useState<Record<string, string>>(() => readCache("settings", {}));

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

  const onboardingDone = isOnboardingMarkedDone(settings);
  // onboarding_done (backend setting or local flag) is the only source of truth — it used to
  // also skip onboarding whenever any data already existed, which meant a fresh install that
  // happened to have leftover/seeded data (e.g. on-device SQLite surviving a reinstall) landed
  // straight on Inicio without the wizard ever running, instead of at onboarding like it should.
  //
  // Gated on settingsLoaded alone, not bootstrapped/coreDataLoaded: on a genuinely fresh
  // install there's nothing in accounts/transactions/etc. to wait for, but the initial
  // mount effect used to fetch all of that (and everything else Inicio needs) *before*
  // even knowing onboarding_done, since settings used to be hydrated only after loadAll()
  // finished — the app visibly attempted to load Inicio first, every single first launch,
  // before flipping to onboarding a beat later. The initial mount effect below now fetches
  // settings in parallel with the rest from the very first attempt.
  const onboardingRequired = settingsLoaded && !error && !onboardingDone;

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
    writeCache("settings", next);
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

    writeCache("accounts", accountsData);
    writeCache("transactions", txData);
    writeCache("goals", goalsData);
    writeCache("debts", debtsData);
    writeCache("debtInstallments", debtInstallmentsData);
    writeCache("properties", propsData);
    writeCache("investments", invData);
    writeCache("workHistory", workData);
    writeCache("cards", cardsData);
    writeCache("moneyOwed", owedData);
    writeCache("recurringEntries", recurringData);
    writeCache("wishlist", wishlistData);
    writeCache("alerts", alertsData);
    markCachedSnapshot();
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

    writeCache("calendarEvents", eventsData);
    writeCache("patrimonioEvolution", evolutionData);
    writeCache("monthlyBudgets", monthlyBudgetsData);
    writeCache("salaryBreakdowns", salaryData);
  }, [month, year]);

  const hydrateSettings = useCallback(async () => {
    try {
      await loadSettings();
      settingsLoadedRef.current = true;
      setSettingsLoaded(true);
    } catch {
      // La app puede seguir sin ajustes opcionales — the initial-mount retry loop calls
      // this again on the next attempt, same as loadAll() for core data.
    }
  }, [loadSettings]);

  const refreshAccountsAndTransactions = useCallback(async () => {
    const [accountsData, txData] = await Promise.all([api.getAccounts(), api.getTransactions()]);
    setAccounts(accountsData);
    setTransactions(txData);
  }, []);

  const lastLoadOk = useRef(false);

  const loadAll = useCallback(
    async (opts?: { silent?: boolean }) => {
      // .content, not window/document — the app shell locks document-level scroll
      // entirely (base.css) so .content can scroll independently, keeping WKWebView's
      // fixed-position elements (.topbar/.site-footer/.mobile-tab-bar) fully isolated
      // from the scroll gesture instead of visibly lagging behind it.
      const scrollEl = document.querySelector<HTMLElement>(".content");
      const keepScroll = Boolean(opts?.silent);
      const scrollTop = keepScroll ? (scrollEl?.scrollTop ?? 0) : 0;
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
        lastLoadOk.current = coreOk;
        setCoreDataLoaded(coreOk);
        setBootstrapped(true);
        if (!opts?.silent) setLoading(false);
        if (keepScroll) {
          requestAnimationFrame(() => {
            scrollEl?.scrollTo({ top: scrollTop, behavior: "auto" });
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
      void (async () => {
        // The embedded on-device backend (iOS/Android) can take several seconds to finish
        // starting — native asset extraction + Alembic migrations run before uvicorn ever
        // binds its port — so the very first load can legitimately race ahead of it being
        // ready. Two phases: a quick burst covers the common case fast, then — instead of
        // giving up and leaving a dead-end error banner on screen forever — a slower
        // background retry keeps going indefinitely, so the app self-heals whenever the
        // backend does come up instead of requiring the user to force-quit and reopen.
        const BURST_ATTEMPTS = 10;
        const BURST_DELAY_MS = 1500;
        const BACKGROUND_DELAY_MS = 3000;
        setLoading(true);
        // Settings (onboarding_done in particular) fetched in parallel with core/month
        // data from the very first attempt, not after — onboardingRequired only needs
        // settingsLoaded now, so a fresh install can flip to onboarding as soon as this
        // resolves instead of waiting on loadAll() too (Inicio's own data is irrelevant
        // when the answer is "show onboarding instead").
        for (let attempt = 1; attempt <= BURST_ATTEMPTS; attempt++) {
          await Promise.all([loadAll({ silent: true }), hydrateSettings()]);
          if ((lastLoadOk.current && settingsLoadedRef.current) || attempt === BURST_ATTEMPTS) break;
          await new Promise((resolve) => setTimeout(resolve, BURST_DELAY_MS));
        }
        setLoading(false);
        while (!lastLoadOk.current || !settingsLoadedRef.current) {
          await new Promise((resolve) => setTimeout(resolve, BACKGROUND_DELAY_MS));
          await Promise.all([loadAll({ silent: true }), hydrateSettings()]);
        }
      })();
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
    }
  }, [bootstrapped, settings.onboarding_done]);

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
