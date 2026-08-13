import { useState } from "react";
import { api } from "../../services/api";
import { GlassModal } from "../../components/GlassModal";
import { WorkHistoryModal } from "../../components/modals/WorkHistoryModal";
import { IrpfModelo145Modal } from "../../components/modals/IrpfModelo145Modal";
import { parseNum } from "../../utils/format";
import {
  formatSepeAlertMessage,
  isUnemployed,
  sepeRenewalAlertState,
  todayIso,
} from "../../utils/unemploymentSepe";
import { useNotify } from "../../hooks/useNotify";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../../components/ModalFormError";
import { SettingTextField } from "../../components/SettingFields";
import { PayrollAccountCard } from "../../components/work/PayrollAccountCard";
import type { MenuKey } from "../../config/ui";
import type { Account, RecurringEntry, WorkHistory } from "../../types";

type ActiveSalary = {
  empresa: string; bruto: number; irpf: number; ss: number;
  neto: number; irpf_pct: number; ss_pct: number;
} | null;

export type WorkHistoryPanelProps = {
  workHistory: WorkHistory[];
  recurringEntries: RecurringEntry[];
  accounts: Account[];
  settings: Record<string, string>;
  activeSalary: ActiveSalary;
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  deleteWithUndo: (label: string, onCommit: () => Promise<void>) => void;
  saveSetting: (key: string, val: string) => Promise<void>;
  onNavigate?: (key: MenuKey) => void;
};

