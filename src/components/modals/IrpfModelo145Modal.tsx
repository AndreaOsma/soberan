import { useEffect, useMemo, useState } from "react";
import { GlassModal } from "../GlassModal";
import { ModalFormError } from "../ModalFormError";
import { api } from "../../services/api";
import { parseNum } from "../../utils/format";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { calculateIrpfRetencion } from "../../utils/irpfRetencion";
import {
  IRPF_MODELO145_SETTINGS_KEY,
  latestIrpfVersion,
  parseIrpfModelo145Store,
  removeIrpfVersion,
  todayIsoDate,
  upsertIrpfVersion,
  versionsForJob,
  type IrpfDependentForm,
  type IrpfModelo145Answers,
  type IrpfModelo145Version,
} from "../../utils/irpfModelo145History";

export type { IrpfDependentForm, IrpfModelo145Answers };

type Result = {
  irpf_pct: number;
  ss_pct: number;
  neto_estimado: number;
  irpf_amount: number;
  ss_amount: number;
  annual_irpf: number;
  family_minimum: number;
  exclusion_limit: number;
  retention_base: number;
  disclaimer?: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** WorkHistory.id — scopes history and saved rates to that empleo */
  jobId?: number | null;
  jobLabel?: string;
  defaultAnnualGross?: number;
  defaultPagas?: number;
  defaultSsPct?: number;
  settings: Record<string, string>;
  saveSetting: (key: string, val: string) => Promise<void>;
  formatEUR: (v: number) => string;
  /** Called after a new historical version is saved. Only updates current job % when effective_from <= today. */
  onApply: (result: {
    irpf_pct: number;
    ss_pct: number;
    answers: IrpfModelo145Answers;
    effective_from: string;
    appliesToCurrentJob: boolean;
    job_id: number | null;
  }) => void;
};

/** Edad a 31 de diciembre del año fiscal (Modelo 145). */
function ageFromBirthDate(iso: string | undefined, yearEnd?: number): number {
  if (!iso) return 35;
  const birth = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return 35;
  const y = yearEnd ?? new Date().getFullYear();
  // A 31-dic todo el mundo ya ha cumplido años ese calendario.
  return Math.max(y - birth.getFullYear(), 16);
}

function fiscalYearFromEffective(iso: string): number {
  const y = Number(iso.slice(0, 4));
  return Number.isFinite(y) && y >= 1900 ? y : new Date().getFullYear();
}

function emptyDependent(kind: "descendant" | "ascendant" = "descendant"): IrpfDependentForm {
  return { kind, age: kind === "descendant" ? 8 : 70, disability: "none", shared_custody: false, mobility_reduced: false };
}

function answersFromVersion(
  ver: IrpfModelo145Version | null,
  defaults: { annualGross: number; pagas: number; ssPct: number; age: number },
): IrpfModelo145Answers {
  if (ver) {
    return {
      ...ver.answers,
      age: defaults.age,
      annual_gross: defaults.annualGross || ver.answers.annual_gross,
      pagas: defaults.pagas || ver.answers.pagas,
      ss_pct: defaults.ssPct || ver.answers.ss_pct,
    };
  }
  return {
    annual_gross: defaults.annualGross,
    age: defaults.age,
    family_situation: "3",
    disability: "none",
    mobility_reduced: false,
    geographic_mobility: false,
    contract_type: "indefinido",
    pagas: defaults.pagas,
    ss_pct: defaults.ssPct,
    dependents: [],
  };
}

