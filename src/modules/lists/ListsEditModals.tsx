import type { Dispatch, SetStateAction } from "react";
import { api } from "../../services/api";
import { GlassModal } from "../../components/GlassModal";
import { AccountModal } from "../../components/modals/AccountModal";
import { GoalModal } from "../../components/modals/GoalModal";
import { DebtModal } from "../../components/modals/DebtModal";
import { TransactionModal } from "../../components/modals/TransactionModal";
import { BalanceModal } from "../../components/modals/BalanceModal";
import { WishlistModal } from "../../components/modals/WishlistModal";
import { WishlistPurchaseModal } from "../../components/modals/WishlistPurchaseModal";
import { DebtPaymentsModal } from "../../components/modals/DebtPaymentsModal";
import { ModalFormError } from "../../components/ModalFormError";
import { GoalSelect } from "../../components/goals/GoalSelect";
import { parseNum } from "../../utils/format";
import {
  DEBT_TIPO_OPTIONS,
  applyChargeDayToFirstInstallment,
  clampDebtChargeDay,
  computeMonthlyPaymentFromTerm,
  defaultScheduleStartDate,
  generateAmortizationSchedule,
  parseChargeDayInput,
  scheduleMaturityDate,
  scheduleToInstallmentPayload,
} from "../../utils/debtInstallments";
import { goalCurrentAmount } from "../../utils/goalProgress";
import type { Account, Debt, Goal, Investment, RecurringEntry, Transaction, WishlistItem } from "../../types";

type AsyncSubmit = {
  saving: boolean;
  error: string | null;
  run: (action: () => Promise<void>) => Promise<void>;
};

export type DebtFormState = {
  nombre: string;
  acreedor: string;
  monto_total: number;
  monto_pagado: number;
  tipo: string;
  fecha_inicio: string;
  cuota_mensual: number;
  tasa_anual: number;
  notas: string;
  dia_cargo_mensual: string;
  numero_pagos: string;
  goal_id: number | null;
};

export type WishlistFormState = {
  nombre: string;
  monto_estimado: string;
  prioridad: "baja" | "media" | "alta";
  notas: string;
  url: string;
};

export type GoalFormState = {
  nombre: string;
  monto_objetivo: number;
  fecha_limite: string;
  account_id: number | undefined;
  cartera_destino: string;
};

type Props = {
  accounts: Account[];
  goals: Goal[];
  investments: Investment[];
  recurringEntries: RecurringEntry[];
  transactions: Transaction[];
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  editAccountModal: Account | null;
  setEditAccountModal: (v: Account | null) => void;
  editGoalModal: Goal | null;
  setEditGoalModal: (v: Goal | null) => void;
  editWishlistModal: WishlistItem | null;
  setEditWishlistModal: (v: WishlistItem | null) => void;
  purchaseModal: WishlistItem | null;
  setPurchaseModal: (v: WishlistItem | null) => void;
  promoteModal: WishlistItem | null;
  setPromoteModal: (v: WishlistItem | null) => void;
  promoteMonth: number;
  setPromoteMonth: (v: number) => void;
  promoteYear: number;
  setPromoteYear: (v: number) => void;
  promoteSubmit: AsyncSubmit;
  editDebtModal: Debt | null;
  setEditDebtModal: (v: Debt | null) => void;
  debtPaymentsModal: { debt: Debt; initialAmount?: number; initialDate?: string } | null;
  setDebtPaymentsModal: (v: { debt: Debt; initialAmount?: number; initialDate?: string } | null) => void;
  editTxModal: Transaction | null;
  setEditTxModal: (v: Transaction | null) => void;
  editBalanceModal: { accountId: number; alias: string; current: number } | null;
  setEditBalanceModal: (v: { accountId: number; alias: string; current: number } | null) => void;
  isWishlistFormOpen: boolean;
  setIsWishlistFormOpen: (v: boolean) => void;
  wishlistForm: WishlistFormState;
  setWishlistForm: Dispatch<SetStateAction<WishlistFormState>>;
  wishlistSubmit: AsyncSubmit;
  isGoalFormOpen: boolean;
  setIsGoalFormOpen: (v: boolean) => void;
  goalForm: GoalFormState;
  setGoalForm: Dispatch<SetStateAction<GoalFormState>>;
  goalSubmit: AsyncSubmit;
  isDebtFormOpen: boolean;
  setIsDebtFormOpen: (v: boolean) => void;
  debtForm: DebtFormState;
  setDebtForm: Dispatch<SetStateAction<DebtFormState>>;
  emptyDebtForm: () => DebtFormState;
  debtSubmit: AsyncSubmit;
  setScheduleFocusDebtId: (v: number | null) => void;
  setScheduleEditorDebtId: (v: number | null) => void;
  setScheduleAutocalc: (v: boolean) => void;
  setScheduleStartDate: (v: string | null) => void;
};

