import type {
  Account,
  AccountCreate,
  AlertItem,
  CalendarEvent,
  Card,
  CardCreate,
  Debt,
  DebtCreate,
  Goal,
  GoalCreate,
  Investment,
  InvestmentCreate,
  MoneyOwed,
  MoneyOwedCreate,
  MonthlyBudget,
  Property,
  PropertyCreate,
  RecurringEntry,
  RecurringEntryCreate,
  SalaryBreakdown,
  SalaryBreakdownCreate,
  SankeyData,
  Transaction,
  TransactionCreate,
  WishlistItem,
  WishlistItemCreate,
  WorkHistory,
  WorkHistoryCreate
} from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export { API_BASE_URL };

export function parseApiError(body: string, fallback: string): string {
  const trimmed = body.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.detail === "string") return parsed.detail;
    if (Array.isArray(parsed.detail)) {
      return parsed.detail
        .map((item) => {
          if (item && typeof item === "object" && "msg" in item) {
            return String((item as { msg: unknown }).msg);
          }
          return String(item);
        })
        .join("; ");
    }
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // body no es JSON
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return fallback;
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
}

export function parseApiJsonBody<T>(raw: string, status: number): T {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined as T;
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const looksHtml = trimmed.startsWith("<") || trimmed.toLowerCase().startsWith("<!doctype");
    throw new Error(
      looksHtml
        ? `El servidor devolvió HTML en lugar de JSON (HTTP ${status}). ¿La API está desplegada y /api enruta bien?`
        : `Respuesta no válida del servidor (HTTP ${status}).`,
    );
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      ...init
    });
  } catch {
    // fetch() itself rejects on network-level failures (connection refused, DNS, TLS...)
    // — before there's even an HTTP response to parse. The browser's own message for this
    // ("Load failed" on Safari/WebKit, "Failed to fetch" on Chrome) is raw English and
    // reads like a real bug to a Spanish-speaking end user. The single most common real
    // cause here: the embedded on-device backend (iOS/Android) hasn't finished starting
    // yet — a transient condition callers already retry around (useSoberanData's initial
    // retry loop) — so this should read as "still connecting", not "broken".
    throw new Error("No se pudo conectar con el servidor. Reintentando…");
  }

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(parseApiError(raw, `Error HTTP ${response.status}`));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return parseApiJsonBody<T>(raw, response.status);
}

