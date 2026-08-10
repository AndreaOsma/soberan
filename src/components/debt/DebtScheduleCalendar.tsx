import { useEffect, useMemo, useState } from "react";
import type { Debt, DebtInstallment } from "../../types";
import { MonthCalendarGrid, type CalendarGridEvent } from "../calendar/MonthCalendarGrid";
import { EmptyState } from "../EmptyState";
import { DebtScheduleEditorModal } from "../modals/DebtScheduleEditorModal";
import { installmentMatchesMonth, installmentStatus, debtHasPlanilla } from "../../utils/debtInstallments";

type Props = {
  debts: Debt[];
  installments: DebtInstallment[];
  formatEUR: (v: number) => string;
  onRefresh: () => void;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  initialDebtId?: number | null;
  openEditorForDebtId?: number | null;
  autocalculateOnOpen?: boolean;
  initialStartDate?: string | null;
  onEditorClose?: () => void;
  onOpenPayments?: (debt: Debt, installment?: DebtInstallment) => void;
};

export function DebtScheduleCalendar({
  debts,
  installments,
  formatEUR,
  onRefresh,
  addToast,
  initialDebtId = null,
  openEditorForDebtId = null,
  autocalculateOnOpen = false,
  initialStartDate = null,
  onEditorClose,
  onOpenPayments,
}: Props) {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [debtFilter, setDebtFilter] = useState<number | "all">(initialDebtId ?? "all");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [editorDebt, setEditorDebt] = useState<Debt | null>(null);
  const [editorAutocalc, setEditorAutocalc] = useState(false);

  useEffect(() => {
    if (initialDebtId != null) setDebtFilter(initialDebtId);
  }, [initialDebtId]);

  useEffect(() => {
    if (openEditorForDebtId == null) return;
    const d = debts.find((x) => x.id === openEditorForDebtId);
    if (d) {
      setEditorDebt(d);
      setEditorAutocalc(autocalculateOnOpen);
      setDebtFilter(openEditorForDebtId);
    }
  }, [openEditorForDebtId, autocalculateOnOpen, debts]);

  const activeDebts = useMemo(
    () => debts.filter((d) => d.monto_total - d.monto_pagado > 0),
    [debts],
  );

  const filteredInstallments = useMemo(() => {
    let list = installments.filter((i) => installmentMatchesMonth(i, month, year));
    if (debtFilter !== "all") list = list.filter((i) => i.debt_id === debtFilter);
    return list;
  }, [installments, month, year, debtFilter]);

  const debtById = useMemo(() => {
    const m = new Map<number, Debt>();
    for (const d of debts) m.set(d.id, d);
    return m;
  }, [debts]);

  const planillaByDebt = useMemo(() => {
    const m = new Map<number, DebtInstallment[]>();
    for (const inst of installments) {
      const list = m.get(inst.debt_id) ?? [];
      list.push(inst);
      m.set(inst.debt_id, list);
    }
    return m;
  }, [installments]);

  const gridEvents: CalendarGridEvent[] = useMemo(() =>
    filteredInstallments.map((inst) => {
      const debt = debtById.get(inst.debt_id);
      const planilla = planillaByDebt.get(inst.debt_id) ?? [];
      const status = debt ? installmentStatus(inst, debt, planilla) : installmentStatus(inst);
      const nombre = debt?.nombre || debt?.acreedor || "Deuda";
      return {
        key: `inst-${inst.id}`,
        fecha: inst.fecha_vencimiento,
        titulo: `${nombre} · cuota ${inst.numero_cuota}`,
        monto: inst.cuota_total,
        tipo: "deuda_cuota",
        seccion: status === "pagada" ? "Pagada" : status === "vencida" ? "Vencida" : "Pendiente",
        chipClass: status === "pagada"
          ? "cal-event--deuda cal-event-chip--paid"
          : status === "vencida"
            ? "cal-event--deuda cal-event-chip--overdue"
            : "cal-event--deuda",
        muted: status === "pagada",
      };
    }),
    [filteredInstallments, debtById, planillaByDebt],
  );

  const monthLabel = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" })
    .format(new Date(year, month - 1, 1))
    .replace(/^./, (c) => c.toUpperCase());

  const selectedInstallments = useMemo(() => {
    if (!selectedDay) return [];
    return filteredInstallments.filter((i) => i.fecha_vencimiento.slice(0, 10) === selectedDay);
  }, [selectedDay, filteredInstallments]);

  function adjustMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setMonth(d.getMonth() + 1);
    setYear(d.getFullYear());
    setSelectedDay(null);
  }

  function goToday() {
    setMonth(today.getMonth() + 1);
    setYear(today.getFullYear());
    setSelectedDay(null);
  }

  async function registerPayment(inst: DebtInstallment) {
    const debt = debtById.get(inst.debt_id);
    if (!debt || !onOpenPayments) return;
    onOpenPayments(debt, inst);
  }

  const editorTarget = editorDebt ?? (debtFilter !== "all" ? debtById.get(debtFilter) ?? null : activeDebts[0] ?? null);
  const editorTargetHasPlanilla = editorTarget ? debtHasPlanilla(installments, editorTarget.id) : false;

  function openEditor(debt: Debt, autocalc: boolean) {
    setEditorDebt(debt);
    setEditorAutocalc(autocalc);
    setDebtFilter(debt.id);
  }

  return (
    <article className="card card-wide debt-schedule-card">
      <div className="debt-schedule-header">
        <h2 style={{ margin: 0 }}>Planificador de pagos</h2>
        <div className="debt-schedule-header__actions">
          <label className="debt-schedule-filter">
            <span className="muted" style={{ fontSize: "0.78rem" }}>Deuda</span>
            <select value={debtFilter === "all" ? "all" : String(debtFilter)}
              onChange={(e) => {
                const v = e.target.value;
                setDebtFilter(v === "all" ? "all" : Number(v));
                setSelectedDay(null);
              }}>
              <option value="all">Todas las deudas</option>
              {activeDebts.map((d) => (
                <option key={d.id} value={d.id}>{d.nombre || d.acreedor}</option>
              ))}
            </select>
          </label>
          <button type="button" className="button-secondary" style={{ fontSize: "0.85rem" }}
            disabled={!editorTarget || debtFilter === "all"}
            title={debtFilter === "all" ? "Selecciona una deuda concreta" : undefined}
            onClick={() => editorTarget && openEditor(editorTarget, !editorTargetHasPlanilla)}>
            {debtFilter === "all"
              ? "Editar planilla"
              : editorTarget && !editorTargetHasPlanilla
                ? "Generar planilla"
                : `Editar planilla — ${editorTarget?.nombre || editorTarget?.acreedor}`}
          </button>
          {editorTarget && onOpenPayments && (
            <button type="button" className="button-secondary" style={{ fontSize: "0.85rem" }}
              title="Historial de pagos reales abonados"
              onClick={() => onOpenPayments(editorTarget)}>
              Pagos reales
            </button>
          )}
        </div>
      </div>

      <div className="cal-header" style={{ marginTop: "0.75rem" }}>
        <div className="cal-header__nav">
          <button type="button" className="cal-nav-btn" onClick={() => adjustMonth(-1)} aria-label="Mes anterior">←</button>
          <button type="button" className="cal-nav-btn" onClick={goToday} aria-label="Ir al mes actual">Hoy</button>
          <button type="button" className="cal-nav-btn" onClick={() => adjustMonth(1)} aria-label="Mes siguiente">→</button>
          <h3 className="cal-month-title">{monthLabel}</h3>
        </div>
      </div>

      {activeDebts.length === 0 ? (
        <EmptyState
          icon="🎉"
          title="Sin deudas activas"
          description="Cuando registres una deuda podrás cargar su planilla de pagos aquí."
        />
      ) : gridEvents.length === 0 ? (
        <EmptyState
          icon="📅"
          title="Sin cuotas este mes"
          description="No hay cuotas de planilla en este mes. Genera la planilla o navega a otro mes."
          actionLabel={editorTarget && !editorTargetHasPlanilla ? "Generar planilla" : "Editar planilla"}
          onAction={() => editorTarget && openEditor(editorTarget, !editorTargetHasPlanilla)}
        />
      ) : (
        <MonthCalendarGrid
          month={month}
          year={year}
          events={gridEvents}
          formatEUR={formatEUR}
          selectedDay={selectedDay}
          onDayClick={(ds) => setSelectedDay((prev) => (prev === ds ? null : ds))}
        />
      )}

      <div className="cal-legend" style={{ marginTop: "0.5rem" }}>
        <span className="cal-legend-item"><span className="cal-legend-dot cal-legend-dot--deuda" /> Pendiente</span>
        <span className="cal-legend-item"><span className="cal-legend-dot cal-event-chip--overdue-dot" /> Vencida</span>
        <span className="cal-legend-item"><span className="cal-legend-dot cal-legend-dot--paid" /> Pagada</span>
      </div>

      {selectedDay && (
        <div className="debt-day-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <h3 style={{ fontSize: "0.9rem", margin: 0 }}>
              {new Date(selectedDay + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </h3>
            <button type="button" className="button-secondary" style={{ fontSize: "0.75rem", padding: "0.2rem 0.45rem", flexShrink: 0 }}
              onClick={() => setSelectedDay(null)}>
              Cerrar
            </button>
          </div>
          {selectedInstallments.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.85rem" }}>Sin cuotas en este día.</p>
          ) : (
            <div className="debt-schedule-table-wrap">
              <table className="debt-schedule-table">
                <thead>
                  <tr>
                    <th>Nº</th>
                    <th>Deuda</th>
                    <th>Cuota</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInstallments.map((inst) => {
                    const debt = debtById.get(inst.debt_id);
                    const planilla = planillaByDebt.get(inst.debt_id) ?? [];
                    const status = debt ? installmentStatus(inst, debt, planilla) : installmentStatus(inst);
                    return (
                      <tr key={inst.id}>
                        <td>{inst.numero_cuota}</td>
                        <td>{debt?.nombre || debt?.acreedor || "—"}</td>
                        <td className="sensitive"><strong>{formatEUR(inst.cuota_total)}</strong></td>
                        <td>
                          <span className={`debt-inst-status debt-inst-status--${status}`}>
                            {status === "pagada" ? "Pagada" : status === "vencida" ? "Vencida" : "Pendiente"}
                          </span>
                        </td>
                        <td>
                          {status !== "pagada" && onOpenPayments && (
                            <button type="button" className="button-secondary" style={{ fontSize: "0.75rem", padding: "0.2rem 0.45rem" }}
                              onClick={() => registerPayment(inst)}>
                              Registrar pago
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editorDebt && (
        <DebtScheduleEditorModal
          key={`${editorDebt.id}-${editorAutocalc ? "auto" : "manual"}-${initialStartDate ?? ""}`}
          debt={editorDebt}
          installments={installments.filter((i) => i.debt_id === editorDebt.id)}
          autocalculateOnOpen={editorAutocalc}
          initialStartDate={initialStartDate ?? undefined}
          onClose={() => {
            setEditorDebt(null);
            setEditorAutocalc(false);
            onEditorClose?.();
          }}
          onSaved={onRefresh}
          addToast={addToast}
        />
      )}
    </article>
  );
}