export function WorkHistoryPanel({
  workHistory, recurringEntries, accounts, settings,
  activeSalary, formatEUR, addToast, loadAll, deleteWithUndo, saveSetting,
  onNavigate,
}: WorkHistoryPanelProps) {
  const [editWorkModal, setEditWorkModal] = useState<WorkHistory | null>(null);
  const [isWorkFormOpen, setIsWorkFormOpen] = useState(false);
  const [irpfWizardOpen, setIrpfWizardOpen] = useState(false);
  const [workForm, setWorkForm] = useState({
    empresa: "", grupo_cotizacion: "", fecha_inicio: "", fecha_fin: "",
    dias_alta: 0, salario_bruto: 0, periodicidad: "M", irpf_pct: 0, ss_pct: 6.35
  });

  const { notifyAfter } = useNotify({ addToast, loadAll });
  const workSubmit = useAsyncSubmit();
  const sepeRenewSubmit = useAsyncSubmit();

  const totalDias = workHistory.reduce((s, w) => s + (w.dias_alta || 0), 0);
  const aniosCotizados = totalDias / 365.25;
  const birthDate = settings.birth_date ? new Date(settings.birth_date) : null;
  const today = new Date();

  const DIAS_PLENA = Math.round(38 * 365.25);
  const DIAS_MINIMA = Math.round(15 * 365.25);
  const diasRestantes = Math.max(0, DIAS_PLENA - totalDias);
  const isCurrentlyActive = workHistory.some(w => !w.fecha_fin);

  let fechaJubilacion: Date | null = null;
  let jubilacionLabel = "";
  if (birthDate) {
    const fecha65 = new Date(birthDate); fecha65.setFullYear(fecha65.getFullYear() + 65);
    const fecha67 = new Date(birthDate); fecha67.setFullYear(fecha67.getFullYear() + 67);
    const fechaContrib = isCurrentlyActive && diasRestantes > 0
      ? new Date(today.getTime() + diasRestantes * 86_400_000)
      : diasRestantes === 0 ? today : null;

    if (totalDias < DIAS_MINIMA) {
      jubilacionLabel = "Sin mínimo de 15 años";
    } else if (fechaContrib && fechaContrib <= fecha65) {
      fechaJubilacion = fecha65;
      jubilacionLabel = "a los 65 años (contribuciones completas antes)";
    } else if (fechaContrib && fechaContrib <= fecha67) {
      fechaJubilacion = fechaContrib;
      jubilacionLabel = "al completar 38 años de cotización";
    } else {
      fechaJubilacion = fecha67;
      jubilacionLabel = fechaContrib ? "a los 67 años (sin completar 38 años)" : "a los 67 años";
    }
  }

  const sepeState = sepeRenewalAlertState(settings, workHistory, recurringEntries, today);
  const sepeMessage = formatSepeAlertMessage(sepeState, settings, workHistory, today);
  const showSepeBanner = isUnemployed(settings, workHistory, recurringEntries) && sepeState !== "ok";
  const sepeBannerClass = sepeState === "overdue" ? "status-banner--crit" : "status-banner--warn";

  return (
    <>
      <section className="grid one-col">
        {showSepeBanner && (
          <article
            className={`card ${sepeBannerClass}`}
            style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", justifyContent: "space-between" }}
          >
            <div style={{ flex: "1 1 16rem" }}>
              <strong style={{ display: "block", marginBottom: "0.25rem" }}>Renovación SEPE</strong>
              <p style={{ margin: 0, fontSize: "0.875rem" }}>{sepeMessage}</p>
            </div>
            <button
              type="button"
              disabled={sepeRenewSubmit.saving}
              onClick={() => void sepeRenewSubmit.run(async () => {
                await saveSetting("sepe_ultima_renovacion", todayIso());
                addToast("Renovación SEPE registrada para hoy.", "success");
                await loadAll({ silent: true });
              })}
            >
              {sepeRenewSubmit.saving ? "Guardando…" : "Renovado hoy"}
            </button>
          </article>
        )}

        <article className="card" style={{ display: "flex", gap: "2rem", flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <p className="muted" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.2rem" }}>Total días en alta</p>
            <strong style={{ fontSize: "1.75rem" }}>{totalDias.toLocaleString("es")}</strong>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.15rem" }}>{aniosCotizados.toFixed(1)} años cotizados</p>
          </div>
          <div>
            <p className="muted" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.2rem" }}>Para pensión plena (38 años)</p>
            <strong style={{ fontSize: "1.75rem", color: diasRestantes === 0 ? "var(--color-positive, #16a34a)" : undefined }}>
              {diasRestantes === 0 ? "Completado" : `${Math.ceil(diasRestantes / 365.25 * 10) / 10} años restantes`}
            </strong>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.15rem" }}>{diasRestantes.toLocaleString("es")} días · mín. 15 años para cualquier pensión</p>
          </div>
          {fechaJubilacion && (
            <div>
              <p className="muted" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.2rem" }}>Estimación jubilación</p>
              <strong style={{ fontSize: "1.75rem" }}>
                {fechaJubilacion.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
              </strong>
              <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.15rem" }}>{jubilacionLabel}{!isCurrentlyActive && " · sin trabajo activo la estimación no avanza"}</p>
            </div>
          )}
          {!birthDate && (
            <p className="muted" style={{ fontSize: "0.85rem", alignSelf: "center" }}>
              Añade tu fecha de nacimiento en{" "}
              {onNavigate ? (
                <button type="button" className="button-link" onClick={() => onNavigate("Configuración")}>
                  Configuración → Perfil
                </button>
              ) : (
                "Configuración → Perfil"
              )}
              {" "}para calcular la jubilación estimada.
            </p>
          )}
        </article>

        <article className="card">
          <h2>Paro / SEPE</h2>
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
            Renueva la demanda antes de que venza el plazo. Soberan te avisará en Inicio y aquí.
          </p>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginBottom: "0.75rem" }}>
            Situación laboral
            <select
              value={settings.sepe_status || "auto"}
              onChange={(e) => void saveSetting("sepe_status", e.target.value)}
            >
              <option value="auto">Automático (sin trabajo activo + prestación)</option>
              <option value="paro">En paro — avisar siempre</option>
              <option value="activo">Trabajando — no avisar</option>
            </select>
          </label>
          <SettingTextField
            label="Última renovación SEPE"
            settingKey="sepe_ultima_renovacion"
            value={settings.sepe_ultima_renovacion || ""}
            type="date"
            onSave={saveSetting}
          />
          <SettingTextField
            label="Intervalo entre renovaciones (días)"
            settingKey="sepe_intervalo_dias"
            value={settings.sepe_intervalo_dias || "90"}
            onSave={saveSetting}
          />
          <button
            type="button"
            className="button-secondary"
            style={{ marginTop: "0.5rem" }}
            onClick={() => void saveSetting("sepe_ultima_renovacion", new Date().toISOString().slice(0, 10))}
          >
            Marcar renovado hoy
          </button>
        </article>

        <article className="card">
          <div className="work-list-head">
            <h2>Vida laboral</h2>
            <button onClick={() => { setWorkForm(p => ({ ...p, empresa: "" })); setIsWorkFormOpen(true); }}>+ Nueva empresa</button>
          </div>
          {(() => {
            const sorted = [...workHistory].sort((a, b) => (b.fecha_inicio ?? "").localeCompare(a.fecha_inicio ?? ""));
            const order: string[] = [];
            const groups: Record<string, typeof sorted> = {};
            for (const item of sorted) {
              if (!groups[item.empresa]) { groups[item.empresa] = []; order.push(item.empresa); }
              groups[item.empresa].push(item);
            }
            return order.map(empresa => {
              const stages = groups[empresa];
              const isActiveCompany = stages.some(s => !s.fecha_fin);
              return (
                <div key={empresa} className="work-company">
                  <div className="work-company__head">
                    <strong className="work-company__name">
                      {isActiveCompany && <span className="positive work-company__badge">Activo</span>}
                      {empresa}
                    </strong>
                    <button type="button" className="button-secondary work-company__add"
                      onClick={() => { setWorkForm(p => ({ ...p, empresa })); setIsWorkFormOpen(true); }}>
                      + Nueva etapa
                    </button>
                  </div>
                  <ul className="list work-list">
                    {stages.map(item => {
                      const brutoMensual = item.salario_bruto
                        ? (item.periodicidad === "A" ? item.salario_bruto / 12 : item.salario_bruto)
                        : null;
                      const netoMensual = brutoMensual !== null
                        ? brutoMensual * (1 - (item.irpf_pct ?? 0) / 100 - (item.ss_pct ?? 0) / 100)
                        : null;
                      return (
                        <li key={item.id} className="work-list__item">
                          <div className="work-list__row">
                            <div className="work-list__meta">
                              <span className="muted">
                                {item.fecha_inicio?.slice(0, 10)}{item.fecha_fin ? ` → ${item.fecha_fin.slice(0, 10)}` : " → actualidad"}
                                {item.grupo_cotizacion && <small> · G{item.grupo_cotizacion}</small>}
                              </span>
                            </div>
                            <div className="inline-actions">
                              {brutoMensual !== null && (
                                <span className="work-list__pay muted">
                                  <span className="sensitive">{formatEUR(brutoMensual)}</span>
                                  {netoMensual !== null && <> → <strong className="sensitive positive">{formatEUR(netoMensual)}</strong></>}
                                  <small className="muted"> /mes</small>
                                </span>
                              )}
                              <button type="button" className="button-secondary" style={{ padding: "0.2rem 0.4rem" }}
                                aria-label={`Editar etapa ${item.empresa}`} title="Editar"
                                onClick={() => setEditWorkModal(item)}>✎</button>
                              <button type="button" className="danger"
                                aria-label={`Eliminar etapa ${item.empresa}`} title="Eliminar"
                                onClick={() => deleteWithUndo("Etapa", () => api.deleteWorkHistory(item.id).then(() => loadAll()))}>
                                🗑
                              </button>
                            </div>
                          </div>
                          {brutoMensual !== null && (
                            <small className="muted work-list__taxes">IRPF {item.irpf_pct ?? 0}% · SS {item.ss_pct ?? 6.35}% · {item.dias_alta} días{item.periodicidad === "A" ? " · salario anual" : ""}</small>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            });
        })()}
      </article>

        {activeSalary && (
          <>
            <article className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
                <div>
                  <p className="muted" style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>Nómina activa · {activeSalary.empresa}</p>
                  <span style={{ fontSize: "1rem" }}>
                    Bruto <strong className="sensitive">{formatEUR(activeSalary.bruto)}/mes</strong>
                    <span className="muted" style={{ marginLeft: "0.75rem" }}>→ Neto <strong className="sensitive positive">{formatEUR(activeSalary.neto)}/mes</strong></span>
                    <small className="muted" style={{ marginLeft: "0.75rem" }}>IRPF {activeSalary.irpf_pct}% · SS {activeSalary.ss_pct}%</small>
                  </span>
                </div>
                <button type="button" className="button-secondary" style={{ fontSize: "0.85rem" }}
                  onClick={() => {
                    const name = `Nómina ${activeSalary.empresa}`;
                    const existing = recurringEntries.find(e => e.es_ingreso && (e.nombre === name || e.empresa === activeSalary.empresa));
                    const payload = {
                      nombre: name,
                      monto_estimado: Math.round(activeSalary.neto * 100) / 100,
                      es_ingreso: true, es_fijo: true, categoria: "Nómina", empresa: activeSalary.empresa,
                    };
                    void notifyAfter(async () => {
                      if (existing) {
                        await api.updateRecurringEntry(existing.id, { ...existing, ...payload });
                      } else {
                        await api.createRecurringEntry(payload);
                      }
                    }, existing ? "Partida actualizada." : "Partida añadida al presupuesto.", "No se pudo sincronizar la nómina.");
                  }}>
                  Sincronizar con presupuesto
                </button>
              </div>
            </article>
            <PayrollAccountCard
              empresa={activeSalary.empresa}
              accounts={accounts}
              addToast={addToast}
              loadAll={loadAll}
            />
          </>
        )}
      </section>

      {editWorkModal && (
        <WorkHistoryModal
          item={editWorkModal}
          onClose={() => setEditWorkModal(null)}
          onSaved={loadAll}
          settings={settings}
          saveSetting={saveSetting}
          formatEUR={formatEUR}
        />
      )}
      <GlassModal
        isOpen={isWorkFormOpen}
        onClose={() => { setIsWorkFormOpen(false); setWorkForm({ empresa: "", grupo_cotizacion: "", fecha_inicio: "", fecha_fin: "", dias_alta: 0, salario_bruto: 0, periodicidad: "M", irpf_pct: 0, ss_pct: 6.35 }); }}
        title={workForm.empresa ? `Nueva etapa — ${workForm.empresa}` : "Añadir empresa"}
      >
        <ModalFormError error={workSubmit.error} />
        <form onSubmit={(e) => {
          e.preventDefault();
          void workSubmit.run(async () => {
            await api.createWorkHistory({
              ...workForm,
              fecha_inicio: `${workForm.fecha_inicio || new Date().toISOString().slice(0, 10)}T00:00:00`,
              fecha_fin: workForm.fecha_fin ? `${workForm.fecha_fin}T00:00:00` : undefined,
              salario_bruto: workForm.salario_bruto || null,
              periodicidad: workForm.periodicidad,
              irpf_pct: workForm.irpf_pct,
              ss_pct: workForm.ss_pct,
            });
            setWorkForm({ empresa: "", grupo_cotizacion: "", fecha_inicio: "", fecha_fin: "", dias_alta: 0, salario_bruto: 0, periodicidad: "M", irpf_pct: 0, ss_pct: 6.35 });
            setIsWorkFormOpen(false);
            addToast("Registro laboral creado.", "success");
            await loadAll({ silent: true });
          });
        }}>
          <div className="grid two-col" style={{ gap: "0.75rem" }}>
            <label>Empresa<input value={workForm.empresa} onChange={e => setWorkForm(p => ({ ...p, empresa: e.target.value }))} required autoFocus /></label>
            <label>Grupo cotización<input value={workForm.grupo_cotizacion} onChange={e => setWorkForm(p => ({ ...p, grupo_cotizacion: e.target.value }))} /></label>
            <label>Fecha inicio<input type="date" value={workForm.fecha_inicio} onChange={e => setWorkForm(p => ({ ...p, fecha_inicio: e.target.value }))} required /></label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input type="checkbox" checked={!workForm.fecha_fin} onChange={e => setWorkForm(p => ({ ...p, fecha_fin: e.target.checked ? "" : new Date().toISOString().slice(0, 10) }))} />
              Trabajo actual
            </label>
            {workForm.fecha_fin && <label style={{ gridColumn: "1/-1" }}>Fecha fin<input type="date" value={workForm.fecha_fin} onChange={e => setWorkForm(p => ({ ...p, fecha_fin: e.target.value }))} /></label>}
            <label>Salario bruto<input type="number" step="0.01" value={workForm.salario_bruto || ""} onChange={e => setWorkForm(p => ({ ...p, salario_bruto: parseNum(e.target.value) }))} /></label>
            <label>Salario introducido como<select value={workForm.periodicidad} onChange={e => setWorkForm(p => ({ ...p, periodicidad: e.target.value }))}><option value="M">Por mes (bruto mensual)</option><option value="A">Por año (bruto anual ÷ 12)</option></select></label>
            <label>
              IRPF (%)
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <input type="number" step="0.01" value={workForm.irpf_pct || ""} onChange={e => setWorkForm(p => ({ ...p, irpf_pct: parseNum(e.target.value) }))} style={{ flex: 1 }} />
                <button type="button" className="button-secondary" style={{ whiteSpace: "nowrap" }} onClick={() => setIrpfWizardOpen(true)}>
                  Autocalcular
                </button>
              </div>
            </label>
            <label>SS (%)<input type="number" step="0.01" value={workForm.ss_pct || ""} onChange={e => setWorkForm(p => ({ ...p, ss_pct: parseNum(e.target.value) }))} /></label>
          </div>
          <div className="modal-actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="button-secondary" onClick={() => setIsWorkFormOpen(false)}>Cancelar</button>
            <button type="submit" disabled={workSubmit.saving}>{workSubmit.saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      </GlassModal>

      <IrpfModelo145Modal
        isOpen={irpfWizardOpen}
        onClose={() => setIrpfWizardOpen(false)}
        defaultAnnualGross={
          workForm.salario_bruto
            ? (workForm.periodicidad === "A" ? workForm.salario_bruto : workForm.salario_bruto * 14)
            : 0
        }
        defaultSsPct={workForm.ss_pct || 6.5}
        settings={settings}
        saveSetting={saveSetting}
        formatEUR={formatEUR}
        onApply={({ irpf_pct, ss_pct, appliesToCurrentJob, effective_from }) => {
          if (appliesToCurrentJob) {
            setWorkForm((p) => ({ ...p, irpf_pct, ss_pct }));
            addToast(`IRPF ${irpf_pct.toFixed(2)}% vigente desde ${effective_from}`, "success");
          } else {
            addToast(`Situación guardada desde ${effective_from} (no cambia el empleo actual aún)`, "info");
          }
        }}
      />
    </>
  );
}
