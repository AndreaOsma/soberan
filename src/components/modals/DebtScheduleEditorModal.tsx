import { useMemo, useState } from "react";
import type { Debt, DebtInstallment } from "../../types";
import { api } from "../../services/api";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../ModalFormError";
import { EditModalShell } from "../EditModalShell";
import { EmptyState } from "../EmptyState";
import { parseNum } from "../../utils/format";
import {
  defaultScheduleStartDate,
  enrichInstallmentRows,
  generateAmortizationSchedule,
  scheduleMaturityDate,
  simpleRowStatus,
  type AmortizationScheduleRow,
  type SimpleInstallmentRow,
} from "../../utils/debtInstallments";

type Row = {
  key: string;
  numero_cuota: string;
  fecha_vencimiento: string;
  cuota_total: string;
};

function emptyRow(n = 1): Row {
  return {
    key: `new-${Date.now()}-${Math.random()}`,
    numero_cuota: String(n),
    fecha_vencimiento: "",
    cuota_total: "",
  };
}

function fromInstallment(inst: DebtInstallment): Row {
  return {
    key: `inst-${inst.id}`,
    numero_cuota: String(inst.numero_cuota),
    fecha_vencimiento: inst.fecha_vencimiento.slice(0, 10),
    cuota_total: String(inst.cuota_total),
  };
}

function scheduleToRows(schedule: AmortizationScheduleRow[]): Row[] {
  const stamp = Date.now();
  return schedule.map((s, i) => ({
    key: `gen-${stamp}-${i}`,
    numero_cuota: String(s.numero_cuota),
    fecha_vencimiento: s.fecha_vencimiento,
    cuota_total: String(s.cuota_total),
  }));
}

function toSimpleRows(rows: Row[]): SimpleInstallmentRow[] {
  return rows.map((row) => ({
    numero_cuota: parseInt(row.numero_cuota, 10) || 1,
    fecha_vencimiento: row.fecha_vencimiento,
    cuota_total: parseNum(row.cuota_total),
  }));
}

function tryAutogenerateRows(
  debt: Debt,
  startDate: string,
): { rows: Row[] | null; error: string | null } {
  if (Number(debt.cuota_mensual) <= 0) {
    return { rows: null, error: "Indica la cuota mensual en la ficha de la deuda antes de autocalcular." };
  }
  if (!startDate) {
    return { rows: null, error: "Indica la fecha de la primera cuota." };
  }
  try {
    const schedule = generateAmortizationSchedule(debt, { startDate });
    if (schedule.length === 0) {
      return { rows: null, error: "No hay saldo pendiente que amortizar." };
    }
    return { rows: scheduleToRows(schedule), error: null };
  } catch (err) {
    return {
      rows: null,
      error: err instanceof Error ? err.message : "No se pudo autocalcular la planilla.",
    };
  }
}

function buildInitialRows(
  debt: Debt,
  installments: DebtInstallment[],
  autocalculateOnOpen: boolean,
  startDate: string,
): { rows: Row[]; error: string | null } {
  if (installments.length > 0 && !autocalculateOnOpen) {
    return { rows: installments.map(fromInstallment), error: null };
  }
  if (autocalculateOnOpen) {
    const gen = tryAutogenerateRows(debt, startDate);
    if (gen.rows) return { rows: gen.rows, error: null };
    return { rows: [emptyRow(1)], error: gen.error };
  }
  if (installments.length > 0) {
    return { rows: installments.map(fromInstallment), error: null };
  }
  return { rows: [emptyRow(1)], error: null };
}

interface Props {
  debt: Debt;
  installments: DebtInstallment[];
  onClose: () => void;
  onSaved: () => void;
  autocalculateOnOpen?: boolean;
  initialStartDate?: string;
  addToast?: (msg: string, type: "success" | "error" | "info") => void;
}