export const api = {
  getSetting: (key: string) => request<{ value: string | null }>(`/settings/${key}`),
  getSettings: (keys?: string[]) => {
    const qs = keys?.length ? `?keys=${encodeURIComponent(keys.join(","))}` : "";
    return request<Record<string, string>>(`/settings/${qs}`);
  },
  setSetting: (key: string, value: string) =>
    request<{ status: string }>("/settings/", { method: "POST", body: JSON.stringify({ key, value }) }),
  testOllamaConnection: (url?: string) =>
    request<{ ok: boolean; ollama: string; url?: string | null; desktop?: boolean }>("/chat/test", {
      method: "POST",
      body: JSON.stringify(url ? { url } : {}),
    }),
  getChatStatus: () =>
    request<{ ollama: string; enabled?: boolean; url?: string | null; model?: string; desktop?: boolean }>(
      "/chat/status",
    ),

  getAccounts: () => request<Account[]>("/accounts/"),
  createAccount: (payload: AccountCreate) =>
    request<Account>("/accounts/", { method: "POST", body: JSON.stringify(payload) }),
  updateAccount: (id: number, payload: AccountCreate) =>
    request<Account>(`/accounts/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteAccount: (id: number) => request<{ status: string }>(`/accounts/${id}`, { method: "DELETE" }),
  listBanks: (country = "ES") =>
    request<Array<{ id: string; name: string; bic?: string; logo?: string; countries?: string[] }>>(
      `/banks/list?country=${encodeURIComponent(country)}`,
    ),
  createBankRequisition: (payload: { institution_id: string; redirect_url: string; institution_name?: string }) =>
    request<{ id: number; requisition_id: string; link?: string; status: string }>("/banks/requisition", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listBankRequisitions: () =>
    request<Array<{
      id: number;
      requisition_id: string;
      institution_id: string;
      institution_name?: string | null;
      status: string;
      link?: string | null;
      reference?: string | null;
      created_at?: string | null;
    }>>("/banks/requisitions"),
  getBankRequisition: (requisitionId: string) =>
    request<{
      id: number;
      requisition_id: string;
      institution_id: string;
      status: string;
      link?: string | null;
      accounts: Array<{
        gocardless_account_id: string;
        iban?: string | null;
        name?: string | null;
        currency?: string | null;
      }>;
    }>(`/banks/requisition/${encodeURIComponent(requisitionId)}`),
  deleteBankRequisition: (requisitionId: string) =>
    request<{ status: string }>(`/banks/requisition/${encodeURIComponent(requisitionId)}`, { method: "DELETE" }),
  importBankAccounts: () =>
    request<{ status: string; imported: number; account_ids: number[]; transactions_created?: number }>(
      "/banks/import-accounts",
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    ),
  linkBankAccount: (payload: { soberan_account_id: number; gocardless_account_id: string; institution_name?: string }) =>
    request<{ status: string; account_id: number; gocardless_account_id: string; alias_real?: string }>("/banks/link", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  unlinkBankAccount: (accountId: number) =>
    request<{ status: string }>(`/banks/unlink/${accountId}`, { method: "POST" }),
  syncBankAccounts: (payload?: { account_id?: number | null; date_from?: string | null; date_to?: string | null }) =>
    request<{
      status: string;
      synced: number;
      created: number;
      updated?: number;
      error_count?: number;
      message?: string;
      accounts?: Array<Record<string, unknown>>;
    }>(
      "/banks/sync",
      { method: "POST", body: JSON.stringify(payload ?? {}) },
    ),
  getBankSyncStatus: () =>
    request<{
      linked_count: number;
      stale_count: number;
      error_count: number;
      accounts: Array<{
        id: number;
        alias_real: string;
        last_sync_at?: string | null;
        last_sync_error?: string | null;
        stale: boolean;
      }>;
      requisitions_needing_reauth: Array<Record<string, unknown>>;
      gocardless_configured: boolean;
    }>("/banks/sync-status"),
  getBankPayrollHints: () =>
    request<{ hints: Array<Record<string, unknown>> }>("/banks/payroll-hints"),
  detectInternalTransfers: (days = 30) =>
    request<{ pairs_detected: number }>(`/banks/detect-internal-transfers?days=${days}`, { method: "POST", body: "{}" }),
  learnCategoryRule: (pattern: string, category: string) =>
    request<{ status: string; pattern: string; category: string }>("/banks/learn-category-rule", {
      method: "POST",
      body: JSON.stringify({ pattern, category }),
    }),
  learnMerchantName: (pattern: string, name: string) =>
    request<{ status: string; pattern: string; name: string }>("/banks/learn-merchant-name", {
      method: "POST",
      body: JSON.stringify({ pattern, name }),
    }),
  smartCleanExpenses: (mes?: number, anio?: number) =>
    request<{
      status: string;
      mes: number;
      anio: number;
      categorized: number;
      renamed: number;
      scanned: number;
    }>("/banks/smart-clean-expenses", {
      method: "POST",
      body: JSON.stringify({ mes: mes ?? null, anio: anio ?? null }),
    }),
  markTransactionInternal: (id: number, otherTransactionId?: number) =>
    request<{ status: string; transfer_pair_id: number }>(`/transactions/${id}/mark-internal`, {
      method: "POST",
      body: JSON.stringify({ other_transaction_id: otherTransactionId ?? null }),
    }),
  unmarkTransactionInternal: (id: number) =>
    request<{ status: string }>(`/transactions/${id}/unmark-internal`, { method: "POST", body: "{}" }),
  excludeTransactionFromBudget: (id: number) =>
    request<{ status: string }>(`/transactions/${id}/exclude-from-budget`, { method: "POST", body: "{}" }),
  includeTransactionInBudget: (id: number) =>
    request<{ status: string }>(`/transactions/${id}/include-in-budget`, { method: "POST", body: "{}" }),

  getTransactions: () => request<Transaction[]>("/transactions/"),
  createTransaction: (payload: TransactionCreate) =>
    request<Transaction>("/transactions/", { method: "POST", body: JSON.stringify(payload) }),
  updateTransaction: (id: number, payload: TransactionCreate) =>
    request<Transaction>(`/transactions/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  putTransactionSplits: (
    id: number,
    splits: Array<{ person_name: string; amount: number; is_me: boolean; settled?: boolean }>,
  ) =>
    request<Array<{ id: number; transaction_id: number; person_name: string; amount: number; is_me: boolean; settled: boolean }>>(
      `/transactions/${id}/splits`,
      { method: "PUT", body: JSON.stringify({ splits }) },
    ),
  getSplitBalances: () =>
    request<{ by_person: Array<{ person_name: string; amount: number }>; total: number }>(
      "/transactions/split-balances",
    ),
  deleteTransaction: (id: number) =>
    request<{ status: string }>(`/transactions/${id}`, { method: "DELETE" }),
  patchTransactionCategory: (tx: Pick<Transaction, "id" | "account_id" | "amount" | "description_raw" | "date">, category: string) =>
    request<{ id: number }>(`/transactions/${tx.id}`, {
      method: "PUT",
      body: JSON.stringify({ account_id: tx.account_id ?? null, amount: tx.amount, category_anon: category, description_raw: tx.description_raw || "", date: tx.date }),
    }),

  getGoals: () => request<Goal[]>("/goals/"),
  createGoal: (payload: GoalCreate) =>
    request<Goal>("/goals/", { method: "POST", body: JSON.stringify(payload) }),
  updateGoal: (id: number, payload: GoalCreate) =>
    request<Goal>(`/goals/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteGoal: (id: number) => request<{ status: string }>(`/goals/${id}`, { method: "DELETE" }),

  getWishlist: () => request<WishlistItem[]>("/wishlist/"),
  createWishlistItem: (payload: WishlistItemCreate) =>
    request<WishlistItem>("/wishlist/", { method: "POST", body: JSON.stringify(payload) }),
  updateWishlistItem: (id: number, payload: WishlistItemCreate) =>
    request<WishlistItem>(`/wishlist/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteWishlistItem: (id: number) => request<{ status: string }>(`/wishlist/${id}`, { method: "DELETE" }),
  promoteWishlistItem: (id: number, mes: number, anio: number) =>
    request<{ status: string; recurring_entry_id: number; wishlist_item_id: number }>(
      `/wishlist/${id}/promote?mes=${mes}&anio=${anio}`,
      { method: "POST" },
    ),
  purchaseWishlistItem: (
    id: number,
    payload: { monto_real: number; account_id: number; fecha?: string },
  ) =>
    request<WishlistItem>(`/wishlist/${id}/purchase`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getDebts: () => request<Debt[]>("/debts/"),
  createDebt: (payload: DebtCreate) => request<Debt>("/debts/", { method: "POST", body: JSON.stringify(payload) }),
  updateDebt: (id: number, payload: DebtCreate) =>
    request<Debt>(`/debts/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteDebt: (id: number) => request<{ status: string }>(`/debts/${id}`, { method: "DELETE" }),

  getDebtPayments: (debtId: number) => request<import("../types").DebtPayment[]>(`/debts/${debtId}/payments`),
  createDebtPayment: (debtId: number, payload: import("../types").DebtPaymentCreate) =>
    request<import("../types").DebtPayment>(`/debts/${debtId}/payments`, { method: "POST", body: JSON.stringify(payload) }),
  deleteDebtPayment: (debtId: number, payId: number) =>
    request<{ status: string }>(`/debts/${debtId}/payments/${payId}`, { method: "DELETE" }),

  getAllDebtInstallments: () => request<import("../types").DebtInstallment[]>("/debts/installments"),
  getDebtInstallments: (debtId: number) =>
    request<import("../types").DebtInstallment[]>(`/debts/${debtId}/installments`),
  createDebtInstallment: (debtId: number, payload: import("../types").DebtInstallmentCreate) =>
    request<import("../types").DebtInstallment>(`/debts/${debtId}/installments`, { method: "POST", body: JSON.stringify(payload) }),
  replaceDebtInstallments: (debtId: number, installments: import("../types").DebtInstallmentCreate[]) =>
    request<import("../types").DebtInstallment[]>(`/debts/${debtId}/installments/bulk`, {
      method: "PUT",
      body: JSON.stringify({ installments }),
    }),
  updateDebtInstallment: (debtId: number, instId: number, payload: import("../types").DebtInstallmentCreate) =>
    request<import("../types").DebtInstallment>(`/debts/${debtId}/installments/${instId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteDebtInstallment: (debtId: number, instId: number) =>
    request<{ status: string }>(`/debts/${debtId}/installments/${instId}`, { method: "DELETE" }),

  getProperties: () => request<Property[]>("/properties/"),
  createProperty: (payload: PropertyCreate) =>
    request<Property>("/properties/", { method: "POST", body: JSON.stringify(payload) }),
  updateProperty: (id: number, payload: PropertyCreate) =>
    request<Property>(`/properties/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteProperty: (id: number) => request<{ status: string }>(`/properties/${id}`, { method: "DELETE" }),
  vehicleValuation: (id: number) =>
    request<{
      valor_estimado: number;
      muestras: number;
      min: number;
      max: number;
      mediana: number;
      asking_p10: number;
      asking_p25: number;
      asking_p50: number;
      asking_ref: number;
      haircut: number;
      valor_mercado_realizable: number;
      fuente: string;
      percentil_usado: number;
      confianza: string;
      precios_muestra?: number[];
      filtro_año?: string;
      filtro_km?: number | null;
      precio_cap?: number;
      actualizado_en?: string;
      match_mode?: string;
      clamped?: boolean;
      clamp_techo?: number | null;
      nota?: string;
    }>(`/properties/vehicle-valuation/${id}`, { method: "POST" }),
  refreshDueVehicleValuations: () =>
    request<{
      refreshed: Array<{
        id: number;
        nombre: string;
        valor_estimado: number;
        confianza: string;
      }>;
      skipped: number;
      errors: Array<{ id: number; detail: string }>;
      interval_days: number;
    }>("/properties/vehicle-valuation/refresh-due", { method: "POST" }),
  importIngPdf: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${API_BASE_URL}/import/ing-pdf/`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(parseApiError(body, "No se pudo importar el PDF de ING"));
    }
    return response.json() as Promise<{ accounts: Array<{ alias_anonimo: string; alias_real: string; balance: number }> }>;
  },

  importMyInvestorPdf: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${API_BASE_URL}/import/myinvestor-pdf/`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(parseApiError(body, "No se pudo importar el PDF de MyInvestor"));
    }
    return response.json() as Promise<{
      cuenta: string;
      efectivo: number;
      positions: Array<{ isin: string; nombre: string; valor_actual: number; monto_invertido: number; tipo: string }>;
      debt: { acreedor: string; cuenta_prestamo: string; monto_total: number; monto_pagado: number; pendiente: number; tasa_anual: number; fecha_vencimiento: string; tipo: string; notas: string } | null;
    }>;
  },

  applyMyInvestorPdf: async (file: File, cartera = "MyInvestor") => {
    const form = new FormData();
    form.append("file", file);
    form.append("cartera", cartera);
    const response = await fetch(`${API_BASE_URL}/import/myinvestor-pdf/apply`, {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(parseApiError(body, "No se pudo importar el PDF de MyInvestor"));
    }
    return response.json() as Promise<{
      status: string;
      cartera: string;
      created: number;
      updated: number;
      positions_total: number;
      debt_created: boolean;
    }>;
  },

  getInvestments: () => request<Investment[]>("/investments/"),
  createInvestment: (payload: InvestmentCreate) =>
    request<Investment>("/investments/", { method: "POST", body: JSON.stringify(payload) }),
  updateInvestment: (id: number, payload: InvestmentCreate) =>
    request<Investment>(`/investments/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteInvestment: (id: number) => request<{ status: string }>(`/investments/${id}`, { method: "DELETE" }),

  getWorkHistory: () => request<WorkHistory[]>("/work-history/"),
  createWorkHistory: (payload: WorkHistoryCreate) =>
    request<WorkHistory>("/work-history/", { method: "POST", body: JSON.stringify(payload) }),
  updateWorkHistory: (id: number, payload: WorkHistoryCreate) =>
    request<WorkHistory>(`/work-history/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteWorkHistory: (id: number) =>
    request<{ status: string }>(`/work-history/${id}`, { method: "DELETE" }),

  getCards: () => request<Card[]>("/cards/"),
  createCard: (payload: CardCreate) => request<Card>("/cards/", { method: "POST", body: JSON.stringify(payload) }),
  updateCard: (id: number, payload: CardCreate) =>
    request<Card>(`/cards/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteCard: (id: number) => request<{ status: string }>(`/cards/${id}`, { method: "DELETE" }),

  getMoneyOwed: () => request<MoneyOwed[]>("/money-owed/"),
  createMoneyOwed: (payload: MoneyOwedCreate) =>
    request<MoneyOwed>("/money-owed/", { method: "POST", body: JSON.stringify(payload) }),
  updateMoneyOwed: (id: number, payload: MoneyOwedCreate) =>
    request<MoneyOwed>(`/money-owed/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteMoneyOwed: (id: number) =>
    request<{ status: string }>(`/money-owed/${id}`, { method: "DELETE" }),

  getRecurringEntries: () => request<RecurringEntry[]>("/recurring-entries/"),
  createRecurringEntry: (payload: RecurringEntryCreate) =>
    request<RecurringEntry>("/recurring-entries/", { method: "POST", body: JSON.stringify(payload) }),
  updateRecurringEntry: (id: number, payload: RecurringEntryCreate) =>
    request<RecurringEntry>(`/recurring-entries/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteRecurringEntry: (id: number) =>
    request<{ status: string }>(`/recurring-entries/${id}`, { method: "DELETE" }),
  materializeRecurring: (mes: number, anio: number) =>
    request<{ created: string[]; skipped: string[]; total_created: number }>(
      `/recurring-entries/materialize?mes=${mes}&anio=${anio}`,
      { method: "POST" }
    ),
  getFondoBalances: () => request<Array<{ id: number; nombre: string; balance: number; source: string }>>("/recurring-entries/fondos/balances"),

  getMonthlyBudget: (mes: number, anio: number) => request<MonthlyBudget[]>(`/monthly-budget/${mes}/${anio}`),
  upsertMonthlyBudget: (payload: Omit<MonthlyBudget, "id">) =>
    request<MonthlyBudget>("/monthly-budget/", { method: "POST", body: JSON.stringify(payload) }),
  copyMonthlyBudget: (fromMes: number, fromAnio: number, toMes: number, toAnio: number) =>
    request<{ copied: number; total: number }>("/monthly-budget/copy", {
      method: "POST",
      body: JSON.stringify({ from_mes: fromMes, from_anio: fromAnio, to_mes: toMes, to_anio: toAnio }),
    }),
  getPayrollAccountConfig: (empresa: string) =>
    request<import("../utils/payrollAccount").PayrollAccountConfig>(
      `/payroll/account-config?empresa=${encodeURIComponent(empresa)}`,
    ),
  setPayrollAccountConfig: (payload: { empresa: string; account_id: number; archive_previous_account?: boolean }) =>
    request<import("../utils/payrollAccount").PayrollAccountConfig>("/payroll/account-config", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getSalaryBreakdown: (mes: number, anio: number) => request<SalaryBreakdown[]>(`/salary-breakdown/${mes}/${anio}`),
  getSalaryBreakdownYear: (anio: number) => request<SalaryBreakdown[]>(`/salary-breakdown/year/${anio}`),
  upsertSalaryBreakdown: (payload: SalaryBreakdownCreate) =>
    request<SalaryBreakdown>("/salary-breakdown/", { method: "POST", body: JSON.stringify(payload) }),

  getPayrollEstimate: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>("/payroll/estimate", { method: "POST", body: JSON.stringify(payload) }),
  getIrpfRetencionModelo145: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>("/payroll/retencion-modelo145", { method: "POST", body: JSON.stringify(payload) }),
  getSalaryReconcile: (mes: number, anio: number, empresa: string) =>
    request<Record<string, unknown>>(
      `/salary/reconcile?mes=${mes}&anio=${anio}&empresa=${encodeURIComponent(empresa)}`
    ),
  markSalaryReconcile: (payload: { mes: number; anio: number; empresa: string; transaction_id: number }) =>
    request<Record<string, unknown>>("/salary/reconcile/mark", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  getAlerts: () => request<AlertItem[]>("/api/alertas"),
  getSankey: (mes: number, anio: number) => request<SankeyData>(`/api/sankey/${mes}/${anio}`),
  getPatrimonioEvolucion: (anio: number) =>
    request<Array<{ fecha: string; acumulado: number }>>(`/api/patrimonio/evolucion/${anio}`),
  getCalendarPagos: (mes: number, anio: number) => request<CalendarEvent[]>(`/api/calendario/pagos/${mes}/${anio}`),
  getCalendarPagosYear: (anio: number) => request<CalendarEvent[]>(`/api/calendario/pagos/anio/${anio}`),
  getCalendarFeedUrl: (params: URLSearchParams) =>
    request<{ url: string; webcal_url: string }>(`/calendar/feed-url?${params.toString()}`),

  getKrakenBalance: () => request<{ balances: Array<{ asset: string; amount: number; eur_value: number | null; eur_price: number | null; type: string }> }>("/kraken/balance"),
  syncKraken: () => request<Record<string, unknown>>("/kraken/sync", { method: "POST" }),
  getSyncStatus: () =>
    request<{
      enabled: boolean;
      google_configured?: boolean;
      google_connected?: boolean;
      custom_server_configured?: boolean;
      custom_url?: string;
      // Only present when connected to a private server with the proxy-with-offline-
      // cache design (dev/lib/native-sync/backend/sync_proxy_middleware.py) — reflects
      // the cached reachability flag and the local write queue awaiting replay.
      custom_server_reachable?: boolean;
      pending_ops?: number;
    }>("/sync/status"),
  startGoogleDeviceAuth: () =>
    request<{ status: string; verification_url?: string; user_code?: string; expires_in?: number }>(
      "/sync/google/device/start",
      { method: "POST" },
    ),
  completeGoogleDeviceAuth: () =>
    request<{ status: string; provider?: string }>("/sync/google/device/complete", { method: "POST" }),
  syncGooglePush: () => request<Record<string, unknown>>("/sync/google/push", { method: "POST" }),
  syncGooglePull: () => request<Record<string, unknown>>("/sync/google/pull", { method: "POST" }),
  syncCustomPush: () => request<Record<string, unknown>>("/sync/custom/push", { method: "POST" }),
  syncCustomPull: () => request<Record<string, unknown>>("/sync/custom/pull", { method: "POST" }),

  exportCsv: async (table: string) => {
    const response = await fetch(`${API_BASE_URL}/export-csv/${table}`);
    if (!response.ok) {
      throw new Error(`No se pudo exportar ${table}`);
    }
    return response.blob();
  },
  exportCsvBundle: async () => {
    const response = await fetch(`${API_BASE_URL}/export-csv/bundle`);
    if (!response.ok) {
      throw new Error("No se pudo exportar el paquete CSV");
    }
    return response.blob();
  },
  importCsv: async (table: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${API_BASE_URL}/import-csv/${table}`, {
      method: "POST",
      body: formData
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(parseApiError(body, `No se pudo importar ${table}`));
    }
    return response.json() as Promise<{ status: string }>;
  }
};