export function ListsEditModals({
  accounts, goals, investments, recurringEntries, transactions, formatEUR, addToast, loadAll,
  editAccountModal, setEditAccountModal,
  editGoalModal, setEditGoalModal,
  editWishlistModal, setEditWishlistModal,
  purchaseModal, setPurchaseModal,
  promoteModal, setPromoteModal,
  promoteMonth, setPromoteMonth, promoteYear, setPromoteYear, promoteSubmit,
  editDebtModal, setEditDebtModal,
  debtPaymentsModal, setDebtPaymentsModal,
  editTxModal, setEditTxModal,
  editBalanceModal, setEditBalanceModal,
  isWishlistFormOpen, setIsWishlistFormOpen, wishlistForm, setWishlistForm, wishlistSubmit,
  isGoalFormOpen, setIsGoalFormOpen, goalForm, setGoalForm, goalSubmit,
  isDebtFormOpen, setIsDebtFormOpen, debtForm, setDebtForm, emptyDebtForm, debtSubmit,
  setScheduleFocusDebtId, setScheduleEditorDebtId, setScheduleAutocalc, setScheduleStartDate,
}: Props) {
  return (
    <>
      {editAccountModal && <AccountModal item={editAccountModal} onClose={() => setEditAccountModal(null)} onSaved={loadAll} />}
      {editGoalModal && <GoalModal item={editGoalModal} accounts={accounts} investments={investments} onClose={() => setEditGoalModal(null)} onSaved={loadAll} />}
      {editWishlistModal && <WishlistModal item={editWishlistModal} onClose={() => setEditWishlistModal(null)} onSaved={loadAll} />}
      {purchaseModal && (
        <WishlistPurchaseModal
          item={purchaseModal}
          accounts={accounts}
          onClose={() => setPurchaseModal(null)}
          onSaved={async () => {
            addToast(`"${purchaseModal.nombre}" archivado y registrado en transacciones.`, "success");
            await loadAll({ silent: true });
          }}
        />
      )}
      <GlassModal
        isOpen={!!promoteModal}
        onClose={() => setPromoteModal(null)}
        title="Promover a gasto planificado"
        contentClassName="modal-content--narrow"
      >
        {promoteModal && (
          <>
            <p style={{ fontSize: "0.88rem", marginBottom: "1rem" }}>
              <strong>{promoteModal.nombre}</strong> se añadirá como gasto planificado en el mes que elijas.
              Permanecerá en la lista de deseos hasta que lo marques como comprado.
            </p>
            <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "1rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                Mes
                <select value={promoteMonth} onChange={e => setPromoteMonth(Number(e.target.value))}>
                  {["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"].map((m, i) => (
                    <option key={i+1} value={i+1}>{m}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                Año
                <input type="number" value={promoteYear} onChange={e => setPromoteYear(Number(e.target.value))} min={2024} max={2040} />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="button-secondary" onClick={() => setPromoteModal(null)}>Cancelar</button>
              <button type="button" disabled={promoteSubmit.saving} onClick={() => void promoteSubmit.run(async () => {
                await api.promoteWishlistItem(promoteModal!.id, promoteMonth, promoteYear);
                setPromoteModal(null);
                addToast("Añadido al presupuesto. Sigue en la lista de deseos.", "success");
                await loadAll({ silent: true });
              })}>{promoteSubmit.saving ? "Guardando…" : "Promover"}</button>
            </div>
            <ModalFormError error={promoteSubmit.error} />
          </>
        )}
      </GlassModal>
      {editDebtModal && <DebtModal item={editDebtModal} goals={goals} onClose={() => setEditDebtModal(null)} onSaved={loadAll} />}
      {debtPaymentsModal && (
        <DebtPaymentsModal
          debt={debtPaymentsModal.debt}
          formatEUR={formatEUR}
          addToast={addToast}
          initialAmount={debtPaymentsModal.initialAmount}
          initialDate={debtPaymentsModal.initialDate}
          onClose={() => setDebtPaymentsModal(null)}
          onSaved={loadAll}
        />
      )}
      {editTxModal && (
        <TransactionModal
          item={editTxModal}
          accounts={accounts}
          recurringEntries={recurringEntries}
          transactions={transactions}
          addToast={addToast}
          onClose={() => setEditTxModal(null)}
          onSaved={loadAll}
        />
      )}
      {editBalanceModal && (() => {
        const acc = accounts.find(a => a.id === editBalanceModal.accountId);
        return acc ? (
          <BalanceModal
            accountId={editBalanceModal.accountId}
            alias={editBalanceModal.alias}
            current={editBalanceModal.current}
            account={acc}
            formatEUR={formatEUR}
            onClose={() => setEditBalanceModal(null)}
            onSaved={loadAll}
          />
        ) : null;
      })()}

      <GlassModal isOpen={isWishlistFormOpen} onClose={() => setIsWishlistFormOpen(false)} title="Nuevo deseo">
        <ModalFormError error={wishlistSubmit.error} />
        <form onSubmit={e => {
          e.preventDefault();
          void wishlistSubmit.run(async () => {
            await api.createWishlistItem({
              nombre: wishlistForm.nombre,
              monto_estimado: wishlistForm.monto_estimado ? parseFloat(wishlistForm.monto_estimado.replace(",", ".")) || null : null,
              prioridad: wishlistForm.prioridad,
              notas: wishlistForm.notas || null,
              url: wishlistForm.url || null,
              comprado: false,
              archivado: false,
            });
            setWishlistForm({ nombre: "", monto_estimado: "", prioridad: "media", notas: "", url: "" });
            setIsWishlistFormOpen(false);
            addToast("Añadido a la lista de deseos.", "success");
            await loadAll({ silent: true });
          });
        }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginBottom: "0.75rem" }}>
            Nombre<input value={wishlistForm.nombre} onChange={e => setWishlistForm(p => ({ ...p, nombre: e.target.value }))} required autoFocus />
          </label>
          <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              Precio estimado (€)
              <input type="text" inputMode="decimal" value={wishlistForm.monto_estimado} onChange={e => setWishlistForm(p => ({ ...p, monto_estimado: e.target.value }))} placeholder="Opcional" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              Prioridad
              <select value={wishlistForm.prioridad} onChange={e => setWishlistForm(p => ({ ...p, prioridad: e.target.value as "baja" | "media" | "alta" }))}>
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1/-1" }}>
              Enlace (URL)<input type="text" inputMode="url" autoComplete="url" value={wishlistForm.url} onChange={e => setWishlistForm(p => ({ ...p, url: e.target.value }))} placeholder="Opcional" />
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="button-secondary" onClick={() => setIsWishlistFormOpen(false)}>Cancelar</button>
            <button type="submit" disabled={wishlistSubmit.saving}>{wishlistSubmit.saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      </GlassModal>

      <GlassModal isOpen={isGoalFormOpen} onClose={() => setIsGoalFormOpen(false)} title="Nuevo objetivo">
        <ModalFormError error={goalSubmit.error} />
        <form onSubmit={(e) => {
          e.preventDefault();
          void goalSubmit.run(async () => {
            if (goalForm.account_id && goalForm.cartera_destino) {
              throw new Error("Elige solo cuenta o cartera, no ambas.");
            }
            const draft: Goal = {
              id: 0,
              nombre: goalForm.nombre,
              monto_objetivo: goalForm.monto_objetivo,
              monto_actual: 0,
              fecha_limite: goalForm.fecha_limite || null,
              account_id: goalForm.account_id ?? null,
              cartera_destino: goalForm.cartera_destino || null,
            };
            await api.createGoal({
              ...draft,
              monto_actual: goalCurrentAmount(draft, accounts, investments),
            });
            setGoalForm({ nombre: "", monto_objetivo: 0, fecha_limite: "", account_id: undefined, cartera_destino: "" });
            setIsGoalFormOpen(false);
            addToast("Objetivo creado.", "success");
            await loadAll({ silent: true });
          });
        }}>
          <label>Nombre<input value={goalForm.nombre} onChange={e => setGoalForm(p => ({ ...p, nombre: e.target.value }))} required autoFocus /></label>
          <div className="grid two-col" style={{ gap: "0.75rem", marginTop: "0.75rem" }}>
            <label style={{ gridColumn: "1/-1" }}>Objetivo (€)<input type="number" step="0.01" min="0.01" value={goalForm.monto_objetivo || ""} onChange={e => setGoalForm(p => ({ ...p, monto_objetivo: parseNum(e.target.value) }))} required /></label>
            <label style={{ gridColumn: "1/-1" }}>Cuenta vinculada (opcional)
              <select value={goalForm.account_id ?? ""} onChange={e => setGoalForm(p => ({ ...p, account_id: e.target.value ? Number(e.target.value) : undefined, cartera_destino: e.target.value ? "" : p.cartera_destino }))}>
                <option value="">— Ninguna —</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.alias_real}</option>)}
              </select>
            </label>
            <label style={{ gridColumn: "1/-1" }}>Cartera vinculada (opcional)
              <select value={goalForm.cartera_destino} onChange={e => setGoalForm(p => ({ ...p, cartera_destino: e.target.value, account_id: e.target.value ? undefined : p.account_id }))}>
                <option value="">— Ninguna —</option>
                {[...new Set(investments.map(i => (i.cartera || "").trim()).filter(Boolean))].sort().map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ gridColumn: "1/-1" }}>Fecha límite (opcional)<input type="date" value={goalForm.fecha_limite} onChange={e => setGoalForm(p => ({ ...p, fecha_limite: e.target.value }))} /></label>
          </div>
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
            Opcional: cuenta o cartera. También puedes vincular deudas y gastos planificados al crearlas.
          </p>
          <div className="modal-actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="button-secondary" onClick={() => setIsGoalFormOpen(false)}>Cancelar</button>
            <button type="submit" disabled={goalSubmit.saving}>{goalSubmit.saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      </GlassModal>

      <GlassModal isOpen={isDebtFormOpen} onClose={() => setIsDebtFormOpen(false)} title="Nueva deuda">
        <ModalFormError error={debtSubmit.error} />
        <form onSubmit={(e) => {
          e.preventDefault();
          void debtSubmit.run(async () => {
            if (debtForm.monto_total <= 0) {
              throw new Error("El importe total debe ser mayor que 0.");
            }
            const diaRaw = parseChargeDayInput(debtForm.dia_cargo_mensual);
            const dia = diaRaw > 0 ? clampDebtChargeDay(diaRaw) : null;
            if (diaRaw > 31) {
              throw new Error("El día de cargo debe estar entre 1 y 31.");
            }
            const pagosRaw = parseChargeDayInput(debtForm.numero_pagos);
            if (pagosRaw > 600) {
              throw new Error("El número de pagos debe ser como máximo 600.");
            }
            const paymentCount = pagosRaw > 0 ? pagosRaw : undefined;
            let cuotaMensual = debtForm.cuota_mensual || null;
            if (!cuotaMensual && paymentCount && debtForm.monto_total > 0) {
              cuotaMensual = computeMonthlyPaymentFromTerm(
                debtForm.monto_total,
                debtForm.tasa_anual,
                paymentCount,
              );
            }
            if (paymentCount && !cuotaMensual) {
              throw new Error("Indica la cuota mensual o un importe total para calcularla.");
            }
            const startDate = debtForm.fecha_inicio || defaultScheduleStartDate({ dia_cargo_mensual: dia });
            const created = await api.createDebt({
              nombre: debtForm.nombre || null,
              acreedor: debtForm.acreedor,
              monto_total: debtForm.monto_total,
              monto_pagado: 0,
              tipo: debtForm.tipo,
              fecha_vencimiento: null,
              cuota_mensual: cuotaMensual,
              tasa_anual: debtForm.tasa_anual || null,
              notas: debtForm.notas || null,
              dia_cargo_mensual: dia,
              goal_id: debtForm.goal_id,
            });
            setDebtForm(emptyDebtForm());
            setIsDebtFormOpen(false);
            addToast("Deuda creada.", "success");
            setScheduleFocusDebtId(created.id);
            const pending = created.monto_total - created.monto_pagado;
            if (pending > 0 && Number(created.cuota_mensual) > 0) {
              try {
                const schedule = generateAmortizationSchedule(created, { startDate, paymentCount });
                if (schedule.length > 0) {
                  await api.replaceDebtInstallments(created.id, scheduleToInstallmentPayload(schedule));
                  const maturity = scheduleMaturityDate(schedule);
                  if (maturity) {
                    await api.updateDebt(created.id, {
                      nombre: created.nombre,
                      acreedor: created.acreedor,
                      monto_total: created.monto_total,
                      monto_pagado: created.monto_pagado,
                      tipo: created.tipo,
                      fecha_vencimiento: maturity,
                      cuota_mensual: created.cuota_mensual,
                      tasa_anual: created.tasa_anual,
                      notas: created.notas,
                      dia_cargo_mensual: created.dia_cargo_mensual,
                    });
                  }
                  addToast(`Planilla autogenerada: ${schedule.length} cuotas.`, "success");
                }
              } catch (err) {
                addToast(
                  err instanceof Error ? err.message : "No se pudo autogenerar la planilla.",
                  "error",
                );
                setScheduleEditorDebtId(created.id);
                setScheduleAutocalc(true);
                setScheduleStartDate(startDate);
              }
            }
            await loadAll({ silent: true });
          });
        }}>
          <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
            <label>Nombre<input value={debtForm.nombre} onChange={e => setDebtForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Ej: Coche Suzuki" autoFocus /></label>
            <label>Acreedor<input value={debtForm.acreedor} onChange={e => setDebtForm(p => ({ ...p, acreedor: e.target.value }))} required placeholder="Ej: Santander" /></label>
          </div>
          <div className="grid two-col" style={{ gap: "0.75rem", marginTop: "0" }}>
            <label>Total (€)<input type="number" step="0.01" value={debtForm.monto_total || ""} onChange={e => setDebtForm(p => ({ ...p, monto_total: parseNum(e.target.value) }))} /></label>
            <label>Cuota/mes (€)<input type="number" step="0.01" value={debtForm.cuota_mensual || ""} onChange={e => setDebtForm(p => ({ ...p, cuota_mensual: parseNum(e.target.value) }))} placeholder="Opcional si indicas Nº pagos" /></label>
            <label>Nº pagos<input type="text" inputMode="numeric" placeholder="Ej: 72" value={debtForm.numero_pagos} onChange={e => setDebtForm(p => ({ ...p, numero_pagos: e.target.value.replace(/\D/g, "").slice(0, 3) }))} /></label>
            <label>TAE (%)<input type="number" step="0.01" value={debtForm.tasa_anual || ""} onChange={e => setDebtForm(p => ({ ...p, tasa_anual: parseNum(e.target.value) }))} /></label>
            <label>Tipo
              <select value={debtForm.tipo} onChange={e => setDebtForm(p => ({ ...p, tipo: e.target.value }))}>
                {DEBT_TIPO_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>Día cargo (1–31)<input type="text" inputMode="numeric" placeholder="Ej: 30" value={debtForm.dia_cargo_mensual} onChange={e => {
              const raw = e.target.value.replace(/\D/g, "").slice(0, 2);
              setDebtForm(p => ({
                ...p,
                dia_cargo_mensual: raw,
                fecha_inicio: raw
                  ? applyChargeDayToFirstInstallment(
                      p.fecha_inicio || defaultScheduleStartDate({ dia_cargo_mensual: null }),
                      parseChargeDayInput(raw),
                    )
                  : p.fecha_inicio,
              }));
            }} /></label>
            <label style={{ gridColumn: "1/-1" }}>Primera cuota<input type="date" value={debtForm.fecha_inicio} onChange={e => setDebtForm(p => ({ ...p, fecha_inicio: e.target.value }))} required /></label>
            <GoalSelect
              goals={goals}
              value={debtForm.goal_id}
              onChange={(goal_id) => setDebtForm((p) => ({ ...p, goal_id }))}
              label="Objetivo vinculado (opcional)"
            />
            <label style={{ gridColumn: "1/-1" }}>Notas<input value={debtForm.notas} onChange={e => setDebtForm(p => ({ ...p, notas: e.target.value }))} /></label>
          </div>
          <div className="modal-actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="button-secondary" onClick={() => setIsDebtFormOpen(false)}>Cancelar</button>
            <button type="submit" disabled={debtSubmit.saving}>{debtSubmit.saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      </GlassModal>
    </>
  );
}
