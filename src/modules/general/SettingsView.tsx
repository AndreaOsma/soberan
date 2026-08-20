import { useEffect, useState } from "react";
import { AccentColorPicker } from "../../components/AccentColorPicker";
import { SettingSliderField, SettingTextField } from "../../components/SettingFields";
import { DataToolsView } from "../data/DataToolsView";
import { api } from "../../services/api";
import { resolveAccentFromSettings } from "../../utils/accentTheme";
import type { CsvTableId } from "../../utils/csvExport";
import { SyncSettingsCard } from "../../../../../lib/native-sync/frontend/SyncSettingsCard";

type Props = {
  settings: Record<string, string>;
  saveSetting: (key: string, val: string, notify?: boolean) => Promise<void>;
  desktopMode?: boolean;
  nativeSyncMode?: boolean;
  desktopVersion?: string | null;
  onCheckDesktopUpdates?: () => void | Promise<void>;
  onChatEnabledChange?: (enabled: boolean) => void;
  onRelaunchOnboarding?: () => void;
  tableCounts: Partial<Record<CsvTableId, number>>;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
};

export function SettingsView({
  settings,
  saveSetting,
  desktopMode,
  nativeSyncMode,
  desktopVersion,
  onCheckDesktopUpdates,
  onChatEnabledChange,
  onRelaunchOnboarding,
  tableCounts,
  addToast,
  loadAll,
}: Props) {
  const accent = resolveAccentFromSettings(settings);
  const saveQuiet = (key: string, val: string) => saveSetting(key, val, false);
  const [ollamaTesting, setOllamaTesting] = useState(false);
  const [ollamaTestResult, setOllamaTestResult] = useState<{ ok: boolean; ollama: string; url?: string | null } | null>(null);
  const [ollamaUrlDraft, setOllamaUrlDraft] = useState(settings.ollama_base_url || "");
  const [ollamaModelDraft, setOllamaModelDraft] = useState(settings.ollama_model || "");

  useEffect(() => {
    setOllamaUrlDraft(settings.ollama_base_url || "");
  }, [settings.ollama_base_url]);

  useEffect(() => {
    setOllamaModelDraft(settings.ollama_model || "");
  }, [settings.ollama_model]);

  return (
    <>
      <section className="grid two-col">
        <article className="card">
          <h2>Apariencia</h2>
          <AccentColorPicker
            value={accent}
            onChange={(hex) => void saveSetting("theme_accent", hex, true)}
          />
          <SettingSliderField
            label="Tamaño base de fuente"
            settingKey="ui_font_px"
            value={settings.ui_font_px || "15"}
            min={12}
            max={22}
            onSave={saveQuiet}
          />
        </article>

        <article className="card">
          <h2>Perfil</h2>
          <SettingTextField
            label="Fecha de nacimiento"
            settingKey="birth_date"
            value={settings.birth_date || "2000-09-01"}
            type="date"
            onSave={saveQuiet}
          />
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.75rem" }}>
            Estabilidad de ingresos (fondo de emergencia)
            <select
              value={settings.emergency_income_profile || "auto"}
              onChange={(e) => void saveSetting("emergency_income_profile", e.target.value, true)}
            >
              <option value="auto">Automático</option>
              <option value="funcionario">Funcionario/a — 3 meses</option>
              <option value="nomina_privada">Nómina privada — 6 meses</option>
              <option value="mixto">Mixto — 6 meses</option>
              <option value="autonomo">Autónomo/freelance — 12 meses</option>
            </select>
          </label>
          <SettingSliderField
            label="Objetivo de tasa de ahorro (semáforo)"
            settingKey="target_savings_pct"
            value={settings.target_savings_pct || "20"}
            min={0}
            max={50}
            onSave={saveQuiet}
          />
          <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.35rem" }}>
            El semáforo en Inicio usa estos valores para el fondo de emergencia y la tasa de ahorro.
          </p>
        </article>

        <article className="card">
          <h2>Asistente (Ollama)</h2>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: 0 }}>
            <input
              type="checkbox"
              checked={settings.chat_enabled !== "0"}
              onChange={(e) => {
                const enabled = e.target.checked;
                void saveSetting("chat_enabled", enabled ? "1" : "0", true);
                onChatEnabledChange?.(enabled);
              }}
            />
            Mostrar chatbot en la app
          </label>
          <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.35rem" }}>
            Si lo desactivas, el icono del asistente desaparece. El resto de Soberan sigue igual.
          </p>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.75rem" }}>
            URL de Ollama
            <input
              type="text"
              inputMode="url"
              autoComplete="url"
              value={ollamaUrlDraft}
              placeholder="http://127.0.0.1:11434"
              onChange={(e) => setOllamaUrlDraft(e.target.value)}
              onBlur={() => {
                const next = ollamaUrlDraft.trim();
                if (next !== (settings.ollama_base_url || "")) {
                  void saveQuiet("ollama_base_url", next);
                }
              }}
            />
          </label>
          <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.25rem" }}>
            Ejemplos: <code>http://127.0.0.1:11434</code> (local) o tu instancia remota. Vacío = valor por defecto del servidor.
          </p>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.75rem" }}>
            Modelo
            <input
              type="text"
              value={ollamaModelDraft}
              placeholder="llama3:8b"
              onChange={(e) => setOllamaModelDraft(e.target.value)}
              onBlur={() => {
                const next = ollamaModelDraft.trim();
                if (next !== (settings.ollama_model || "")) {
                  void saveQuiet("ollama_model", next);
                }
              }}
            />
          </label>
          <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.25rem" }}>
            Vacío = <code>llama3:8b</code> (o <code>OLLAMA_MODEL</code> del entorno).
          </p>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.75rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="button-secondary"
              disabled={ollamaTesting}
              onClick={() => {
                void (async () => {
                  setOllamaTesting(true);
                  setOllamaTestResult(null);
                  try {
                    const url = ollamaUrlDraft.trim() || undefined;
                    if (url && url !== (settings.ollama_base_url || "")) {
                      await saveQuiet("ollama_base_url", url);
                    }
                    const result = await api.testOllamaConnection(url);
                    setOllamaTestResult(result);
                    addToast(
                      result.ok
                        ? `Ollama OK${result.url ? ` (${result.url})` : ""}`
                        : `Sin conexión${result.url ? ` a ${result.url}` : ""}`,
                      result.ok ? "success" : "error",
                    );
                  } catch (err) {
                    setOllamaTestResult({ ok: false, ollama: "offline" });
                    addToast(err instanceof Error ? err.message : "No se pudo probar Ollama.", "error");
                  } finally {
                    setOllamaTesting(false);
                  }
                })();
              }}
            >
              {ollamaTesting ? "Probando…" : "Probar conexión"}
            </button>
            {ollamaTestResult && (
              <span
                className="muted"
                style={{
                  fontSize: "0.8rem",
                  color: ollamaTestResult.ok ? "var(--status-ok)" : "var(--status-crit)",
                }}
              >
                {ollamaTestResult.ok
                  ? "Conectado"
                  : ollamaTestResult.ollama === "local_only"
                    ? "127.0.0.1 apunta al servidor, no a tu ordenador — usa una URL accesible desde fuera o la app de escritorio"
                    : `Estado: ${ollamaTestResult.ollama}`}
              </span>
            )}
          </div>
        </article>

        <article className="card">
          <h2>Integraciones</h2>
          <p className="muted" style={{ fontSize: "0.78rem", marginTop: 0 }}>
            Claves de API para conectar servicios externos. La sincronización en sí se dispara desde cada sección
            (p. ej. Kraken en Inversiones).
          </p>
          <SettingTextField
            label="Kraken · API Key"
            settingKey="kraken_api_key"
            value={settings.kraken_api_key || ""}
            type="password"
            placeholder="Clave API Kraken (solo lectura)"
            onSave={(key, val) => saveSetting(key, val, false)}
          />
          <div style={{ marginTop: "0.5rem" }}>
            <SettingTextField
              label="Kraken · API Secret"
              settingKey="kraken_api_secret"
              value={settings.kraken_api_secret || ""}
              type="password"
              onSave={(key, val) => saveSetting(key, val, false)}
            />
          </div>
        </article>

        {onRelaunchOnboarding && (
          <article className="card">
            <h2>Ayuda</h2>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
              Vuelve a recorrer los pasos iniciales (cuenta, perfil, apariencia, asistente...). Tus datos y ajustes
              actuales no se borran; el asistente arranca con lo que ya tienes configurado.
            </p>
            <button type="button" className="button-secondary" onClick={onRelaunchOnboarding}>
              Repetir asistente de bienvenida
            </button>
          </article>
        )}

        {desktopMode && (
          <article className="card">
            <h2>Windows</h2>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
              Versión instalada: <strong>v{desktopVersion ?? "?"}</strong>
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem" }}>
              <input
                type="checkbox"
                checked={settings.desktop_check_updates !== "0"}
                onChange={(e) => void saveSetting("desktop_check_updates", e.target.checked ? "1" : "0", true)}
              />
              Buscar actualizaciones al iniciar
            </label>
            <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.35rem" }}>
              Comprueba el último release en GitHub. Sin conexión, la app arranca con normalidad.
            </p>
            {onCheckDesktopUpdates && (
              <button
                type="button"
                className="button-secondary"
                style={{ marginTop: "0.75rem" }}
                onClick={() => void onCheckDesktopUpdates()}
              >
                Comprobar ahora
              </button>
            )}
          </article>
        )}

        <SyncSettingsCard
          api={api}
          settings={settings}
          saveSetting={saveSetting}
          nativeSyncMode={nativeSyncMode}
          addToast={addToast}
          onDataPulled={() => loadAll({ silent: true })}
        />
      </section>

      <h2 className="settings-section-title">Gestión de datos</h2>
      <DataToolsView
        settings={settings}
        tableCounts={tableCounts}
        addToast={addToast}
        loadAll={loadAll}
        saveSetting={saveSetting}
      />
    </>
  );
}
