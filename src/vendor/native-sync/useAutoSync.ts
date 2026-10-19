/* GENERADO desde dev/lib/native-sync (Homelab): no lo edites aquí, edita la librería y ejecuta su sync.mjs */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SyncApiClient, SyncAutoResult } from "./useSyncPanel";

type Options = {
  api: SyncApiClient;
  /** Solo en el cliente nativo con Google Drive como proveedor y el auto-sync activado. */
  enabled: boolean;
  intervalMinutes?: number;
  /** Tras bajar datos de Drive: la app recarga lo que tenga en memoria. */
  onPulled?: () => void | Promise<void>;
};

export type SyncConflict = { remote_modified: string; last_sync_at: string };

const MIN_GAP_MS = 10_000;

/**
 * Sync automático con Google Drive: al abrir, al volver a primer plano, al irse a segundo
 * plano (lo último que hace el SO antes de poder matar la app en el móvil) y cada N minutos.
 * El backend (/sync/auto) decide si subir, bajar o nada; si cambiaron este dispositivo y
 * Drive a la vez devuelve conflicto y aquí se expone para que la app muestre
 * SyncConflictDialog. Monta este hook una sola vez, en la raíz de la app.
 */
export function useAutoSync({ api, enabled, intervalMinutes = 15, onPulled }: Options) {
  const [conflict, setConflict] = useState<SyncConflict | null>(null);
  const [resolving, setResolving] = useState(false);
  const lastRun = useRef(0);
  const onPulledRef = useRef(onPulled);
  onPulledRef.current = onPulled;

  const handle = useCallback(async (result: SyncAutoResult) => {
    if (result.status === "conflict") {
      setConflict({ remote_modified: result.remote_modified, last_sync_at: result.last_sync_at });
    } else if (result.status === "ok" && result.action === "pulled") {
      setConflict(null);
      await onPulledRef.current?.();
    } else if (result.status === "ok") {
      setConflict(null);
    }
  }, []);

  const run = useCallback(async () => {
    const now = Date.now();
    if (now - lastRun.current < MIN_GAP_MS) return;
    lastRun.current = now;
    try {
      await handle(await api.syncAuto());
    } catch {
      // Silencioso a propósito: sin red o con el backend embebido aún arrancando no hay nada
      // que el usuario pueda hacer; se reintenta en el siguiente disparo.
    }
  }, [api, handle]);

  useEffect(() => {
    if (!enabled) return;
    void run();
    const minutes = Number.isFinite(intervalMinutes) ? Math.max(2, intervalMinutes) : 15;
    const timer = window.setInterval(() => void run(), minutes * 60_000);
    const onVisibility = () => void run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMinutes, run]);

  async function resolve(keep: "local" | "remote") {
    setResolving(true);
    try {
      await handle(await api.syncResolve(keep));
    } finally {
      setResolving(false);
    }
  }

  return { conflict, resolving, resolve, syncNow: run };
}
