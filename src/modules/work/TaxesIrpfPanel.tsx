import { useState, useEffect } from "react";
import { api } from "../../services/api";
import { GlassModal } from "../../components/GlassModal";
import { IrpfModelo145Modal } from "../../components/modals/IrpfModelo145Modal";
import { parseJsonValue, parseNum } from "../../utils/format";
import { activeAccounts } from "../../utils/payrollAccount";
import { useNotify } from "../../hooks/useNotify";
import { irpfForJobMonths, parseIrpfModelo145Store } from "../../utils/irpfModelo145History";
import { calcIrpfWithholdingGap } from "../../utils/irpfWithholdingGap";
import type { Account, SalaryBreakdown, WorkHistory } from "../../types";

type ActiveSalary = {
  empresa: string; bruto: number; irpf: number; ss: number;
  neto: number; irpf_pct: number; ss_pct: number;
} | null;

export type TaxesIrpfPanelProps = {
  year: number;
  workHistory: WorkHistory[];
  accounts: Account[];
  settings: Record<string, string>;
  activeSalary: ActiveSalary;
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  saveSetting: (key: string, val: string) => Promise<void>;
  onNavigateToHistorialLaboral: () => void;
};

function calcIrpfOweado(brutoAnual: number, ssAnual: number): number {
  const rendNeto = brutoAnual - ssAnual;
  const reducTrabajo = rendNeto <= 14_047.5 ? 6_498
    : rendNeto <= 19_747.5 ? 6_498 - 1.14 * (rendNeto - 14_047.5)
    : 2_000;
  const baseLiquidable = Math.max(0, rendNeto - reducTrabajo - 5_550);
  const tramos: [number, number][] = [[12_450, 0.19],[7_750, 0.24],[15_000, 0.30],[24_800, 0.37],[240_000, 0.45],[Infinity, 0.47]];
  let tax = 0, rem = baseLiquidable;
  for (const [width, rate] of tramos) {
    if (rem <= 0) break;
    tax += Math.min(rem, width) * rate;
    rem -= width;
  }
  return tax;
}