export function DebtScheduleEditorModal({
  debt,
  installments,
  onClose,
  onSaved,
  autocalculateOnOpen = false,
  initialStartDate,
  addToast,
}: Props) {
  const [startDate, setStartDate] = useState(
    () => initialStartDate ?? defaultScheduleStartDate(debt),
  );
  const initial = buildInitialRows(debt, installments, autocalculateOnOpen, startDate);
  const { saving, error, run } = useAsyncSubmit();
  const [rows, setRows] = useState<Row[]>(initial.rows);
  const [genError, setGenError] = useState<string | null>(initial.error);

  const pending = debt.monto_total - debt.monto_pagado;
  const fmt = useMemo(
    () => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }),
    [],
  );
  const hasInterest = Number(debt.tasa_anual) > 0;

  const simpleSorted = useMemo(() => {
    const simple = toSimpleRows(rows.filter((r) => r.fecha_vencimiento && r.cuota_total));
    return [...simple].sort(
      (a, b) =>
        a.fecha_vencimiento.localeCompare(b.fecha_vencimiento) || a.numero_cuota - b.numero_cuota,
    );
  }, [rows]);

  const enrichedPreview = useMemo(
    () => (simpleSorted.length > 0 ? enrichInstallmentRows(debt, simpleSorted) : []),
    [debt, simpleSorted],
  );

  const setRow = (key: string, patch: Partial<Row>) => {
    setGenError(null);
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  function autocalculate(forceReplace = false) {
    setGenError(null);
    const hasContent = rows.some((r) => r.fecha_vencimiento || r.cuota_total);
    if (hasContent && !forceReplace) {
      const ok = window.confirm(
        "¿Sustituir la planilla actual? Se perderán las filas que hayas editado manualmente.",
      );
      if (!ok) return;
    }
    const gen = tryAutogenerateRows(debt, startDate);
    if (gen.rows) {
      setRows(gen.rows);
    } else {
      setGenError(gen.error);
    }
  }

  return (
    <EditModalShell title={`Planilla — ${debt.nombre || debt.acreedor}`} onClose={onClose} maxWidth="720px">
      <ModalFormError error={error ?? genError} />
      <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
        Indica fecha y cuota de cada pago. El saldo se calcula solo; «Pagada» solo aparece si hay un pago real registrado en Pagos reales.
      </p>

      <div className="debt-schedule-gen-summary" style={{ marginBottom: "0.75rem" }}>
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          Saldo {fmt.format(pending)}
          {Number(debt.cuota_mensual) > 0 ? ` · Cuota ${fmt.format(Number(debt.cuota_mensual))}` : " · Sin cuota mensual"}
          {hasInterest ? ` · TAE ${Number(debt.tasa_anual).toFixed(2)}%` : " · Sin interés"}
          {debt.dia_cargo_mensual ? ` · Día cargo ${debt.dia_cargo_mensual}` : ""}
        </span>
      </div>

      <div className="debt-schedule-gen-controls" style={{ marginBottom: "0.75rem" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem", maxWidth: "220px" }}>
          Primera cuota (inicio)
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setGenError(null); }}
            required
          />
        </label>
        <div className="inline-actions" style={{ marginTop: "0.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <button type="button" onClick={() => autocalculate(installments.length > 0)}>
            Autocalcular planilla
          </button>
          <button type="button" className="button-secondary"
            onClick={() => setRows((prev) => [...prev, emptyRow(prev.length + 1)])}>
            + Añadir fila
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="📋"
          title="Planilla vacía"
          description="Elige la fecha de la primera cuota y pulsa Autocalcular."
          actionLabel="Autocalcular planilla"
          onAction={() => autocalculate()}
        />
      ) : (
        <div className="debt-schedule-table-wrap">
          <table className="debt-schedule-table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Fecha</th>
                <th>Cuota</th>
                <th>Estado (pagos)</th>
                <th scope="col"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const simple = row.fecha_vencimiento && row.cuota_total
                  ? {
                      numero_cuota: parseInt(row.numero_cuota, 10) || 1,
                      fecha_vencimiento: row.fecha_vencimiento,
                      cuota_total: parseNum(row.cuota_total),
                    }
                  : null;
                const status = simple ? simpleRowStatus(debt, simpleSorted, simple) : "incompleta";
                const statusLabel =
                  status === "pagada" ? "Pagada"
                    : status === "vencida" ? "Vencida"
                      : status === "incompleta" ? "Incompleta"
                        : "Pendiente";
                return (
                  <tr key={row.key}>
                    <td>
                      <input type="number" min={1} className="debt-schedule-input" value={row.numero_cuota}
                        aria-label={`Número de cuota ${row.numero_cuota}`}
                        onChange={(e) => setRow(row.key, { numero_cuota: e.target.value })} />
                    </td>
                    <td>
                      <input type="date" className="debt-schedule-input" value={row.fecha_vencimiento}
                        aria-label={`Fecha cuota ${row.numero_cuota}`}
                        onChange={(e) => setRow(row.key, { fecha_vencimiento: e.target.value })} required />
                    </td>
                    <td>
                      <input type="text" inputMode="decimal" className="debt-schedule-input" value={row.cuota_total}
                        aria-label={`Importe cuota ${row.numero_cuota}`}
                        onChange={(e) => setRow(row.key, { cuota_total: e.target.value })} required />
                    </td>
                    <td>
                      <span className={`debt-inst-status debt-inst-status--${status === "incompleta" ? "pendiente" : status}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="danger" style={{ padding: "0.2rem 0.45rem", fontSize: "0.75rem" }}
                        aria-label={`Eliminar cuota ${row.numero_cuota}`}
                        title="Eliminar"
                        onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}>🗑</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasInterest && enrichedPreview.length > 0 && (
        <details style={{ marginTop: "0.75rem", fontSize: "0.82rem" }}>
          <summary className="muted" style={{ cursor: "pointer" }}>Desglose capital / interés (calculado)</summary>
          <ul className="list" style={{ marginTop: "0.35rem" }}>
            {enrichedPreview.map((row) => (
              <li key={row.numero_cuota} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                <span>Cuota {row.numero_cuota} · {row.fecha_vencimiento.slice(0, 10)}</span>
                <span className="muted">
                  {fmt.format(row.capital ?? 0)} + {fmt.format(row.interes ?? 0)} = {fmt.format(row.cuota_total)}
                  {row.saldo_pendiente != null ? ` · saldo ${fmt.format(row.saldo_pendiente)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="modal-actions" style={{ marginTop: "1rem" }}>
        <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
        <button type="button" disabled={saving} onClick={() => void run(async () => {
          if (rows.length === 0) {
            await api.replaceDebtInstallments(debt.id, []);
            await api.updateDebt(debt.id, {
              nombre: debt.nombre,
              acreedor: debt.acreedor,
              monto_total: debt.monto_total,
              monto_pagado: debt.monto_pagado,
              tipo: debt.tipo,
              fecha_vencimiento: null,
              cuota_mensual: debt.cuota_mensual,
              tasa_anual: debt.tasa_anual,
              notas: debt.notas,
              dia_cargo_mensual: debt.dia_cargo_mensual,
            });
          } else {
            for (const row of rows) {
              if (!row.fecha_vencimiento || !row.cuota_total) {
                throw new Error("Cada fila necesita fecha y cuota.");
              }
            }
            const payload = enrichInstallmentRows(debt, toSimpleRows(rows));
            await api.replaceDebtInstallments(debt.id, payload);
            const maturity = scheduleMaturityDate(payload);
            if (maturity) {
              await api.updateDebt(debt.id, {
                nombre: debt.nombre,
                acreedor: debt.acreedor,
                monto_total: debt.monto_total,
                monto_pagado: debt.monto_pagado,
                tipo: debt.tipo,
                fecha_vencimiento: maturity,
                cuota_mensual: debt.cuota_mensual,
                tasa_anual: debt.tasa_anual,
                notas: debt.notas,
                dia_cargo_mensual: debt.dia_cargo_mensual,
              });
            }
          }
          addToast?.("Planilla guardada.", "success");
          onSaved();
          onClose();
        })}>
          {saving ? "Guardando…" : "Guardar planilla"}
        </button>
      </div>
    </EditModalShell>
  );
}
