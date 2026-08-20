import { useState, type CSSProperties } from "react";
import { api } from "../services/api";
import { useAsyncSubmit } from "../hooks/useAsyncSubmit";
import { ModalFormError } from "./ModalFormError";
import { MethodGuideSummary } from "./methodGuide/MethodGuideSummary";
import { MethodGuideModal } from "./methodGuide/MethodGuideModal";
import { METHOD_SECTIONS } from "../content/methodGuide";
import { AccentColorPicker } from "./AccentColorPicker";
import { buildThemeFromAccent, resolveAccentFromSettings } from "../utils/accentTheme";
import { toDateOnly } from "../utils/format";
import { SyncOnboardingStep } from "../../../../lib/native-sync/frontend/SyncOnboardingStep";

type Props = {
  onComplete: (settingsPatch: Record<string, string>) => void;
  onNavigateToLaboral: () => void;
  onCancel?: () => void;
  initialSettings?: Record<string, string>;
  /** Client build (Windows/macOS/Android/iOS) — false on Docker, gates the "Sincronización" step. */
  nativeSyncMode?: boolean;
};

const BASE_STEPS = [
  "Bienvenida",
  "Cómo funciona",
  "Cuenta",
  "Primer mes",
  "Perfil",
  "Apariencia",
  "Asistente",
] as const;

const EMERGENCY_PROFILES = [
  { value: "auto", label: "Automático" },
  { value: "funcionario", label: "Funcionario/a — 3 meses" },
  { value: "nomina_privada", label: "Nómina privada — 6 meses" },
  { value: "mixto", label: "Mixto — 6 meses" },
  { value: "autonomo", label: "Autónomo/freelance — 12 meses" },
] as const;

type AfterFinish = "laboral" | null;

