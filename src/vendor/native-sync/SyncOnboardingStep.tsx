/* GENERADO desde dev/lib/native-sync (Homelab): no lo edites aquí, edita la librería y ejecuta su sync.mjs */
import { useState } from "react";
import { useSyncPanel, type SyncApiClient } from "./useSyncPanel";

type Props = {
  api: SyncApiClient;
  nativeSyncMode?: boolean;
  /** Persists one setting immediately — needed before a pull, since the backend reads
   * sync_custom_url/sync_google_refresh_token from its own settings store, not from the
   * pull request itself. Reuses whatever setting-persistence the host app already has. */
  saveSetting: (key: string, value: string) => Promise<void>;
  /** User skipped, or reached the end without completing a connection — stays local-only. */
  onSkip: () => void;
  /** User connected (and, best-effort, pulled existing data) — settings to fold into the
   * wizard's final patch. skipDefaults tells the wizard not to overwrite whatever just
   * came down from the pull with its own local placeholder defaults. */
  onDone: (patch: Record<string, string>, opts?: { skipDefaults?: boolean }) => void;
  onBack: () => void;
};

const rowStyle = { display: "flex", gap: "0.5rem", flexWrap: "wrap" as const };
const stackStyle = { display: "flex", flexDirection: "column" as const, gap: "0.6rem", marginTop: "0.75rem" };
const fieldStyle = { display: "flex", flexDirection: "column" as const, gap: "0.35rem", marginTop: "0.75rem" };

/**
 * Onboarding step offering: connect a personal cloud (Google Drive to start), connect a
 * private server (just a URL — same trust model as the app's own Ollama connection field,
 * no token prompt), or skip and stay local-only. Connecting immediately attempts a
 * best-effort pull, so someone setting up a new device against an account/server that
 * already has data gets it right away instead of having to fill in placeholder data first
 * and reconcile later. Self-contained (only depends on react + the injected api), so any
 * client/server app can drop it into its own onboarding wizard as a conditional step gated
 * on the same "client mode, not Docker" flag it already uses elsewhere.
 */
