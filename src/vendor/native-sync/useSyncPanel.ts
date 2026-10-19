/* GENERADO desde dev/lib/native-sync (Homelab): no lo edites aquí, edita la librería y ejecuta su sync.mjs */
import { useCallback, useEffect, useState } from "react";

export type SyncProvider = "google_drive" | "custom_server";

export type SyncStatus = {
  enabled: boolean;
  google_configured?: boolean;
  google_connected?: boolean;
  custom_server_configured?: boolean;
  custom_url?: string;
  // Only present with the proxy-with-offline-cache design (a connected private
  // server, see dev/lib/native-sync/backend/sync_proxy_middleware.py): the cached
  // reachability flag and how many local writes are queued waiting to replay.
  custom_server_reachable?: boolean;
  pending_ops?: number;
  /** false si la app no lleva el proxy en vivo (sync_proxy_middleware): entonces la UI no
   * ofrece "servidor propio", que en esas apps no sincronizaría nada. */
  custom_server_supported?: boolean;
  /** ISO de la última sync con Google Drive que dejó ambos lados iguales ("" = nunca). */
  last_sync_at?: string;
};

/** Respuesta de /sync/auto y /sync/resolve. "conflict" = cambiaron este dispositivo y Drive
 * desde la última sync: no se ha tocado nada, el usuario elige con syncResolve. */
export type SyncAutoResult =
  | { status: "ok"; action: "none" | "pushed" | "pulled" }
  | { status: "disabled" | "not_connected" | "busy" }
  | { status: "conflict"; remote_modified: string; last_sync_at: string };

/**
 * Minimal REST contract a client/server app's own api.ts must expose to plug into
 * the shared sync UI (SyncSettingsCard / SyncOnboardingStep). Matches the fixed
 * /sync/* endpoints served by dev/lib/native-sync/backend/native_sync_router.py —
 * any app whose api.ts implements these methods against that same contract can
 * pass its `api` object straight through, no adapter needed — or build it with
 * createSyncApiClient below and implement nothing.
 */
export interface SyncApiClient {
  getSyncStatus: () => Promise<SyncStatus>;
  startGoogleDeviceAuth: () => Promise<{ status: string; verification_url?: string; user_code?: string; expires_in?: number }>;
  completeGoogleDeviceAuth: () => Promise<{ status: string; provider?: string }>;
  syncGooglePush: () => Promise<unknown>;
  syncGooglePull: () => Promise<unknown>;
  syncCustomPush: () => Promise<unknown>;
  syncCustomPull: () => Promise<unknown>;
  syncAuto: () => Promise<SyncAutoResult>;
  syncResolve: (keep: "local" | "remote") => Promise<SyncAutoResult>;
}

/**
 * Implementación completa de SyncApiClient sobre el fetch de la app (que sabe su base URL:
 * "/api" en web, 127.0.0.1:<puerto> en nativo…). Así ninguna app reescribe el contrato
 * /sync/* ni el caso especial del 409 de conflicto, que un request() genérico convertiría
 * en un Error sin el detalle.
 */
export function createSyncApiClient(send: (path: string, init?: RequestInit) => Promise<Response>): SyncApiClient {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    let resp: Response;
    try {
      resp = await send(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    } catch {
      throw new Error("Sin conexión con la app. Reintentando…");
    }
    const body = await resp.json().catch(() => ({}));
    if (resp.status === 409 && body?.detail?.conflict) {
      return { status: "conflict", remote_modified: body.detail.remote_modified, last_sync_at: body.detail.last_sync_at } as T;
    }
    if (!resp.ok) {
      throw new Error(typeof body?.detail === "string" ? body.detail : `Error ${resp.status} al sincronizar`);
    }
    return body as T;
  }
  const post = <T,>(path: string, body?: unknown) =>
    call<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    getSyncStatus: () => call<SyncStatus>("/sync/status"),
    startGoogleDeviceAuth: () => post("/sync/google/device/start"),
    completeGoogleDeviceAuth: () => post("/sync/google/device/complete"),
    syncGooglePush: () => post("/sync/google/push"),
    syncGooglePull: () => post("/sync/google/pull"),
    syncCustomPush: () => post("/sync/custom/push"),
    syncCustomPull: () => post("/sync/custom/pull"),
    syncAuto: () => post<SyncAutoResult>("/sync/auto"),
    syncResolve: (keep) => post<SyncAutoResult>("/sync/resolve", { keep }),
  };
}

type Options = {
  api: SyncApiClient;
  nativeSyncMode?: boolean;
};

/**
 * State + API-calling logic shared by SyncSettingsCard and SyncOnboardingStep.
 * Deliberately has no opinion on how errors/toasts are surfaced — callers wrap
 * these calls in their own try/catch and show feedback in whatever way fits
 * their UI (toasts in Settings, inline muted text in onboarding).
 */
export function useSyncPanel({ api, nativeSyncMode }: Options) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [googleDeviceCode, setGoogleDeviceCode] = useState<{ verification_url?: string; user_code?: string } | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setSyncStatus(await api.getSyncStatus());
    } catch {
      setSyncStatus({ enabled: false });
    }
  }, [api]);

  useEffect(() => {
    if (nativeSyncMode) void refreshStatus();
  }, [nativeSyncMode, refreshStatus]);

  // Only relevant when connected to a private server in live-proxy mode — refresh
  // the reachability/pending-ops fields periodically so the offline indicator (see
  // SyncSettingsCard) doesn't go stale while the panel stays open.
  useEffect(() => {
    if (!nativeSyncMode || syncStatus?.custom_server_reachable === undefined) return;
    const timer = window.setInterval(() => void refreshStatus(), 15_000);
    return () => window.clearInterval(timer);
  }, [nativeSyncMode, syncStatus?.custom_server_reachable, refreshStatus]);

  async function startGoogleConnect() {
    setSyncLoading(true);
    try {
      const start = await api.startGoogleDeviceAuth();
      const code = { verification_url: start.verification_url, user_code: start.user_code };
      setGoogleDeviceCode(code);
      return code;
    } finally {
      setSyncLoading(false);
    }
  }

  async function completeGoogleConnect(): Promise<"connected" | "pending"> {
    setSyncLoading(true);
    try {
      const result = await api.completeGoogleDeviceAuth();
      if (result.status === "pending") return "pending";
      setGoogleDeviceCode(null);
      await refreshStatus();
      return "connected";
    } finally {
      setSyncLoading(false);
    }
  }

  async function push(provider: SyncProvider) {
    setSyncLoading(true);
    try {
      await (provider === "google_drive" ? api.syncGooglePush() : api.syncCustomPush());
    } finally {
      setSyncLoading(false);
    }
  }

  async function pull(provider: SyncProvider) {
    setSyncLoading(true);
    try {
      await (provider === "google_drive" ? api.syncGooglePull() : api.syncCustomPull());
    } finally {
      setSyncLoading(false);
    }
  }

  return { syncStatus, syncLoading, googleDeviceCode, refreshStatus, startGoogleConnect, completeGoogleConnect, push, pull };
}