export function OnboardingWizard({
  onComplete,
  onNavigateToLaboral,
  onCancel,
  initialSettings,
  nativeSyncMode,
}: Props) {
  const s = initialSettings ?? {};
  const STEPS = nativeSyncMode ? [...BASE_STEPS, "Sincronización"] : BASE_STEPS;
  const [step, setStep] = useState(0);
  const [methodGuideOpen, setMethodGuideOpen] = useState(false);
  const [afterFinish, setAfterFinish] = useState<AfterFinish>(null);
  const { saving, error, run } = useAsyncSubmit();

  const [birthDate, setBirthDate] = useState(toDateOnly(s.birth_date) || "");
  const [emergencyProfile, setEmergencyProfile] = useState(s.emergency_income_profile || "auto");
  const [targetSavingsPct, setTargetSavingsPct] = useState(() => Number(s.target_savings_pct) || 20);
  const [accent, setAccent] = useState(() => resolveAccentFromSettings(s));
  const [fontPx, setFontPx] = useState(() => Number(s.ui_font_px) || 15);
  const [chatEnabled, setChatEnabled] = useState(s.chat_enabled !== "0");
  const [ollamaUrl, setOllamaUrl] = useState(s.ollama_base_url || "");
  const [ollamaModel, setOllamaModel] = useState(s.ollama_model || "");
  const [ollamaTesting, setOllamaTesting] = useState(false);
  const [ollamaTestResult, setOllamaTestResult] = useState<{ ok: boolean; ollama: string; url?: string | null } | null>(null);

  const [accountForm, setAccountForm] = useState({
    alias_real: "",
    alias_anonimo: "",
    tipo: "gasto",
    balance_actual: 0,
    banco: "",
  });

  const themeVars = buildThemeFromAccent(accent);
  const shellStyle = {
    "--primary": themeVars.primary,
    "--accent": themeVars.accent,
    "--gradient": themeVars.gradient,
    "--ui-font": `${Math.min(22, Math.max(12, fontPx))}px`,
    fontSize: `${Math.min(22, Math.max(12, fontPx))}px`,
  } as CSSProperties;

  function goToPrefs(next: AfterFinish) {
    setAfterFinish(next);
    setStep(4);
  }

  async function finish(extra: Record<string, string> = {}, opts?: { skipDefaults?: boolean }) {
    await run(async () => {
      // skipDefaults: set by the sync step after a real connect+pull — the pulled data
      // may already include the user's actual theme/profile/appearance settings, so
      // overwriting them with this wizard's own local placeholder defaults would silently
      // clobber what just came down.
      const patch: Record<string, string> = opts?.skipDefaults
        ? { onboarding_done: "true", ...extra }
        : {
            onboarding_done: "true",
            theme_accent: accent,
            emergency_income_profile: emergencyProfile,
            target_savings_pct: String(targetSavingsPct),
            ui_font_px: String(fontPx),
            chat_enabled: chatEnabled ? "1" : "0",
            ollama_base_url: ollamaUrl.trim(),
            ollama_model: ollamaModel.trim(),
            ...extra,
          };
      if (!opts?.skipDefaults && birthDate) patch.birth_date = birthDate;

      await Promise.all([
        ...Object.entries(extra).map(([key, value]) => api.setSetting(key, value)),
        ...(opts?.skipDefaults
          ? []
          : [
              ...(birthDate ? [api.setSetting("birth_date", birthDate)] : []),
              api.setSetting("theme_accent", accent),
              api.setSetting("emergency_income_profile", emergencyProfile),
              api.setSetting("target_savings_pct", String(targetSavingsPct)),
              api.setSetting("ui_font_px", String(fontPx)),
              api.setSetting("chat_enabled", chatEnabled ? "1" : "0"),
              api.setSetting("ollama_base_url", ollamaUrl.trim()),
              api.setSetting("ollama_model", ollamaModel.trim()),
            ]),
        api.setSetting("onboarding_done", "true"),
      ]);

      onComplete(patch);
      if (afterFinish === "laboral") onNavigateToLaboral();
    });
  }

  async function createAccountAndNext() {
    if (!accountForm.alias_real.trim()) {
      setStep(3);
      return;
    }
    await run(async () => {
      await api.createAccount({
        ...accountForm,
        alias_anonimo: accountForm.alias_anonimo || undefined,
      });
      setStep(3);
    });
  }

  async function testOllama() {
    setOllamaTesting(true);
    setOllamaTestResult(null);
    try {
      const url = ollamaUrl.trim() || undefined;
      const result = await api.testOllamaConnection(url);
      setOllamaTestResult(result);
    } catch {
      setOllamaTestResult({ ok: false, ollama: "offline" });
    } finally {
      setOllamaTesting(false);
    }
  }

  return (
    <main className="app-shell theme-light onboarding-shell" style={shellStyle}>
      <section className="card onboarding-card">
        <div className="onboarding-top-row">
          <div className="onboarding-progress">
            {STEPS.map((label, i) => (
              <span key={label} className={`onboarding-step${i <= step ? " is-active" : ""}`}>
                {i + 1}. {label}
              </span>
            ))}
          </div>
          {onCancel && (
            <button
              type="button"
              className="topbar-icon-btn"
              onClick={onCancel}
              title="Cerrar asistente"
              aria-label="Cerrar asistente"
            >
              ✕
            </button>
          )}
        </div>

        {nativeSyncMode && step !== BASE_STEPS.length && (
          <p className="muted" style={{ fontSize: "0.8rem", margin: "-0.3rem 0 0.6rem" }}>
            ¿Ya tienes tus datos en la nube o en tu servidor?{" "}
            <button
              type="button"
              style={{
                font: "inherit",
                color: "var(--primary)",
                textDecoration: "underline",
                padding: 0,
                border: "none",
                background: "none",
                cursor: "pointer",
              }}
              onClick={() => setStep(BASE_STEPS.length)}
            >
              Sincronizar y saltar el resto
            </button>
          </p>
        )}

        <ModalFormError error={error} />

        {step === 0 && (
          <>
            <h1>Bienvenido a Soberan</h1>
            <p className="muted" style={{ marginTop: 0 }}>
              Presupuesto, patrimonio y deudas en un solo sitio. Tus datos, siempre tuyos.
            </p>
            <p className="muted">
              En unos minutos vas a tener claro si tu mes va bien o mal, de un vistazo — sin fórmulas ni hojas de
              cálculo. Solo hace falta un par de datos: tu cuenta y lo básico de este mes.
            </p>
            <div className="onboarding-welcome-lights">
              <span className="onboarding-welcome-light" style={{ "--dot-color": "var(--status-ok)" } as CSSProperties}>
                <span className="onboarding-welcome-light__dot" />
                Vas bien
              </span>
              <span className="onboarding-welcome-light" style={{ "--dot-color": "var(--status-warn)" } as CSSProperties}>
                <span className="onboarding-welcome-light__dot" />
                Cuidado
              </span>
              <span className="onboarding-welcome-light" style={{ "--dot-color": "var(--status-crit)" } as CSSProperties}>
                <span className="onboarding-welcome-light__dot" />
                Hay que actuar
              </span>
            </div>
            <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.4rem" }}>
              Así de simple se ve tu estado financiero en Inicio.
            </p>
            <div className="onboarding-actions">
              <button type="button" onClick={() => setStep(1)}>Continuar</button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1>Cómo funciona</h1>
            <p className="muted" style={{ marginTop: 0 }}>
              Un resumen rápido de cómo se organiza tu dinero en la app. Si en algún momento quieres repasarlo, siempre está a un clic en el botón <strong>?</strong> de la barra.
            </p>
            <MethodGuideSummary onOpenFullGuide={() => setMethodGuideOpen(true)} />
            <div className="onboarding-actions">
              <button type="button" className="button-secondary" onClick={() => setStep(0)}>Atrás</button>
              <button type="button" onClick={() => setStep(2)}>Continuar</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1>Tu primera cuenta</h1>
            <p className="muted">
              Indica el saldo actual de la cuenta: Inicio y los totales lo usan como punto de partida.
            </p>
            <div className="grid two-col onboarding-form">
              <label className="onboarding-field">
                Nombre
                <input
                  value={accountForm.alias_real}
                  onChange={(e) => setAccountForm((p) => ({ ...p, alias_real: e.target.value }))}
                  placeholder="Cuenta principal"
                />
              </label>
              <label className="onboarding-field">
                Banco
                <input
                  value={accountForm.banco}
                  onChange={(e) => setAccountForm((p) => ({ ...p, banco: e.target.value }))}
                  placeholder="ING, MyInvestor…"
                />
              </label>
              <label className="onboarding-field">
                Saldo inicial (€)
                <input
                  type="number"
                  step="0.01"
                  value={accountForm.balance_actual || ""}
                  onChange={(e) => setAccountForm((p) => ({ ...p, balance_actual: parseFloat(e.target.value) || 0 }))}
                  placeholder="0,00"
                />
              </label>
            </div>
            <div className="onboarding-actions">
              <button type="button" className="button-secondary" onClick={() => setStep(1)}>Atrás</button>
              <button type="button" className="button-secondary" onClick={() => setStep(3)}>Saltar</button>
              <button type="button" disabled={saving} onClick={() => void createAccountAndNext()}>
                {saving ? "Guardando…" : "Crear y continuar"}
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1>Primer mes</h1>
            <p className="muted">
              Para ver números reales en Presupuesto e Inicio, elige una de estas dos vías. Después quedan el
              perfil, la apariencia y el chat, que son opcionales.
            </p>
            <ul className="onboarding-checklist muted">
              <li>Laboral: añade tu nómina y pulsa "Sincronizar con presupuesto" para que cuente en Presupuesto.</li>
              <li>Presupuesto: usa la plantilla 50/30/20 o copia un mes anterior, para no partir de cero.</li>
            </ul>
            <div className="onboarding-actions onboarding-actions--stack">
              <button type="button" onClick={() => goToPrefs("laboral")}>
                Configurar nómina (Laboral)
              </button>
              <button type="button" className="button-secondary" onClick={() => goToPrefs(null)}>
                Saltar por ahora
              </button>
              <button type="button" className="button-secondary" onClick={() => setStep(2)}>
                Atrás
              </button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h1>Perfil</h1>
            <p className="muted" style={{ marginTop: 0 }}>
              Datos que usa Inicio para el fondo de emergencia y el objetivo de ahorro. Se pueden cambiar en Configuración.
            </p>
            <label className="onboarding-field">
              <span className="onboarding-field-label">
                Fecha de nacimiento
                <button
                  type="button"
                  className="onboarding-field-hint"
                  title="Se usa para calcular tu jubilación estimada."
                  aria-label="Para qué se usa la fecha de nacimiento"
                >
                  ?
                </button>
              </span>
              <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </label>
            <label className="onboarding-field">
              <span className="onboarding-field-label">
                Estabilidad de ingresos (fondo de emergencia)
                <button
                  type="button"
                  className="onboarding-field-hint"
                  title="Cuanto menos estables sean tus ingresos, más meses de gastos te recomendamos tener ahorrados como colchón. Se usa para el aviso de fondo de emergencia en Inicio."
                  aria-label="Para qué se usa la estabilidad de ingresos"
                >
                  ?
                </button>
              </span>
              <select value={emergencyProfile} onChange={(e) => setEmergencyProfile(e.target.value)}>
                {EMERGENCY_PROFILES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="onboarding-field">
              Objetivo de tasa de ahorro (aviso en Inicio): {targetSavingsPct}%
              <input
                type="range"
                min={0}
                max={50}
                value={targetSavingsPct}
                onChange={(e) => setTargetSavingsPct(Number(e.target.value) || 0)}
              />
            </label>
            <div className="onboarding-actions">
              <button type="button" className="button-secondary" onClick={() => setStep(3)}>Atrás</button>
              <button type="button" onClick={() => setStep(5)}>Continuar</button>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h1>Apariencia</h1>
            <p className="muted" style={{ marginTop: 0 }}>
              Color de acento y tamaño de fuente. El tema claro/oscuro se elige en la barra superior.
            </p>
            <AccentColorPicker
              value={accent}
              onChange={setAccent}
              hint="También en Configuración."
            />
            <label className="onboarding-field">
              Tamaño base de fuente: {fontPx}px
              <input
                type="range"
                min={12}
                max={22}
                value={fontPx}
                onChange={(e) => setFontPx(Number(e.target.value) || 15)}
              />
            </label>
            <div className="onboarding-actions">
              <button type="button" className="button-secondary" onClick={() => setStep(4)}>Atrás</button>
              <button type="button" onClick={() => setStep(6)}>Continuar</button>
            </div>
          </>
        )}

        {step === 6 && (
          <>
            <h1>Asistente (opcional)</h1>
            <p className="muted" style={{ marginTop: 0 }}>
              Chat local vía Ollama, totalmente opcional. Si lo desactivas, no aparece el botón flotante y el resto
              de la app sigue igual.
            </p>
            <label className="onboarding-field onboarding-field--row">
              <input
                type="checkbox"
                checked={chatEnabled}
                onChange={(e) => setChatEnabled(e.target.checked)}
              />
              Mostrar chatbot en la app
            </label>
            <label className="onboarding-field">
              URL de Ollama
              <input
                type="text"
                inputMode="url"
                autoComplete="url"
                value={ollamaUrl}
                placeholder="http://127.0.0.1:11434"
                disabled={!chatEnabled}
                onChange={(e) => setOllamaUrl(e.target.value)}
              />
            </label>
            <p className="muted" style={{ fontSize: "0.78rem", margin: "-0.5rem 0 0" }}>
              Lo habitual en local es <code>http://127.0.0.1:11434</code>. Si lo dejas vacío, se usa el valor por
              defecto del servidor.
            </p>
            <label className="onboarding-field">
              Modelo
              <input
                type="text"
                value={ollamaModel}
                placeholder="llama3:8b"
                disabled={!chatEnabled}
                onChange={(e) => setOllamaModel(e.target.value)}
              />
            </label>
            <p className="muted" style={{ fontSize: "0.78rem", margin: "-0.5rem 0 0" }}>
              Si lo dejas vacío, se usa <code>llama3:8b</code> (o el modelo que tenga configurado el servidor).
            </p>
            <div className="onboarding-ollama-test">
              <button
                type="button"
                className="button-secondary"
                disabled={!chatEnabled || ollamaTesting}
                onClick={() => void testOllama()}
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
            <div className="onboarding-actions">
              <button type="button" className="button-secondary" onClick={() => setStep(5)}>Atrás</button>
              <button
                type="button"
                disabled={saving}
                onClick={() => (nativeSyncMode ? setStep(BASE_STEPS.length) : void finish())}
              >
                {nativeSyncMode ? "Continuar" : saving ? "Guardando…" : "Empezar"}
              </button>
            </div>
          </>
        )}

        {step === BASE_STEPS.length && nativeSyncMode && (
          <>
            <h1>Sincronización (opcional)</h1>
            <p className="muted" style={{ marginTop: 0 }}>
              Tus datos están solo en este dispositivo. Puedes conectar tu propia nube o tu propio servidor para
              tenerlos también en otro sitio — o saltarte esto y seguir en local, se puede activar luego en
              Configuración.
            </p>
            <SyncOnboardingStep
              api={api}
              nativeSyncMode={nativeSyncMode}
              saveSetting={async (key, value) => { await api.setSetting(key, value); }}
              onBack={() => setStep(6)}
              onSkip={() => void finish()}
              onDone={(patch, opts) => void finish(patch, opts)}
            />
          </>
        )}
      </section>

      <MethodGuideModal
        isOpen={methodGuideOpen}
        onClose={() => setMethodGuideOpen(false)}
        sections={METHOD_SECTIONS.filter((s) => s.id !== "cycle" && s.id !== "503020")}
        showIntro={false}
      />
    </main>
  );
}