export function SyncOnboardingStep({ api, nativeSyncMode, saveSetting, onSkip, onDone, onBack }: Props) {
  const { syncStatus, syncLoading, googleDeviceCode, startGoogleConnect, completeGoogleConnect, pull } =
    useSyncPanel({ api, nativeSyncMode });
  const [choice, setChoice] = useState<"cloud" | "server" | null>(null);
  const [cloudProvider, setCloudProvider] = useState("google_drive");
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleInfo, setGoogleInfo] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  if (!nativeSyncMode) return null;

  function finishCloud() {
    if (googleConnected && cloudProvider === "google_drive") {
      onDone(
        { sync_provider: "google_drive", sync_auto_enabled: "1", sync_auto_minutes: "15" },
        { skipDefaults: true },
      );
    } else {
      onSkip();
    }
  }

  async function finishServer() {
    const url = customUrl.trim();
    if (!url) {
      onSkip();
      return;
    }
    setServerLoading(true);
    setServerError(null);
    try {
      // saveSetting hits the LOCAL embedded backend (never the remote server this URL
      // points at — see _DEVICE_LOCAL_SETTINGS_KEYS), which can still be finishing its own
      // startup (native asset extraction + Alembic migrations) when the user reaches this
      // step — unlike the rest of the app (useSoberanData's indefinite background retry),
      // a failure here used to strand the user on a dead "No se pudo conectar" message with
      // no way forward except clicking Empezar again by hand. Retries the same short burst
      // pattern instead of surfacing the error on the first hiccup.
      const SAVE_ATTEMPTS = 5;
      const SAVE_RETRY_DELAY_MS = 1500;
      let lastErr: unknown;
      let saved = false;
      for (let attempt = 1; attempt <= SAVE_ATTEMPTS && !saved; attempt++) {
        try {
          await saveSetting("sync_custom_url", url);
          saved = true;
        } catch (err) {
          lastErr = err;
          if (attempt < SAVE_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, SAVE_RETRY_DELAY_MS));
        }
      }
      if (!saved) throw lastErr;
      // No backup-bundle pull here — that's the old push/pull-a-whole-zip mechanism,
      // removed from the UI (SyncSettingsCard) since it's superseded by the live proxy:
      // every read already goes straight to the server once sync_provider is set below,
      // which onComplete's own loadAll() (App.tsx) triggers immediately after this
      // returns — that's what actually shows real data right away, not a pull() here.
      onDone(
        { sync_provider: "custom_server", sync_custom_url: url, sync_auto_enabled: "1", sync_auto_minutes: "15" },
        { skipDefaults: true },
      );
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "No se pudo conectar con el servidor.");
    } finally {
      setServerLoading(false);
    }
  }

  if (choice === null) {
    return (
      <div style={stackStyle}>
        <button type="button" onClick={() => setChoice("cloud")}>Conectar nube</button>
        {syncStatus?.custom_server_supported && (
          <button type="button" className="button-secondary" onClick={() => setChoice("server")}>
            Conectar a servidor privado
          </button>
        )}
        <button type="button" className="button-secondary" onClick={onSkip}>Saltar por ahora</button>
        <button type="button" className="button-secondary" onClick={onBack}>Atrás</button>
      </div>
    );
  }

  if (choice === "cloud") {
    return (
      <div style={stackStyle}>
        <label style={fieldStyle}>
          Proveedor
          <select value={cloudProvider} onChange={(e) => setCloudProvider(e.target.value)}>
            <option value="google_drive">Google Drive</option>
          </select>
        </label>
        <div style={rowStyle}>
          <button
            type="button"
            className="button-secondary"
            disabled={syncLoading || !syncStatus?.google_configured}
            onClick={() => void (async () => {
              setGoogleError(null);
              try {
                await startGoogleConnect();
                setGoogleInfo("Abre el enlace y escribe el código en tu navegador.");
              } catch (err) {
                setGoogleError(err instanceof Error ? err.message : "No se pudo iniciar Google Drive.");
              }
            })()}
          >
            Conectar Google Drive
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={syncLoading || !googleDeviceCode}
            onClick={() => void (async () => {
              setGoogleError(null);
              try {
                const status = await completeGoogleConnect();
                if (status === "pending") {
                  setGoogleInfo("Aún pendiente: confirma en Google y vuelve a pulsar.");
                  return;
                }
                setGoogleInfo(null);
                setGoogleConnected(true);
                try {
                  await pull("google_drive");
                } catch {
                  // No existing backup yet, or a transient hiccup — still connected fine.
                }
              } catch (err) {
                setGoogleError(err instanceof Error ? err.message : "No se pudo completar el login.");
              }
            })()}
          >
            Ya autoricé en Google
          </button>
        </div>
        {!syncStatus?.google_configured && (
          <p className="muted" style={{ fontSize: "0.78rem" }}>
            Google Drive todavía no está configurado en esta app — de momento usa un servidor privado, o sáltate
            este paso y conéctalo más tarde en Configuración.
          </p>
        )}
        {googleDeviceCode?.user_code && (
          <p className="muted" style={{ fontSize: "0.78rem" }}>
            Código: <code>{googleDeviceCode.user_code}</code>
            {googleDeviceCode.verification_url ? <> en <code>{googleDeviceCode.verification_url}</code></> : null}
          </p>
        )}
        {googleConnected && <p style={{ fontSize: "0.85rem", color: "var(--status-ok)" }}>Conectado.</p>}
        {googleInfo && <p className="muted" style={{ fontSize: "0.78rem" }}>{googleInfo}</p>}
        {googleError && <p style={{ fontSize: "0.78rem", color: "var(--status-crit)" }}>{googleError}</p>}
        <div style={rowStyle}>
          <button type="button" className="button-secondary" onClick={() => setChoice(null)}>Volver</button>
          <button type="button" onClick={finishCloud}>Empezar</button>
        </div>
      </div>
    );
  }

  return (
    <div style={stackStyle}>
      <label style={fieldStyle}>
        URL de tu servidor
        <input
          type="text"
          inputMode="url"
          value={customUrl}
          placeholder="https://sync.tudominio.com"
          onChange={(e) => setCustomUrl(e.target.value)}
        />
      </label>
      <p className="muted" style={{ fontSize: "0.78rem" }}>
        Es tu propia instancia Docker, sin token ni cuenta. Si necesitas restringir el acceso, hazlo con tu propio
        proxy/VPN, no aquí.
      </p>
      {serverError && <p style={{ fontSize: "0.78rem", color: "var(--status-crit)" }}>{serverError}</p>}
      <div style={rowStyle}>
        <button type="button" className="button-secondary" onClick={() => setChoice(null)}>Volver</button>
        <button type="button" disabled={serverLoading} onClick={() => void finishServer()}>
          {serverLoading ? "Conectando…" : "Empezar"}
        </button>
      </div>
    </div>
  );
}