export function TaxesIrpfPanel({
  year, workHistory, accounts, settings, activeSalary,
  formatEUR, addToast, loadAll, saveSetting, onNavigateToHistorialLaboral,
}: TaxesIrpfPanelProps) {
  const [taxCompany, setTaxCompany] = useState("");
  const [taxGrossAnnual, setTaxGrossAnnual] = useState(0);
  const [taxPagas, setTaxPagas] = useState(14);
  const [taxSSPct, setTaxSSPct] = useState(6.5);
  const [taxContractType, setTaxContractType] = useState("indefinido");
  const [taxPersonalMin, setTaxPersonalMin] = useState(5550);
  const [taxWorkExpense, setTaxWorkExpense] = useState(2000);
  const [payrollPreview, setPayrollPreview] = useState<Record<string, unknown> | null>(null);
  const [reconcileMonth, setReconcileMonth] = useState(new Date().getMonth() + 1);
  const [reconcileData, setReconcileData] = useState<Record<string, unknown> | null>(null);
  const [reconcilePick, setReconcilePick] = useState<number | null>(null);
  const [salaryPlanValues, setSalaryPlanValues] = useState<Record<number, number>>({});
  const [yearBreakdowns, setYearBreakdowns] = useState<SalaryBreakdown[]>([]);
  const [rentaForm, setRentaForm] = useState({ mes: new Date().getMonth() + 1, empresa: "", bruto: "", irpf_pct: "", ss_pct: "", neto: "" });
  const [isRentaFormOpen, setIsRentaFormOpen] = useState(false);
  const [irpfWizardOpen, setIrpfWizardOpen] = useState(false);
  const [irpfWizardJobId, setIrpfWizardJobId] = useState<number | null>(null);

  const { busy: formBusy, notifyAfter } = useNotify({ addToast, loadAll });

  const activeJob = workHistory.find((w) => !w.fecha_fin && Number(w.salario_bruto || 0) > 0) ?? null;
  const activeJobAnnual = activeJob
    ? (activeJob.periodicidad === "A" ? Number(activeJob.salario_bruto) : Number(activeJob.salario_bruto) * 14)
    : taxGrossAnnual;

  useEffect(() => {
    api.getSalaryBreakdownYear(year).then(setYearBreakdowns).catch(() => setYearBreakdowns([]));
  }, [year]);

  function calcMonthsInYear(fechaInicio: string, fechaFin: string | null | undefined): number {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59);
    const jobStart = new Date(fechaInicio);
    const jobEnd = fechaFin ? new Date(fechaFin) : new Date();
    const overlapStart = new Date(Math.max(jobStart.getTime(), yearStart.getTime()));
    const overlapEnd = new Date(Math.min(jobEnd.getTime(), yearEnd.getTime()));
    if (overlapStart > overlapEnd) return 0;
    const sm = overlapStart.getFullYear() * 12 + overlapStart.getMonth();
    const em = overlapEnd.getFullYear() * 12 + overlapEnd.getMonth();
    return em - sm + 1;
  }

  const irpf145Store = parseIrpfModelo145Store(settings.irpf_modelo145);

  const salaryEntries = workHistory.filter(w => w.salario_bruto && Number(w.salario_bruto) > 0);
  const rows = salaryEntries.map(w => {
    const brutoMensual = w.periodicidad === "A" ? Number(w.salario_bruto!) / 12 : Number(w.salario_bruto!);
    const hist = irpfForJobMonths({
      store: irpf145Store,
      jobId: w.id,
      brutoMensual,
      ssPctFallback: Number(w.ss_pct) || 0,
      irpfPctFallback: Number(w.irpf_pct) || 0,
      year,
      fechaInicio: w.fecha_inicio,
      fechaFin: w.fecha_fin,
    });
    const meses = hist.meses || calcMonthsInYear(w.fecha_inicio, w.fecha_fin);
    const irpfMes = meses > 0 ? hist.irpfAnual / meses : 0;
    const ssMes = meses > 0 ? hist.ssAnual / meses : 0;
    const netoMes = brutoMensual - irpfMes - ssMes;
    const periodoLabel = (() => {
      const ini = new Date(w.fecha_inicio).toLocaleDateString("es", { month: "short", year: "numeric" });
      const fin = w.fecha_fin
        ? new Date(w.fecha_fin).toLocaleDateString("es", { month: "short", year: "numeric" })
        : "actualidad";
      return `${ini} – ${fin}`;
    })();
    const avgIrpfPct = brutoMensual > 0 ? (irpfMes / brutoMensual) * 100 : Number(w.irpf_pct) || 0;
    return {
      ...w,
      brutoMensual,
      meses,
      brutoAnual: hist.brutoAnual || brutoMensual * meses,
      irpfMes,
      ssMes,
      irpfAnual: hist.irpfAnual,
      ssAnual: hist.ssAnual,
      netoMes,
      netoAnual: hist.netoAnual || netoMes * meses,
      periodoLabel,
      avgIrpfPct,
    };
  }).filter(r => r.meses > 0);

  const totalBruto = rows.reduce((s, r) => s + r.brutoAnual, 0);
  const totalIrpf = rows.reduce((s, r) => s + r.irpfAnual, 0);
  const totalSS = rows.reduce((s, r) => s + r.ssAnual, 0);
  const totalNeto = rows.reduce((s, r) => s + r.netoAnual, 0);
  const weightedIrpfPct = totalBruto > 0 ? (totalIrpf / totalBruto) * 100 : 0;

  const payrollCompanyConfig = parseJsonValue<Record<string, unknown>>(settings.payroll_company_config ?? null, {});

  const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  const totalBrutoReal = yearBreakdowns.reduce((s, r) => s + r.bruto, 0);
  const totalIrpfRetenido = yearBreakdowns.reduce((s, r) => s + r.irpf, 0);
  const totalSSReal = yearBreakdowns.reduce((s, r) => s + r.ss, 0);
  const totalNetoReal = yearBreakdowns.reduce((s, r) => s + r.neto, 0);
  const irpfOweado = totalBrutoReal > 0 ? calcIrpfOweado(totalBrutoReal, totalSSReal) : 0;
  const deltaRenta = totalIrpfRetenido - irpfOweado;
  const withholdingGap = calcIrpfWithholdingGap({
    year,
    breakdowns: yearBreakdowns,
    workHistory,
    store: irpf145Store,
  });
  const mesActual = new Date().getMonth() + 1;
  const mesesPendientes = year === new Date().getFullYear()
    ? Array.from({ length: 12 - mesActual }, (_, i) => mesActual + 1 + i)
    : [];

  const rentaSection = (
    <article className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2>Nóminas reales · {year}</h2>
        <button
          type="button"
          onClick={() => {
            setRentaForm({
              mes: new Date().getMonth() + 1,
              empresa: activeSalary?.empresa || "",
              bruto: "",
              irpf_pct: activeSalary ? String(activeSalary.irpf_pct) : "",
              ss_pct: activeSalary ? String(activeSalary.ss_pct) : "6.35",
              neto: "",
            });
            setIsRentaFormOpen(true);
          }}
        >
          + Añadir nómina
        </button>
      </div>

      <GlassModal
        isOpen={isRentaFormOpen}
        onClose={() => setIsRentaFormOpen(false)}
        title={`Añadir nómina · ${year}`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void notifyAfter(async () => {
              const b = parseNum(rentaForm.bruto);
              const irpfPct = parseNum(rentaForm.irpf_pct);
              const ssPct = parseNum(rentaForm.ss_pct);
              const irpfAmt = rentaForm.neto ? b - parseNum(rentaForm.neto) - b * ssPct / 100 : b * irpfPct / 100;
              const ssAmt = b * ssPct / 100;
              const neto = rentaForm.neto ? parseNum(rentaForm.neto) : b - irpfAmt - ssAmt;
              const empresa = rentaForm.empresa || "knowmad mood";
              const cfg = payrollCompanyConfig[empresa.toLowerCase()] as { account_id?: number } | undefined;
              const accountId = cfg?.account_id ?? accounts[0]?.id ?? null;
              await api.upsertSalaryBreakdown({
                mes: rentaForm.mes,
                anio: year,
                empresa,
                bruto: b,
                irpf: irpfAmt,
                ss: ssAmt,
                neto,
                account_id: accountId,
              });
              api.getSalaryBreakdownYear(year).then(setYearBreakdowns).catch(() => {});
              setIsRentaFormOpen(false);
            }, "Nómina registrada.", "No se pudo guardar.");
          }}
        >
          <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
            <label>Mes
              <select value={rentaForm.mes} onChange={e => setRentaForm(p => ({ ...p, mes: Number(e.target.value) }))}>
                {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </label>
            <label>Empresa
              <input value={rentaForm.empresa} placeholder="knowmad mood" onChange={e => setRentaForm(p => ({ ...p, empresa: e.target.value }))} />
            </label>
            <label>Bruto (€)
              <input type="text" inputMode="decimal" value={rentaForm.bruto} onChange={e => setRentaForm(p => ({ ...p, bruto: e.target.value }))} required />
            </label>
            <label>IRPF (%)
              <input type="text" inputMode="decimal" value={rentaForm.irpf_pct} placeholder="15" onChange={e => setRentaForm(p => ({ ...p, irpf_pct: e.target.value }))} />
            </label>
            <label>SS (%)
              <input type="text" inputMode="decimal" value={rentaForm.ss_pct} placeholder="6.35" onChange={e => setRentaForm(p => ({ ...p, ss_pct: e.target.value }))} />
            </label>
            <label>Neto real (€)
              <input type="text" inputMode="decimal" value={rentaForm.neto} placeholder="opcional" onChange={e => setRentaForm(p => ({ ...p, neto: e.target.value }))} />
            </label>
          </div>
          <p className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.75rem" }}>
            Si hay cuenta configurada en Plan nómina (o alguna cuenta), se crea también el movimiento de ingreso.
          </p>
          <div className="modal-actions">
            <button type="button" className="button-secondary" onClick={() => setIsRentaFormOpen(false)}>Cancelar</button>
            <button type="submit" disabled={formBusy}>{formBusy ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      </GlassModal>

      {yearBreakdowns.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>Sin nóminas reales registradas para {year}. Usa «+ Añadir nómina».</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Mes</th><th>Empresa</th><th>Bruto</th><th>IRPF ret.</th><th>SS</th><th>Neto real</th></tr>
              </thead>
              <tbody>
                {yearBreakdowns.map(r => (
                  <tr key={r.id}>
                    <td>{MESES[(r.mes ?? 1) - 1]}</td>
                    <td className="muted">{r.empresa}</td>
                    <td className="sensitive">{formatEUR(r.bruto)}</td>
                    <td className="negative sensitive">{formatEUR(r.irpf)}</td>
                    <td className="negative sensitive">{formatEUR(r.ss)}</td>
                    <td className="positive sensitive">{formatEUR(r.neto)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 600, borderTop: "2px solid var(--border-soft)" }}>
                  <td colSpan={2}>Total ({yearBreakdowns.length} meses)</td>
                  <td className="sensitive">{formatEUR(totalBrutoReal)}</td>
                  <td className="negative sensitive">{formatEUR(totalIrpfRetenido)}</td>
                  <td className="negative sensitive">{formatEUR(totalSSReal)}</td>
                  <td className="positive sensitive">{formatEUR(totalNetoReal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{ marginTop: "1.25rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
            {[
              { label: "IRPF retenido (real)", value: totalIrpfRetenido, cls: "negative" },
              { label: `IRPF adeudado (tramos ${year})`, value: irpfOweado, cls: "negative" },
              { label: deltaRenta >= 0 ? "Devolución estimada" : "A pagar en la renta", value: Math.abs(deltaRenta), cls: deltaRenta >= 0 ? "positive" : "negative" },
            ].map(({ label, value, cls }) => (
              <div key={label} style={{ padding: "0.875rem 1rem", background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "0.625rem" }}>
                <p className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.25rem" }}>{label}</p>
                <strong className={`sensitive ${cls}`} style={{ fontSize: "1.25rem" }}>
                  {deltaRenta >= 0 && label.includes("Devolución") ? "+" : deltaRenta < 0 && label.includes("pagar") ? "-" : ""}{formatEUR(value)}
                </strong>
              </div>
            ))}
            {withholdingGap.hasExpectedRate && (
              <div style={{ padding: "0.875rem 1rem", background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "0.625rem" }}>
                <p className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.25rem" }}>
                  {withholdingGap.gapReten >= 0 ? "Empresa retiene de más" : "Empresa retiene de menos"}
                </p>
                <strong
                  className={`sensitive ${withholdingGap.gapReten >= 0 ? "positive" : "negative"}`}
                  style={{ fontSize: "1.25rem" }}
                >
                  {withholdingGap.gapReten >= 0 ? "+" : "−"}{formatEUR(Math.abs(withholdingGap.gapReten))}
                </strong>
                <p className="muted" style={{ fontSize: "0.72rem", marginTop: "0.35rem" }}>
                  {withholdingGap.pctReal.toFixed(1)}% real vs {withholdingGap.pctExpected.toFixed(1)}% esperado
                </p>
              </div>
            )}
          </div>

          {withholdingGap.monthsCompared > 0 && (
            <div
              role="status"
              style={{
                marginTop: "0.85rem",
                padding: "0.75rem 0.9rem",
                borderRadius: "0.625rem",
                border: `1px solid ${
                  withholdingGap.outcomeHint === "aligned"
                    ? "var(--glass-border)"
                    : withholdingGap.outcomeHint === "refund_likely"
                      ? "color-mix(in srgb, #22c55e 45%, var(--glass-border))"
                      : withholdingGap.outcomeHint === "pay_likely"
                        ? "color-mix(in srgb, #ef4444 45%, var(--glass-border))"
                        : "var(--glass-border)"
                }`,
                background: "var(--glass-bg)",
                fontSize: "0.85rem",
                lineHeight: 1.45,
              }}
            >
              <strong style={{ display: "block", marginBottom: "0.2rem" }}>
                Retención empresa vs Modelo 145 / empleo
              </strong>
              {withholdingGap.summary}
              {withholdingGap.hasExpectedRate && (
                <span className="muted" style={{ display: "block", marginTop: "0.35rem", fontSize: "0.78rem" }}>
                  Neto real {formatEUR(withholdingGap.netoReal)} vs neto esperado {formatEUR(withholdingGap.netoExpected)}
                  {" "}({withholdingGap.gapNeto >= 0 ? "+" : "−"}{formatEUR(Math.abs(withholdingGap.gapNeto))}).
                  {" "}Esto anticipa si la renta del año que viene sale a devolver o a pagar; el cuadro de arriba usa tramos fiscales sobre lo ya retenido.
                </span>
              )}
            </div>
          )}

          {mesesPendientes.length > 0 && (
            <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
              Datos parciales — faltan {mesesPendientes.map(m => MESES[m-1]).join(", ")}. La proyección mejora al introducir todas las nóminas.
            </p>
          )}
          <p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.35rem" }}>
            Tramos IRPF Madrid 2025 · mínimo personal €5.550 · reducción trabajo variable. Solo rendimientos del trabajo. Consulta a un asesor fiscal para tu caso exacto.
          </p>
        </>
      )}
    </article>
  );

  const irpfSection = (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <h2 style={{ margin: 0 }}>IRPF por empleo · {year}</h2>
        {activeJob && (
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setIrpfWizardJobId(activeJob.id);
              setIrpfWizardOpen(true);
            }}
          >
            Autocalcular · {activeJob.empresa}
          </button>
        )}
      </div>
      {salaryEntries.length === 0 ? (
        <article className="card">
          <div className="empty-state">
            <div className="empty-state-icon">💼</div>
            <h3>Sin datos salariales</h3>
            <p>Añade tus empleos con salario bruto e IRPF en Historial Laboral. Cada experiencia tiene su propio %.</p>
            <button onClick={onNavigateToHistorialLaboral}>Ir a Historial Laboral</button>
          </div>
        </article>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem" }}>
            {[
              { label: "Bruto anual (empleos)", value: totalBruto, cls: "" },
              { label: `IRPF retenido (~${weightedIrpfPct.toFixed(1)}%)`, value: totalIrpf, cls: "negative" },
              { label: "SS trabajador", value: totalSS, cls: "negative" },
              { label: "Neto anual (empleos)", value: totalNeto, cls: "positive" },
            ].map(({ label, value, cls }) => (
              <div key={label} style={{ padding: "0.875rem 1rem", background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "0.625rem" }}>
                <p className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.25rem" }}>{label}</p>
                <strong className={`sensitive ${cls}`} style={{ fontSize: "1.25rem" }}>{formatEUR(value)}</strong>
              </div>
            ))}
          </div>

          <article className="card">
            <h2>Desglose por experiencia laboral · {year}</h2>
            <p className="muted" style={{ fontSize: "0.8rem" }}>
              Cada fila usa el IRPF de ese empleo (histórico Modelo 145 del puesto o el % guardado en la experiencia).
              No se aplica un estimado global a todos los trabajos.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Empresa</th><th>Periodo</th><th>Meses</th><th>Bruto/mes</th>
                    <th>IRPF%</th><th>Bruto año</th><th>IRPF año</th><th>Neto año</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.empresa}</td>
                      <td className="muted" style={{ fontSize: "0.8rem" }}>{r.periodoLabel}</td>
                      <td>{r.meses}</td>
                      <td className="sensitive">{formatEUR(r.brutoMensual)}</td>
                      <td>{Number(r.avgIrpfPct || 0).toFixed(1)}%</td>
                      <td className="sensitive">{formatEUR(r.brutoAnual)}</td>
                      <td className="negative sensitive">{formatEUR(r.irpfAnual)}</td>
                      <td className="positive sensitive">{formatEUR(r.netoAnual)}</td>
                      <td>
                        <button
                          type="button"
                          className="button-secondary"
                          style={{ padding: "0.2rem 0.45rem", fontSize: "0.75rem", whiteSpace: "nowrap" }}
                          onClick={() => {
                            setIrpfWizardJobId(r.id);
                            setIrpfWizardOpen(true);
                          }}
                        >
                          Autocalcular
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border-soft)", fontWeight: 600 }}>
                    <td colSpan={5}>Total</td>
                    <td className="sensitive">{formatEUR(totalBruto)}</td>
                    <td className="negative sensitive">{formatEUR(totalIrpf)}</td>
                    <td className="positive sensitive">{formatEUR(totalNeto)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </article>
        </>
      )}
    </>
  );

  return (
    <section className="grid">
      {rentaSection}
      <hr style={{ border: "none", borderTop: "1px solid var(--border-soft)", margin: "0.5rem 0" }} />
      {irpfSection}
      <hr style={{ border: "none", borderTop: "1px solid var(--border-soft)", margin: "0.5rem 0" }} />
      <h2 style={{ margin: "0 0 0.75rem" }}>Simulador de nómina</h2>
      <div className="grid two-col">
        <form className="card" onSubmit={(event) => {
          event.preventDefault();
          void notifyAfter(async () => {
            const result = await api.getPayrollEstimate({
              bruto_mensual: taxGrossAnnual / taxPagas,
              pagas: taxPagas,
              ss_pct: taxSSPct,
              contract_type: taxContractType,
              personal_minimum: taxPersonalMin,
              work_expense: taxWorkExpense
            });
            setPayrollPreview(result);
            const net = Number(result.neto_estimado || 0);
            const init: Record<number, number> = {};
            for (let mm = 1; mm <= 12; mm += 1) {
              const multiplier = taxPagas === 14 && (mm === 6 || mm === 12) ? 2 : 1;
              init[mm] = Number((net * multiplier).toFixed(2));
            }
            setSalaryPlanValues(init);
          }, "Cálculo de nómina generado.", "No se pudo calcular nómina.");
        }}>
          <h2>Plan nómina anual</h2>
          <label>Empresa<input value={taxCompany} onChange={(e) => setTaxCompany(e.target.value)} required /></label>
          <label>
            Cuenta destino nómina
            <select
              value={String((payrollCompanyConfig[taxCompany.toLowerCase()] as { account_id?: number } | undefined)?.account_id ?? "")}
              onChange={(e) => {
                const key = taxCompany.toLowerCase();
                const prev = payrollCompanyConfig[key] as Record<string, unknown> | undefined;
                const next = { ...payrollCompanyConfig, [key]: { ...(prev || {}), account_id: e.target.value ? Number(e.target.value) : undefined } };
                void saveSetting("payroll_company_config", JSON.stringify(next));
              }}
            >
              <option value="">—</option>
              {activeAccounts(accounts).map((acc) => (
                <option key={acc.id} value={acc.id}>{acc.alias_real}</option>
              ))}
            </select>
          </label>
          <label>
            Modo cobro empresa
            <select
              value={String((payrollCompanyConfig[taxCompany.toLowerCase()] as { income_mode?: string } | undefined)?.income_mode || "fixed")}
              onChange={(e) => {
                const key = taxCompany.toLowerCase();
                const prev = payrollCompanyConfig[key] as Record<string, unknown> | undefined;
                const next = { ...payrollCompanyConfig, [key]: { ...(prev || {}), income_mode: e.target.value } };
                void saveSetting("payroll_company_config", JSON.stringify(next));
              }}
            >
              <option value="fixed">Día fijo</option>
              <option value="penultimate">Penúltimo día</option>
            </select>
          </label>
          <label>Bruto anual<input type="number" value={taxGrossAnnual} onChange={(e) => setTaxGrossAnnual(parseNum(e.target.value))} required /></label>
          <label>Pagas<select value={taxPagas} onChange={(e) => setTaxPagas(Number(e.target.value))}><option value={12}>12</option><option value={14}>14</option></select></label>
          <label>Contrato<select value={taxContractType} onChange={(e) => setTaxContractType(e.target.value)}><option value="indefinido">Indefinido</option><option value="temporal">Temporal</option></select></label>
          <label>SS trabajador (%)<input type="number" step="0.05" value={taxSSPct} onChange={(e) => setTaxSSPct(parseNum(e.target.value))} /></label>
          <label>Mínimo personal<input type="number" value={taxPersonalMin} onChange={(e) => setTaxPersonalMin(parseNum(e.target.value))} /></label>
          <label>Gasto deducible trabajo<input type="number" value={taxWorkExpense} onChange={(e) => setTaxWorkExpense(parseNum(e.target.value))} /></label>
          <button type="submit">Calcular</button>
        </form>

        <article className="card">
          <h2>Resultado y guardado</h2>
          {!payrollPreview ? <p className="muted">Sin cálculo todavía.</p> : null}
          {payrollPreview ? (
            <>
              <ul className="list">
                <li><span>Neto por paga estimado</span><strong className="sensitive">{formatEUR(Number(payrollPreview.neto_estimado || 0))}</strong></li>
                <li><span>IRPF (%)</span><strong>{Number(payrollPreview.irpf_pct || 0).toFixed(2)}%</strong></li>
                <li><span>SS (%)</span><strong>{Number(payrollPreview.ss_pct || 0).toFixed(2)}%</strong></li>
              </ul>
              <h3>Editor neto mensual</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Mes</th><th>Neto asignado (€)</th></tr></thead>
                  <tbody>
                    {Array.from({ length: 12 }, (_, idx) => idx + 1).map((m) => (
                      <tr key={`pay-plan-${m}`}>
                        <td>{m}</td>
                        <td>
                          <input type="number" value={salaryPlanValues[m] ?? 0}
                            onChange={(e) => setSalaryPlanValues((prev) => ({ ...prev, [m]: parseNum(e.target.value) }))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={() => void notifyAfter(async () => {
                const bruto = Number(payrollPreview.bruto_mensual || 0);
                const irpf = Number(payrollPreview.irpf_amount || 0);
                const ss = Number(payrollPreview.ss_amount || 0);
                const companyKey = taxCompany.toLowerCase();
                const accountId = (payrollCompanyConfig[companyKey] as { account_id?: number } | undefined)?.account_id ?? accounts[0]?.id ?? null;
                const savedRows: SalaryBreakdown[] = [];
                for (let m = 1; m <= 12; m += 1) {
                  const payload = { mes: m, anio: year, bruto, irpf, ss, neto: Number(salaryPlanValues[m] ?? 0), empresa: taxCompany, account_id: accountId };
                  const saved = await api.upsertSalaryBreakdown(payload);
                  savedRows.push(saved);
                }
                addToast(`Nóminas guardadas: ${savedRows.length}`, "success");
              }, "Plan mensual guardado.", "No se pudo guardar plan.")}>
                Guardar neto mes a mes
              </button>
            </>
          ) : null}
        </article>

        <article className="card card-wide">
          <h2>Conciliación automática con banco</h2>
          <label>Mes a analizar
            <select value={reconcileMonth} onChange={(e) => setReconcileMonth(Number(e.target.value) || 1)}>
              {Array.from({ length: 12 }, (_, idx) => idx + 1).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void notifyAfter(async () => {
            if (!taxCompany.trim()) throw new Error("Indica empresa para conciliar.");
            const result = await api.getSalaryReconcile(reconcileMonth, year, taxCompany);
            setReconcileData(result);
            const candidates = (result.candidates as Array<{ id: number }> | undefined) || [];
            setReconcilePick(candidates[0]?.id ?? null);
          }, "Búsqueda de conciliación completada.", "No se pudo buscar conciliación.")}>
            Buscar movimientos
          </button>
          {reconcileData ? (
            <>
              {"message" in reconcileData ? <p className="muted">{String(reconcileData.message || "")}</p> : null}
              <p>Neto esperado: <strong>{formatEUR(Number(reconcileData.expected_neto || 0))}</strong></p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>ID</th><th>Fecha</th><th>Importe</th><th>Descripción</th><th>Score</th></tr></thead>
                  <tbody>
                    {((reconcileData.candidates as Array<Record<string, unknown>> | undefined) || []).map((row) => (
                      <tr key={String(row.id)}>
                        <td>{String(row.id)}</td>
                        <td>{String(row.date || "").slice(0, 10)}</td>
                        <td>{formatEUR(Number(row.amount || 0))}</td>
                        <td>{String(row.description_raw || "")}</td>
                        <td>{String(row.score || "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label>Movimiento elegido
                <input type="number" value={reconcilePick ?? 0} onChange={(e) => setReconcilePick(Number(e.target.value) || null)} />
              </label>
              <button type="button" onClick={() => void notifyAfter(async () => {
                if (!reconcilePick) throw new Error("Selecciona movimiento para registrar.");
                await api.markSalaryReconcile({ mes: reconcileMonth, anio: year, empresa: taxCompany, transaction_id: reconcilePick });
              }, "Conciliación registrada.", "No se pudo registrar conciliación.")}>
                Registrar conciliación
              </button>
            </>
          ) : (
            <p className="muted">Sin búsqueda ejecutada.</p>
          )}
        </article>
      </div>

      <IrpfModelo145Modal
        isOpen={irpfWizardOpen}
        onClose={() => {
          setIrpfWizardOpen(false);
          setIrpfWizardJobId(null);
        }}
        jobId={irpfWizardJobId ?? activeJob?.id ?? null}
        jobLabel={
          (irpfWizardJobId != null
            ? workHistory.find((w) => w.id === irpfWizardJobId)?.empresa
            : activeJob?.empresa) || undefined
        }
        defaultAnnualGross={(() => {
          const job = irpfWizardJobId != null
            ? workHistory.find((w) => w.id === irpfWizardJobId)
            : activeJob;
          if (!job?.salario_bruto) return activeJobAnnual || 0;
          return job.periodicidad === "A" ? Number(job.salario_bruto) : Number(job.salario_bruto) * 14;
        })()}
        defaultSsPct={Number(
          (irpfWizardJobId != null
            ? workHistory.find((w) => w.id === irpfWizardJobId)?.ss_pct
            : activeJob?.ss_pct) || taxSSPct || 6.5,
        )}
        settings={settings}
        saveSetting={saveSetting}
        formatEUR={formatEUR}
        onApply={({ irpf_pct, ss_pct, appliesToCurrentJob, effective_from, job_id }) => {
          const targetId = job_id ?? irpfWizardJobId ?? activeJob?.id;
          const target = targetId != null ? workHistory.find((w) => w.id === targetId) : null;
          if (!target) {
            setTaxSSPct(ss_pct);
            addToast(`Situación Modelo 145 guardada desde ${effective_from}.`, "success");
            return;
          }
          if (!appliesToCurrentJob) {
            addToast(`Guardado desde ${effective_from}: no cambia el % de ${target.empresa} (fecha futura).`, "info");
            return;
          }
          void notifyAfter(async () => {
            await api.updateWorkHistory(target.id, {
              ...target,
              irpf_pct,
              ss_pct,
            });
            setTaxSSPct(ss_pct);
          }, `IRPF ${irpf_pct.toFixed(2)}% aplicado a ${target.empresa} desde ${effective_from}.`, "No se pudo guardar el IRPF.");
        }}
      />
    </section>
  );
}
