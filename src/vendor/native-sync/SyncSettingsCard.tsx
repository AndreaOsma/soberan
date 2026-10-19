/* GENERADO desde dev/lib/native-sync (Homelab): no lo edites aquí, edita la librería y ejecuta su sync.mjs */
import { useEffect, useState } from "react";
import { useSyncPanel, type SyncApiClient } from "./useSyncPanel";

type Props = {
  api: SyncApiClient;
  settings: Record<string, string>;
  saveSetting: (key: string, val: string, notify?: boolean) => Promise<void>;
  nativeSyncMode?: boolean;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  /** Called after a successful pull, so the app can reload data from its now-updated local storage. */
  onDataPulled?: () => void | Promise<void>;
};

/**
 * "Sincronización" settings card: Google Drive (OAuth device-code) + private server
 * push/pull. Self-contained — only depends on `react` and the injected `api`, so any
 * client/server app can drop it into its own Settings screen unmodified.
 */
export function SyncSettingsCard({ api, settings, saveSetting, nativeSyncMode, addToast, onDataPulled }: Props) {
  const { syncStatus, syncLoading, googleDeviceCode, startGoogleConnect, completeGoogleConnect, push, pull } =
    useSyncPanel({ api, nativeSyncMode });
  const saveQuiet = (key: string, val: string) => saveSetting(key, val, false);

  const [urlDraft, setUrlDraft] = useState(settings.sync_custom_url || "");
  useEffect(() => setUrlDraft(settings.sync_custom_url || ""), [settings.sync_custom_url]);

  if (!nativeSyncMode || !syncStatus?.enabled) return null;

  const customServerSupported = Boolean(syncStatus.custom_server_supported);
  const syncProvider = customServerSupported ? settings.sync_provider || "google_drive" : "google_drive";
  const syncAutoEnabled = settings.sync_auto_enabled === "1";
  const syncAutoMinutes = settings.sync_auto_minutes || "15";

  async function runTask(task: () => Promise<void>, okMsg: string, errMsg: string) {
    try {
      await task();
      addToast(okMsg, "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : errMsg, "error");
    }
  }

  return (
    <article className="card">
      <h2>Sincronización</h2>
      <p className="muted" style={{ fontSize: "0.82rem", marginTop: 0 }}>
        {customServerSupported
          ? "Sin necesidad de montar Docker: conecta Google Drive o tu servidor propio."
          : "Sin servidor: tus datos se guardan en tu propio Google Drive, en una carpeta privada de la app."}
      </p>
      {customServerSupported && (
      <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.5rem" }}>
        Proveedor por defecto
        <select
          value={syncProvider}
          onChange={(e) => void saveSetting("sync_provider", e.target.value, true)}
        >
          <option value="google_drive">Google Drive</option>
          <option value="custom_server">Servidor propio</option>
        </select>
      </label>
      )}
      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem" }}>
        <input
          type="checkbox"
          checked={syncAutoEnabled}
          onChange={(e) => void saveSetting("sync_auto_enabled", e.target.checked ? "1" : "0", true)}
        />
        Sincronizar automáticamente
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.35rem" }}>
        Cada X minutos
        <input
          type="number"
          min={2}
          max={120}
          value={syncAutoMinutes}
          onChange={(e) => void saveSetting("sync_auto_minutes", e.target.value, false)}
        />
      </label>
      <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.35rem" }}>
        {syncProvider === "custom_server"
          ? "Con servidor propio, el sync ya es en vivo (cada acción se manda al servidor al momento) — este intervalo no aplica ahí, solo a Google Drive."
          : "Sincroniza al abrir y al cerrar la app y cada X minutos: sube o baja según dónde haya cambios, y si los hay en los dos sitios te pregunta."}
      </p>
      {syncStatus.google_connected && (
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.35rem" }}>
          Última sincronización:{" "}
          {syncStatus.last_sync_at
            ? new Date(syncStatus.last_sync_at).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })
            : "todavía ninguna"}
        </p>
      )}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
        <button
          type="button"
          className="button-secondary"
          disabled={syncLoading || !syncStatus.google_configured}
          onClick={() => void runTask(
            async () => { await startGoogleConnect(); addToast("Abre el enlace de Google y escribe el código.", "info"); },
            "", "No se pudo iniciar Google Drive.",
          )}
        >
          Conectar Google Drive
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={syncLoading || !googleDeviceCode}
          onClick={() => void (async () => {
            try {
              const status = await completeGoogleConnect();
              if (status === "pending") {
                addToast("Aún pendiente: confirma en Google y vuelve a pulsar.", "info");
              } else {
                addToast("Google Drive conectado.", "success");
              }
            } catch (err) {
              addToast(err instanceof Error ? err.message : "No se pudo completar el login.", "error");
            }
          })()}
        >
          Ya autoricé en Google
        </button>
      </div>
      {!syncStatus.google_configured && (
        <p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.35rem" }}>
          Google Drive aún no está configurado en este dispositivo (falta el client ID de la app).
        </p>
      )}
      {googleDeviceCode?.user_code && (
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>
          Código: <code>{googleDeviceCode.user_code}</code>{" "}
          {googleDeviceCode.verification_url ? (
            <>en <code>{googleDeviceCode.verification_url}</code></>
          ) : null}
        </p>
      )}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
        <button
          type="button"
          disabled={syncLoading || !syncStatus.google_connected}
          onClick={() => void runTask(async () => {
            await push("google_drive");
            await saveQuiet("sync_last_push_at", new Date().toISOString());
          }, "Backup subido a Google Drive.", "No se pudo subir a Google Drive.")}
        >
          Subir ahora (Google)
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={syncLoading || !syncStatus.google_connected}
          onClick={() => void runTask(async () => {
            await pull("google_drive");
            await saveQuiet("sync_last_pull_at", new Date().toISOString());
            await onDataPulled?.();
          }, "Datos descargados desde Google Drive.", "No se pudo bajar desde Google Drive.")}
        >
          Descargar ahora (Google)
        </button>
      </div>

      {customServerSupported && (
        <>
        <hr style={{ margin: "1rem 0", border: "none", borderTop: "1px solid var(--border-soft)" }} />
        <h3 style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>Servidor propio</h3>
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: 0 }}>
          Es tu propia instancia Docker, sin token ni cuenta. Si necesitas restringir el acceso, hazlo con tu propio
          proxy/VPN, no aquí.
        </p>
        {syncStatus.custom_server_configured && syncStatus.custom_server_reachable !== undefined && (
          <p
            className="muted"
            style={{
              fontSize: "0.78rem",
              marginTop: "0.35rem",
              color: syncStatus.custom_server_reachable ? undefined : "var(--warning, #b8860b)",
            }}
          >
            {syncStatus.custom_server_reachable
              ? "Conectado — usando el servidor en vivo."
              : `Sin conexión con el servidor — usando datos locales${
                  syncStatus.pending_ops ? ` (${syncStatus.pending_ops} cambio${syncStatus.pending_ops === 1 ? "" : "s"} pendiente${syncStatus.pending_ops === 1 ? "" : "s"} de subir)` : ""
                }.`}
          </p>
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          URL del servidor sync
          <input
            type="text"
            value={urlDraft}
            placeholder="https://sync.tudominio.com"
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={() => {
              const next = urlDraft.trim();
              if (next !== (settings.sync_custom_url || "")) void saveQuiet("sync_custom_url", next);
            }}
          />
        </label>
        </>
      )}
    </article>
  );
}
