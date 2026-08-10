import { useCallback, useEffect, useState } from "react";
import type { Debt, DebtPayment } from "../../types";
import { api } from "../../services/api";
import { parseNum } from "../../utils/format";
import { ModalFormError } from "../ModalFormError";
import { EditModalShell } from "../EditModalShell";
import { EmptyState } from "../EmptyState";

const lbl = { display: "flex", flexDirection: "column" as const, gap: "0.25rem" };

function today() { return new Date().toISOString().slice(0, 10); }

interface Props {
  debt: Debt;
  formatEUR: (v: number) => string;
  onClose: () => void;
  onSaved: () => void;
  addToast?: (msg: string, type: "success" | "error" | "info") => void;
  initialAmount?: number;
  initialDate?: string;
}

export function DebtPaymentsModal({
  debt,
  formatEUR,
  onClose,
  onSaved,
  addToast,
  initialAmount,
  initialDate,
}: Props) {
  const [payments, setPayments] = useState<DebtPayment[]>([]);
  const [form, setForm] = useState({
    monto: String(initialAmount ?? debt.cuota_mensual ?? ""),
    fecha: initialDate ?? today(),
    notas: "",
  });
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const remaining = debt.monto_total - debt.monto_pagado;
  const pct = debt.monto_total > 0 ? Math.min(100, (debt.monto_pagado / debt.monto_total) * 100) : 0;

  const load = useCallback(async () => {
    setListLoading(true);
    try {
      setPayments(await api.getDebtPayments(debt.id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo cargar el historial.";
      setError(msg);
      addToast?.(msg, "error");
    } finally {
      setListLoading(false);
    }
  }, [debt.id, addToast]);

  useEffect(() => { void load(); }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const amount = parseNum(form.monto);
      await api.createDebtPayment(debt.id, {
        monto: amount,
        fecha: form.fecha,
        notas: form.notas || null,
      });
      setForm(p => ({ ...p, monto: String(debt.cuota_mensual ?? ""), notas: "" }));
      await load();
      onSaved();
      const paidAfter = (debt.monto_pagado_registrado ?? debt.monto_pagado) + amount;
      if (paidAfter >= debt.monto_total - 0.01) {
        addToast?.("Deuda saldada — archivada automáticamente.", "success");
      } else {
        addToast?.("Pago registrado.", "success");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo registrar el pago.";
      setError(msg);
      addToast?.(msg, "error");
    } finally {
      setLoading(false);
    }
  }

  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function handleDelete(payId: number) {
    if (!window.confirm("¿Eliminar este pago del historial?")) return;
    setDeletingId(payId);
    setError(null);
    try {
      await api.deleteDebtPayment(debt.id, payId);
      await load();
      onSaved();
      addToast?.("Pago eliminado.", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo eliminar el pago.";
      setError(msg);
      addToast?.(msg, "error");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <EditModalShell title={`Pagos — ${debt.nombre || debt.acreedor}`} onClose={onClose} maxWidth="480px">
        <ModalFormError error={error} />
        {error && !listLoading && (
          <button type="button" className="button-secondary" style={{ marginBottom: "0.75rem", fontSize: "0.85rem" }}
            onClick={() => void load()}>
            Reintentar
          </button>
        )}

        <div style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: "0.25rem" }}>
            <span className="muted">Pagado: <strong className="sensitive">{formatEUR(debt.monto_pagado)}</strong></span>
            <span className="muted">Pendiente: <strong className={remaining > 0 ? "negative sensitive" : "positive sensitive"}>{formatEUR(remaining)}</strong></span>
          </div>
          <progress value={pct} max={100} style={{ width: "100%", height: "0.5rem" }} />
          <div style={{ fontSize: "0.75rem", textAlign: "right" }} className="muted">{pct.toFixed(1)}% liquidado</div>
        </div>

        {remaining > 0 && (
          <form onSubmit={handleSubmit} style={{ marginBottom: "1rem", padding: "0.75rem", background: "var(--glass-bg, rgba(0,0,0,0.04))", borderRadius: "0.5rem", border: "1px solid var(--glass-border)" }}>
            <p style={{ fontWeight: 600, fontSize: "0.82rem", marginBottom: "0.6rem" }}>Registrar pago</p>
            <div className="grid two-col" style={{ gap: "0.6rem", marginBottom: "0.6rem" }}>
              <label style={lbl}>
                Importe (€)
                <input type="text" inputMode="decimal" value={form.monto}
                  onChange={e => setForm(p => ({ ...p, monto: e.target.value }))} required autoFocus />
              </label>
              <label style={lbl}>
                Fecha
                <input type="date" value={form.fecha}
                  onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} required />
              </label>
              <label style={{ ...lbl, gridColumn: "1/-1" }}>
                Notas (opcional)
                <input value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Pago adelantado, quita parcial…" />
              </label>
            </div>
            <button type="submit" disabled={loading} style={{ width: "100%" }}>
              {loading ? "Guardando…" : "Registrar pago"}
            </button>
          </form>
        )}
        {remaining <= 0 && (
          <div className="status-banner--ok" style={{ marginBottom: "1rem" }}>
            ✓ Deuda liquidada
          </div>
        )}

        {listLoading ? (
          <div aria-busy="true" aria-label="Cargando historial de pagos">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton skeleton-row" style={{ marginBottom: "0.5rem" }} />
            ))}
          </div>
        ) : payments.length > 0 ? (
          <div>
            <p style={{ fontWeight: 600, fontSize: "0.82rem", marginBottom: "0.5rem" }}>Historial</p>
            <ul className="list">
              {payments.map(p => (
                <li key={p.id}>
                  <div>
                    <span className="sensitive" style={{ fontWeight: 600 }}>{formatEUR(p.monto)}</span>
                    <small className="muted" style={{ marginLeft: "0.5rem" }}>
                      {new Date(p.fecha).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}
                    </small>
                    {p.notas && <div style={{ fontSize: "0.75rem" }} className="muted">{p.notas}</div>}
                  </div>
                  <button type="button" className="danger" style={{ padding: "0.15rem 0.35rem", fontSize: "0.75rem" }}
                    aria-label={`Eliminar pago de ${formatEUR(p.monto)}`}
                    title="Eliminar"
                    disabled={deletingId === p.id}
                    onClick={() => void handleDelete(p.id)}>{deletingId === p.id ? "…" : "🗑"}</button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState
            icon="💸"
            title="Sin pagos registrados"
            description="Los abonos que registres aquí actualizan el saldo y el estado de la planilla."
          />
        )}

        <div className="modal-actions" style={{ marginTop: "1rem" }}>
          <button type="button" className="button-secondary" onClick={onClose}>Cerrar</button>
        </div>
    </EditModalShell>
  );
}