export function IrpfModelo145Modal({
  isOpen,
  onClose,
  jobId = null,
  jobLabel,
  defaultAnnualGross = 0,
  defaultPagas = 14,
  defaultSsPct = 6.5,
  settings,
  saveSetting,
  formatEUR,
  onApply,
}: Props) {
  const store = useMemo(
    () => parseIrpfModelo145Store(settings[IRPF_MODELO145_SETTINGS_KEY]),
    [settings],
  );
  const submit = useAsyncSubmit();
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(todayIsoDate());
  const [note, setNote] = useState("");
  const [history, setHistory] = useState(store);

  const computedAge = ageFromBirthDate(settings.birth_date, fiscalYearFromEffective(effectiveFrom));
  const hasBirthDate = Boolean(settings.birth_date?.slice(0, 10));
  const scopedJobId = jobId ?? null;

  const [form, setForm] = useState<IrpfModelo145Answers>(() =>
    answersFromVersion(latestIrpfVersion(store, scopedJobId), {
      annualGross: defaultAnnualGross,
      pagas: defaultPagas,
      ssPct: defaultSsPct,
      age: ageFromBirthDate(settings.birth_date),
    }),
  );

  useEffect(() => {
    if (!isOpen) return;
    const nextStore = parseIrpfModelo145Store(settings[IRPF_MODELO145_SETTINGS_KEY]);
    setHistory(nextStore);
    setStep(0);
    setResult(null);
    setEffectiveFrom(todayIsoDate());
    setNote("");
    const age = ageFromBirthDate(settings.birth_date);
    setForm(
      answersFromVersion(latestIrpfVersion(nextStore, scopedJobId), {
        annualGross: defaultAnnualGross,
        pagas: defaultPagas,
        ssPct: defaultSsPct,
        age,
      }),
    );
  }, [isOpen, defaultAnnualGross, defaultPagas, defaultSsPct, settings, scopedJobId]);

  // Keep age synced with birth date + vigencia year (Modelo 145: 31-dic).
  useEffect(() => {
    setForm((p) => (p.age === computedAge ? p : { ...p, age: computedAge }));
  }, [computedAge]);

  const set = <K extends keyof IrpfModelo145Answers>(key: K, value: IrpfModelo145Answers[K]) => {
    setForm((p) => ({ ...p, [key]: value }));
  };

  const updateDependent = (idx: number, patch: Partial<IrpfDependentForm>) => {
    setForm((p) => ({
      ...p,
      dependents: p.dependents.map((d, i) => (i === idx ? { ...d, ...patch } : d)),
    }));
  };

  const loadVersion = (ver: IrpfModelo145Version) => {
    setForm({
      ...ver.answers,
      age: ageFromBirthDate(settings.birth_date, fiscalYearFromEffective(todayIsoDate())),
      annual_gross: defaultAnnualGross || ver.answers.annual_gross,
    });
    setEffectiveFrom(todayIsoDate());
    setNote("");
    setResult(null);
    setStep(0);
  };

  const deleteVersion = (id: string) => {
    void submit.run(async () => {
      const next = removeIrpfVersion(history, id);
      await saveSetting(IRPF_MODELO145_SETTINGS_KEY, JSON.stringify(next));
      setHistory(next);
    });
  };

  const calculate = () => {
    void submit.run(async () => {
      const age = ageFromBirthDate(settings.birth_date, fiscalYearFromEffective(effectiveFrom));
      const payload = {
        annual_gross: form.annual_gross,
        age,
        family_situation: form.family_situation,
        disability: form.disability,
        mobility_reduced: form.mobility_reduced,
        geographic_mobility: form.geographic_mobility,
        contract_type: form.contract_type,
        pagas: form.pagas,
        ss_pct: form.ss_pct,
        dependents: form.dependents,
      };
      let res: Result;
      try {
        res = await api.getIrpfRetencionModelo145(payload) as Result;
      } catch {
        res = calculateIrpfRetencion(payload);
      }
      setResult(res);
      setStep(3);
    });
  };

  const saveAndApply = () => {
    if (!result) return;
    void submit.run(async () => {
      const age = ageFromBirthDate(settings.birth_date, fiscalYearFromEffective(effectiveFrom));
      const answers = { ...form, age };
      const next = upsertIrpfVersion(history, {
        effective_from: effectiveFrom,
        job_id: scopedJobId,
        answers,
        irpf_pct: Number(result.irpf_pct),
        ss_pct: Number(result.ss_pct),
        note: note.trim() || undefined,
      });
      await saveSetting(IRPF_MODELO145_SETTINGS_KEY, JSON.stringify(next));
      setHistory(next);
      const appliesToCurrentJob = effectiveFrom <= todayIsoDate();
      onApply({
        irpf_pct: Number(result.irpf_pct),
        ss_pct: Number(result.ss_pct),
        answers,
        effective_from: effectiveFrom,
        appliesToCurrentJob,
        job_id: scopedJobId,
      });
      onClose();
    });
  };

  const steps = ["Situación familiar", "Descendientes y ascendientes", "Datos económicos", "Resultado"];
  const sortedHistory = [...versionsForJob(history, scopedJobId)].sort((a, b) =>
    b.effective_from.localeCompare(a.effective_from),
  );
  const title = jobLabel
    ? `IRPF Modelo 145 · ${jobLabel}`
    : "Autocalcular IRPF (Modelo 145)";

  return (
    <GlassModal isOpen={isOpen} onClose={onClose} title={title}>
      <ModalFormError error={submit.error} />
      <p className="muted" style={{ fontSize: "0.82rem", marginTop: 0 }}>
        {scopedJobId != null ? (
          <>
            El % se calcula y guarda <strong>para este empleo</strong> con fecha de vigencia.
            No afecta a otras experiencias laborales.
          </>
        ) : (
          <>
            Sin empleo vinculado aún: el resultado se aplicará al formulario al guardar el empleo.
            Para histórico por empresa, autocalcula desde cada experiencia en Historial Laboral.
          </>
        )}
      </p>

      {sortedHistory.length > 0 && step === 0 && (
        <div className="irpf145-history">
          <h3 className="irpf145-history__title">Histórico de este empleo</h3>
          <ul className="list irpf145-history__list">
            {sortedHistory.map((ver) => {
              const kids = ver.answers.dependents.filter((d) => d.kind === "descendant").length;
              return (
                <li key={ver.id}>
                  <div className="irpf145-history__row">
                    <div className="irpf145-history__meta">
                      <strong>Desde {ver.effective_from}</strong>
                      <span className="muted">
                        {ver.irpf_pct.toFixed(2)}% IRPF
                        {kids > 0 ? ` · ${kids} hijo${kids > 1 ? "s" : ""}` : ""}
                        {ver.note ? ` · ${ver.note}` : ""}
                      </span>
                    </div>
                    <div className="inline-actions">
                      <button type="button" className="button-secondary" style={{ padding: "0.2rem 0.45rem" }} onClick={() => loadVersion(ver)}>
                        Usar
                      </button>
                      <button
                        type="button"
                        className="danger"
                        aria-label={`Eliminar versión ${ver.effective_from}`}
                        title="Eliminar"
                        onClick={() => deleteVersion(ver.id)}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="irpf145-steps" aria-label="Pasos del asistente">
        {steps.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`irpf145-steps__item${i === step ? " is-active" : ""}${i < step ? " is-done" : ""}`}
            onClick={() => setStep(i)}
          >
            <span>{i + 1}</span>
            {label}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="irpf145-panel">
          <label>
            Situación familiar
            <select
              value={form.family_situation}
              onChange={(e) => set("family_situation", e.target.value as IrpfModelo145Answers["family_situation"])}
            >
              <option value="1">1 — Soltero/a, viudo/a, divorciado/a o separado/a con hijos a cargo</option>
              <option value="2">2 — Casado/a; cónyuge sin rentas &gt; 1.500 €/año</option>
              <option value="3">3 — Resto de situaciones (por defecto)</option>
            </select>
          </label>
          <label>
            Edad a 31 de diciembre
            <input type="number" value={computedAge} readOnly disabled aria-readonly="true" />
            <span className="muted" style={{ fontSize: "0.75rem", marginTop: "0.25rem", display: "block" }}>
              {hasBirthDate
                ? `Autocalculada desde tu fecha de nacimiento (${settings.birth_date.slice(0, 10)}) · año ${fiscalYearFromEffective(effectiveFrom)}.`
                : "Sin fecha de nacimiento en Ajustes — se usa 35. Configúrala para un cálculo exacto."}
            </span>
          </label>
          <label>
            Discapacidad del perceptor
            <select
              value={form.disability}
              onChange={(e) => set("disability", e.target.value as IrpfModelo145Answers["disability"])}
            >
              <option value="none">Sin discapacidad</option>
              <option value="33_64">≥ 33% e &lt; 65%</option>
              <option value="65_plus">≥ 65%</option>
            </select>
          </label>
          <label className="irpf145-check">
            <input type="checkbox" checked={form.mobility_reduced} onChange={(e) => set("mobility_reduced", e.target.checked)} />
            Movilidad reducida / ayuda de terceras personas
          </label>
          <label className="irpf145-check">
            <input type="checkbox" checked={form.geographic_mobility} onChange={(e) => set("geographic_mobility", e.target.checked)} />
            Movilidad geográfica (acepté el puesto tras desempleo y me mudé)
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="irpf145-panel">
          <div className="inline-actions" style={{ marginBottom: "0.5rem" }}>
            <button type="button" className="button-secondary" onClick={() => set("dependents", [...form.dependents, emptyDependent("descendant")])}>
              + Descendiente
            </button>
            <button type="button" className="button-secondary" onClick={() => set("dependents", [...form.dependents, emptyDependent("ascendant")])}>
              + Ascendiente
            </button>
          </div>
          {form.dependents.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.85rem" }}>Sin personas a cargo. Puedes continuar.</p>
          ) : (
            <ul className="list irpf145-deps">
              {form.dependents.map((dep, idx) => (
                <li key={idx}>
                  <div className="irpf145-dep">
                    <label>
                      Tipo
                      <select value={dep.kind} onChange={(e) => updateDependent(idx, { kind: e.target.value as IrpfDependentForm["kind"] })}>
                        <option value="descendant">Descendiente (&lt;25 o discapacitado)</option>
                        <option value="ascendant">Ascendiente (≥65 o discapacitado)</option>
                      </select>
                    </label>
                    <label>
                      Edad
                      <input type="number" min={0} max={120} value={dep.age || ""} onChange={(e) => updateDependent(idx, { age: parseNum(e.target.value) })} />
                    </label>
                    <label>
                      Discapacidad
                      <select value={dep.disability} onChange={(e) => updateDependent(idx, { disability: e.target.value as IrpfDependentForm["disability"] })}>
                        <option value="none">Ninguna</option>
                        <option value="33_64">33–64%</option>
                        <option value="65_plus">≥ 65%</option>
                      </select>
                    </label>
                    {dep.kind === "descendant" && (
                      <label className="irpf145-check">
                        <input type="checkbox" checked={dep.shared_custody} onChange={(e) => updateDependent(idx, { shared_custody: e.target.checked })} />
                        Custodia compartida (50%)
                      </label>
                    )}
                    <label className="irpf145-check">
                      <input type="checkbox" checked={dep.mobility_reduced} onChange={(e) => updateDependent(idx, { mobility_reduced: e.target.checked })} />
                      Movilidad reducida
                    </label>
                    <button
                      type="button"
                      className="danger"
                      aria-label="Eliminar"
                      title="Eliminar"
                      onClick={() => set("dependents", form.dependents.filter((_, i) => i !== idx))}
                    >
                      🗑
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="irpf145-panel">
          <label>
            Retribución íntegra anual prevista (€)
            <input type="number" step="0.01" value={form.annual_gross || ""} onChange={(e) => set("annual_gross", parseNum(e.target.value))} required />
          </label>
          <label>
            Tipo de contrato
            <select value={form.contract_type} onChange={(e) => set("contract_type", e.target.value as IrpfModelo145Answers["contract_type"])}>
              <option value="indefinido">General / indefinido</option>
              <option value="temporal">Duración &lt; 1 año (mín. 2%)</option>
              <option value="especial">Relación laboral especial (mín. 15%)</option>
            </select>
          </label>
          <label>
            Número de pagas
            <select value={form.pagas} onChange={(e) => set("pagas", Number(e.target.value))}>
              <option value={12}>12</option>
              <option value={14}>14</option>
            </select>
          </label>
          <label>
            SS trabajador (%)
            <input type="number" step="0.01" value={form.ss_pct || ""} onChange={(e) => set("ss_pct", parseNum(e.target.value))} />
          </label>
        </div>
      )}

      {step === 3 && result && (
        <div className="irpf145-panel irpf145-result">
          <div className="irpf145-result__hero">
            <span className="muted">Tipo de retención estimado</span>
            <strong>{Number(result.irpf_pct).toFixed(2)}%</strong>
          </div>
          <label>
            Vigente desde
            <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
          </label>
          <label>
            Nota (opcional)
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej. nacimiento de hijo, matrimonio…"
            />
          </label>
          <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
            {effectiveFrom > todayIsoDate()
              ? "Fecha futura: se guarda en el histórico pero no cambia el % del empleo actual hasta entonces."
              : "Se guardará en el histórico y actualizará el % del empleo actual (las nóminas reales ya registradas no se tocan)."}
          </p>
          <ul className="list">
            <li><span>IRPF por paga</span><strong className="sensitive negative">{formatEUR(Number(result.irpf_amount || 0))}</strong></li>
            <li><span>SS por paga</span><strong className="sensitive">{formatEUR(Number(result.ss_amount || 0))}</strong></li>
            <li><span>Neto estimado por paga</span><strong className="sensitive positive">{formatEUR(Number(result.neto_estimado || 0))}</strong></li>
            <li><span>IRPF anual</span><strong className="sensitive">{formatEUR(Number(result.annual_irpf || 0))}</strong></li>
            <li><span>Mínimo personal y familiar</span><strong className="sensitive">{formatEUR(Number(result.family_minimum || 0))}</strong></li>
          </ul>
          {result.disclaimer && <p className="muted" style={{ fontSize: "0.75rem" }}>{result.disclaimer}</p>}
        </div>
      )}

      <div className="modal-actions" style={{ marginTop: "1rem" }}>
        <button type="button" className="button-secondary" onClick={onClose}>Cerrar</button>
        {step > 0 && step < 3 && (
          <button type="button" className="button-secondary" onClick={() => setStep((s) => s - 1)}>Atrás</button>
        )}
        {step < 2 && (
          <button type="button" onClick={() => setStep((s) => s + 1)}>Siguiente</button>
        )}
        {step === 2 && (
          <button type="button" disabled={submit.saving || form.annual_gross <= 0} onClick={calculate}>
            {submit.saving ? "Calculando…" : "Calcular retención"}
          </button>
        )}
        {step === 3 && result && (
          <button type="button" disabled={submit.saving || !effectiveFrom} onClick={saveAndApply}>
            {submit.saving ? "Guardando…" : `Guardar desde ${effectiveFrom}`}
          </button>
        )}
      </div>
    </GlassModal>
  );
}
