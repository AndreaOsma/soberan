import { useState, useMemo, useEffect } from "react";
import { api } from "../services/api";
import { useAsyncSubmit } from "./useAsyncSubmit";
import type {
  RecurringEntry, MonthlyBudget, Transaction, Account, Debt, DebtInstallment,
  Investment, WorkHistory, SalaryBreakdown,
} from "../types";
import {
  type BudgetDestino,
  type BudgetTipoPartida,
  destinoFromEntry,
  isAhorroInversionTipo,
  normalizeBudgetTipo,
} from "../utils/budgetTipo";
import { lastActiveMonthBefore, applySubscriptionPriceChange, entryAppliesBeforeMonth } from "../utils/subscriptionBudget";
import { findPayrollEntry } from "../utils/budgetIncome";
import { split503020 } from "../utils/budgetTemplate";
import { entryAssignedAmount, hasNonAmountStructuralChanges } from "../utils/budgetEntryScope";
import { useBudgetMonth, isLibrePlannedGasto } from "./useBudgetMonth";
import {
  type ExtraPaymentMode,
  monthIndex,
  parseInstallmentDate,
  pickBaseNumeroCuota,
  simulateExtraPayment,
} from "../utils/debtInstallments";
import { parseJsonValue } from "../utils/format";
import {
  ensureIncomeTransaction,
  incomeTxDateIso,
  otherIncomeTxDescription,
  payrollIncomeTxDescription,
  resolveIncomeAccountId,
  type PayrollCompanyConfig,
} from "../utils/incomeTransaction";

export const MONTH_NAMES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const LIBRE_GASTO_NAME = "Libre";

export type BudgetEntryFormState = {
  nombre: string;
  categoria: string;
  monto_estimado: number;
  es_fijo: boolean;
  es_ingreso: boolean;
  tipo_partida: BudgetTipoPartida;
  destino: BudgetDestino;
  cuenta_destino_id: number | "";
  cartera_destino: string;
  bloque: "" | "necesidades" | "deseos" | "ahorro_inversion";
  objetivo_monto: number | "";
  objetivo_fecha: string;
  rentabilidad_anual_pct: number | "";
  es_puntual: boolean;
  es_fondo: boolean;
  frecuencia: "mensual" | "anual";
  fecha_pago: number;
  mes_cobro: number;
  mes_inicio: number;
  anio_inicio: number;
  meses_excluidos: number[];
  createAccount: boolean;
  newAccountBanco: string;
  newAccountTipo: string;
  goal_id: number | null;
};

type Params = {
  month: number;
  year: number;
  recurringEntries: RecurringEntry[];
  monthlyBudgets: MonthlyBudget[];
  workHistory: WorkHistory[];
  salaryBreakdowns: SalaryBreakdown[];
  debts: Debt[];
  debtInstallments: DebtInstallment[];
  monthlyTransactions: Transaction[];
  accounts: Account[];
  investments: Investment[];
  settings: Record<string, string>;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  formatEUR: (value: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
};

function emptyNewEntry(month: number, year: number): BudgetEntryFormState {
  return {
    nombre: "", categoria: "", monto_estimado: 0, es_fijo: true,
    es_ingreso: false,
    tipo_partida: "gasto",
    destino: "cuenta",
    cuenta_destino_id: "",
    cartera_destino: "",
    bloque: "",
    objetivo_monto: "",
    objetivo_fecha: "",
    rentabilidad_anual_pct: "",
    es_puntual: false,
    es_fondo: false,
    frecuencia: "mensual",
    fecha_pago: 1,
    mes_cobro: 1,
    mes_inicio: month,
    anio_inicio: year,
    meses_excluidos: [],
    createAccount: false,
    newAccountBanco: "",
    newAccountTipo: "ahorro",
    goal_id: null,
  };
}

export function useBudgetEntries({
  month, year,
  recurringEntries, monthlyBudgets, workHistory, salaryBreakdowns, debts, debtInstallments,
  monthlyTransactions, accounts, investments, settings,
  loadAll, formatEUR, addToast,
}: Params) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingVal, setEditingVal] = useState("");
  const [addingIncome, setAddingIncome] = useState(false);
  const [editingIncomeSource, setEditingIncomeSource] = useState<RecurringEntry | null>(null);
  const [editingIncomeKey, setEditingIncomeKey] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [addingEntry, setAddingEntry] = useState(false);
  const [newEntry, setNewEntry] = useState(() => emptyNewEntry(month, year));
  const [copying, setCopying] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [fondoBalances, setFondoBalances] = useState<Record<number, number>>({});
  const [showWishlistPicker, setShowWishlistPicker] = useState(false);
  const editSubmit = useAsyncSubmit();
  const deleteSubmit = useAsyncSubmit();
  const addSubmit = useAsyncSubmit();
  const debtMarkSubmit = useAsyncSubmit({
    onError: (msg) => addToast(msg, "error"),
  });
  const debtExtraSubmit = useAsyncSubmit({
    onError: (msg) => addToast(msg, "error"),
  });
  const libreSubmit = useAsyncSubmit({
    onError: (msg) => addToast(msg, "error"),
  });

  const [editingEntry, setEditingEntry] = useState<RecurringEntry | null>(null);
  const [editForm, setEditForm] = useState<BudgetEntryFormState>(() => emptyNewEntry(month, year));
  const [editChecklistAccountId, setEditChecklistAccountId] = useState<number | "">("");
  const [editChecklistMoved, setEditChecklistMoved] = useState(false);

  const budget = useBudgetMonth({
    month,
    year,
    recurringEntries,
    monthlyBudgets,
    workHistory,
    salaryBreakdowns,
    debts,
    debtInstallments,
    monthlyTransactions,
  });

  const {
    prevMonth,
    prevYear,
    mbMap,
    puntualGastoEntries,
    fondoEntries,
    activeExpenseEntries,
    availableToAssign,
    totalIncomeExpected,
    templateSplit,
  } = budget;
  const monthlyBudgetByEntry = useMemo(() => {
    const out: Record<number, MonthlyBudget> = {};
    for (const row of monthlyBudgets) out[row.recurring_entry_id] = row;
    return out;
  }, [monthlyBudgets]);

  function getEntryMonthlyChecklist(entry: RecurringEntry) {
    const override = monthlyBudgetByEntry[entry.id];
    return {
      cuentaGestionId: override?.cuenta_gestion_id ?? entry.cuenta_destino_id ?? null,
      movido: Boolean(override?.movido_a_cuenta),
      checkedAt: override?.movido_checked_at ?? null,
    };
  }

  async function saveEntryMonthlyChecklist(
    entry: RecurringEntry,
    patch: { cuenta_gestion_id?: number | null; movido_a_cuenta?: boolean },
    opts?: { reload?: boolean },
  ) {
    const override = monthlyBudgetByEntry[entry.id];
    const currentChecklist = getEntryMonthlyChecklist(entry);
    const nextMovido = patch.movido_a_cuenta ?? currentChecklist.movido;
    const checkedChanged = patch.movido_a_cuenta !== undefined && patch.movido_a_cuenta !== currentChecklist.movido;
    await api.upsertMonthlyBudget({
      recurring_entry_id: entry.id,
      mes: month,
      anio: year,
      monto_real: mbMap[entry.id] ?? entry.monto_estimado,
      excluido: override?.excluido ?? false,
      cuenta_gestion_id: patch.cuenta_gestion_id !== undefined ? patch.cuenta_gestion_id : currentChecklist.cuentaGestionId,
      movido_a_cuenta: nextMovido,
      movido_checked_at: checkedChanged && nextMovido ? new Date().toISOString() : (override?.movido_checked_at ?? null),
    });
    if (opts?.reload !== false) {
      await loadAll({ silent: true });
    }
  }

  async function markDebtInstallmentPaid(installmentId: number, debtId: number) {
    const inst = debtInstallments.find((i) => i.id === installmentId && i.debt_id === debtId);
    const debt = debts.find((d) => d.id === debtId);
    if (!inst) return;
    await debtMarkSubmit.run(async () => {
      await api.createDebtPayment(debtId, {
        monto: inst.cuota_total,
        fecha: inst.fecha_vencimiento.slice(0, 10),
        notas: `Cuota ${inst.numero_cuota}`,
      });
      const paidAfter = debt
        ? (debt.monto_pagado_registrado ?? debt.monto_pagado) + inst.cuota_total
        : 0;
      if (debt && paidAfter >= debt.monto_total - 0.01) {
        addToast("Deuda saldada — archivada automáticamente.", "success");
      } else {
        addToast("Pago registrado.", "success");
      }
      await loadAll({ silent: true });
    });
  }

  async function commitDebtExtraPayment(
    debtId: number,
    targetMonth: number,
    targetYear: number,
    extraAmount: number,
    mode: ExtraPaymentMode,
  ) {
    const debt = debts.find((d) => d.id === debtId);
    if (!debt) return;
    const planilla = debtInstallments.filter((i) => i.debt_id === debtId);
    const dateIdx = (iso: string) => {
      const { year, month } = parseInstallmentDate(iso);
      return monthIndex(year, month);
    };
    const impact = simulateExtraPayment(debt, extraAmount, targetMonth, targetYear, new Date(), mode);
    if (!impact.applicable) {
      addToast(impact.reason ?? "No se pudo aplicar el pago extra.", "error");
      return;
    }
    await debtExtraSubmit.run(async () => {
      const notasFor = (iso: string) => planilla.find((r) => r.fecha_vencimiento === iso)?.notas ?? null;

      const targetDate = impact.newInstallmentRows[0]?.fecha_vencimiento;
      const baseNumeroCuota = targetDate ? pickBaseNumeroCuota(planilla, targetDate) : 1;
      const newRows = impact.newInstallmentRows.map((r, i) => ({ ...r, numero_cuota: baseNumeroCuota + i }));

      if (impact.mode === "cuota") {
        const targetIdx = monthIndex(targetYear, targetMonth);
        const pastRows = planilla.filter((r) => dateIdx(r.fecha_vencimiento) < targetIdx);
        const payload = [
          ...pastRows.map((r) => ({
            numero_cuota: r.numero_cuota,
            fecha_vencimiento: r.fecha_vencimiento,
            capital: r.capital,
            interes: r.interes,
            cuota_total: r.cuota_total,
            saldo_pendiente: r.saldo_pendiente,
            pagada: r.pagada,
            notas: r.notas,
          })),
          ...newRows.map((r) => ({
            numero_cuota: r.numero_cuota,
            fecha_vencimiento: r.fecha_vencimiento,
            capital: r.capital,
            interes: r.interes,
            cuota_total: r.cuota_total,
            saldo_pendiente: r.saldo_pendiente,
            pagada: false,
            notas: notasFor(r.fecha_vencimiento),
          })),
        ];
        await api.replaceDebtInstallments(debtId, payload);
      } else {
        const targetIdx = monthIndex(targetYear, targetMonth);
        const futureRows = planilla.filter((r) => dateIdx(r.fecha_vencimiento) >= targetIdx);
        const oldByDate = new Map(futureRows.map((r) => [r.fecha_vencimiento, r]));
        const newDates = new Set(newRows.map((r) => r.fecha_vencimiento));

        for (const row of futureRows) {
          if (!newDates.has(row.fecha_vencimiento)) {
            await api.deleteDebtInstallment(debtId, row.id);
          }
        }
        for (const row of newRows) {
          const existing = oldByDate.get(row.fecha_vencimiento);
          const payload = {
            numero_cuota: row.numero_cuota,
            fecha_vencimiento: row.fecha_vencimiento,
            capital: row.capital,
            interes: row.interes,
            cuota_total: row.cuota_total,
            saldo_pendiente: row.saldo_pendiente,
            pagada: false,
            notas: existing?.notas ?? null,
          };
          if (!existing) {
            await api.createDebtInstallment(debtId, payload);
          } else if (Math.abs(existing.cuota_total - row.cuota_total) > 0.01) {
            await api.updateDebtInstallment(debtId, existing.id, payload);
          }
        }
      }

      if (extraAmount > 0) {
        addToast(
          `Pago extra planificado: ahorras ${formatEUR(impact.interestSaved)}`
          + (impact.mode === "term"
            ? ` y adelantas ${impact.monthsSaved} ${impact.monthsSaved === 1 ? "mes" : "meses"}.`
            : ` con una cuota de ${formatEUR(impact.newMonthlyCuota ?? 0)}/mes.`),
          "success",
        );
      } else {
        addToast("Pago extra planificado eliminado.", "success");
      }
      await loadAll({ silent: true });
    });
  }
  function openEdit(entry: RecurringEntry) {
    let excluidos: number[] = [];
    try { excluidos = JSON.parse(entry.meses_excluidos ?? "[]") as number[]; } catch { excluidos = []; }
    setEditForm({
      nombre: entry.nombre,
      categoria: entry.categoria ?? "",
      monto_estimado: entryAssignedAmount(entry, mbMap, month, year),
      es_fijo: entry.es_fijo,
      es_ingreso: entry.es_ingreso,
      tipo_partida: normalizeBudgetTipo(entry.tipo_partida),
      destino: destinoFromEntry(entry),
      cuenta_destino_id: entry.cuenta_destino_id ?? "",
      cartera_destino: entry.cartera_destino ?? "",
      bloque: isLibrePlannedGasto(entry)
        ? "deseos"
        : (entry.bloque ?? "") as "" | "necesidades" | "deseos" | "ahorro_inversion",
      objetivo_monto: entry.objetivo_monto ?? "",
      objetivo_fecha: entry.objetivo_fecha ?? "",
      rentabilidad_anual_pct: entry.rentabilidad_anual_pct ?? "",
      es_puntual: entry.es_puntual ?? false,
      es_fondo: entry.es_fondo ?? false,
      frecuencia: (entry.frecuencia ?? "mensual") as "mensual" | "anual",
      fecha_pago: entry.fecha_pago ?? 1,
      mes_cobro: entry.mes_cobro ?? 1,
      mes_inicio: entry.mes_inicio ?? 0,
      anio_inicio: entry.anio_inicio ?? year,
      meses_excluidos: excluidos,
      createAccount: false,
      newAccountBanco: "",
      newAccountTipo: "ahorro",
      goal_id: entry.goal_id ?? null,
    });
    const checklist = getEntryMonthlyChecklist(entry);
    setEditChecklistAccountId(checklist.cuentaGestionId ?? "");
    setEditChecklistMoved(checklist.movido);
    setEditingEntry(entry);
  }
  async function restoreToMonth(entryId: number) {
    try {
      const base = recurringEntries.find(e => e.id === entryId)?.monto_estimado ?? 0;
      await api.upsertMonthlyBudget({ recurring_entry_id: entryId, mes: month, anio: year, monto_real: base, excluido: false });
      await loadAll({ silent: true });
    } catch (err) {
      addToast(err instanceof Error ? err.message : "No se pudo restaurar la partida.", "error");
    }
  }

  async function pauseEntryThisMonth(entry: RecurringEntry): Promise<boolean> {
    try {
      await api.upsertMonthlyBudget({
        recurring_entry_id: entry.id,
        mes: month,
        anio: year,
        monto_real: 0,
        excluido: true,
      });
      await loadAll({ silent: true });
      addToast(`«${entry.nombre}» quitada de ${MONTH_NAMES[month - 1]} ${year}.`, "success");
      return true;
    } catch (err) {
      addToast(err instanceof Error ? err.message : "No se pudo quitar la partida este mes.", "error");
      return false;
    }
  }

  async function cancelEntryFromMonth(entry: RecurringEntry): Promise<boolean> {
    const fromLabel = `${MONTH_NAMES[month - 1]} ${year}`;
    if (!window.confirm(
      `¿Borrar «${entry.nombre}» desde ${fromLabel}?\n\nNo aparecerá en este mes ni en los siguientes.`,
    )) {
      return false;
    }
    try {
      const { mes_fin, anio_fin } = lastActiveMonthBefore(month, year);
      await api.updateRecurringEntry(entry.id, {
        ...entry,
        mes_fin,
        anio_fin,
      });
      await loadAll({ silent: true });
      addToast(`«${entry.nombre}» borrada desde ${fromLabel}.`, "success");
      return true;
    } catch (err) {
      addToast(err instanceof Error ? err.message : "No se pudo borrar la partida.", "error");
      return false;
    }
  }

  async function submitDeleteEntry(scope: "this_month" | "following") {
    if (!editingEntry) return;
    const entry = editingEntry;
    const shouldFullyCancel = scope === "following" || Boolean(entry.es_puntual);
    const ok = shouldFullyCancel
      ? await cancelEntryFromMonth(entry)
      : await pauseEntryThisMonth(entry);
    if (ok) setEditingEntry(null);
  }

  const monthScopeLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  function buildEntryUpdatePayload(entry: RecurringEntry) {
    const isSub = editForm.tipo_partida === "suscripcion";
    const isAi = editForm.tipo_partida === "ahorro_inversion";
    const isLibre = isLibrePlannedGasto(entry);
    const cuentaId: number | null = (isAi && editForm.destino === "cuenta" || editForm.es_fondo) && editForm.cuenta_destino_id !== "" ? Number(editForm.cuenta_destino_id) : null;
    return {
      nombre: editForm.nombre,
      categoria: isSub ? "Suscripciones" : editForm.categoria,
      monto_estimado: editForm.monto_estimado,
      es_fijo: editForm.es_fijo,
      es_ingreso: editForm.es_ingreso,
      tipo_partida: editForm.es_ingreso ? null : editForm.tipo_partida,
      cuenta_destino_id: cuentaId,
      cartera_destino: isAi && editForm.destino === "cartera" && editForm.cartera_destino ? editForm.cartera_destino : null,
      bloque: isLibre
        ? "deseos"
        : (editForm.tipo_partida === "gasto" || isSub) && editForm.bloque ? editForm.bloque : null,
      objetivo_monto: isAi && editForm.destino === "cuenta" && editForm.objetivo_monto !== "" ? Number(editForm.objetivo_monto) : null,
      objetivo_fecha: isAi && editForm.destino === "cuenta" && editForm.objetivo_fecha ? editForm.objetivo_fecha : null,
      rentabilidad_anual_pct: isAi && editForm.rentabilidad_anual_pct !== "" ? Number(editForm.rentabilidad_anual_pct) : null,
      es_puntual: isLibre ? true : editForm.es_puntual,
      es_fondo: isLibre ? false : editForm.es_fondo,
      frecuencia: isSub ? editForm.frecuencia : null,
      fecha_pago: isSub ? editForm.fecha_pago : null,
      mes_cobro: isSub ? editForm.mes_cobro : null,
      mes_inicio: isSub && editForm.mes_inicio > 0 ? editForm.mes_inicio : isSub ? null : entry.mes_inicio ?? null,
      anio_inicio: isSub && editForm.mes_inicio > 0 ? editForm.anio_inicio : isSub ? null : entry.anio_inicio ?? null,
      meses_excluidos: isSub && editForm.meses_excluidos.length > 0 ? JSON.stringify(editForm.meses_excluidos) : null,
      goal_id: editForm.goal_id,
    };
  }

  async function submitEditEntry(scope: "this_month" | "following") {
    if (!editingEntry) return;
    const isSub = editForm.tipo_partida === "suscripcion";
    const isAi = editForm.tipo_partida === "ahorro_inversion";
    const checklistAccountId = editChecklistAccountId === "" ? null : Number(editChecklistAccountId);
    const recurringChecklistAccount =
      !isAi && !editForm.es_fondo ? checklistAccountId : null;
    let cuentaId: number | null = (isAi && editForm.destino === "cuenta" || editForm.es_fondo) && editForm.cuenta_destino_id !== "" ? Number(editForm.cuenta_destino_id) : null;
    if (editForm.es_fondo && editForm.createAccount) {
      const newAcc = await api.createAccount({ alias_real: editForm.nombre, alias_anonimo: null, banco: editForm.newAccountBanco, tipo: editForm.newAccountTipo, balance_actual: 0, iban: null });
      cuentaId = newAcc.id;
    }

    if (scope === "this_month") {
      if (editForm.es_fondo && editForm.createAccount) {
        const newAcc = await api.createAccount({ alias_real: editForm.nombre, alias_anonimo: null, banco: editForm.newAccountBanco, tipo: editForm.newAccountTipo, balance_actual: 0, iban: null });
        cuentaId = newAcc.id;
      }
      const structural = hasNonAmountStructuralChanges(editingEntry, editForm);
      if (structural) {
        await api.upsertMonthlyBudget({
          recurring_entry_id: editingEntry.id,
          mes: month,
          anio: year,
          monto_real: 0,
          excluido: true,
        });
        await api.createRecurringEntry({
          ...buildEntryUpdatePayload(editingEntry),
          es_ingreso: false,
          empresa: null,
          es_puntual: true,
          es_fondo: false,
          mes_inicio: month,
          anio_inicio: year,
          mes_fin: null,
          anio_fin: null,
          historial_precios: null,
          cuenta_destino_id: recurringChecklistAccount ?? cuentaId,
        });
        addToast(`Partida sustituida solo en ${monthScopeLabel}.`, "success");
      } else {
        await api.upsertMonthlyBudget({
          recurring_entry_id: editingEntry.id,
          mes: month,
          anio: year,
          monto_real: editForm.monto_estimado,
          excluido: false,
        });
        addToast(`Importe actualizado solo en ${monthScopeLabel}.`, "success");
      }
      await saveEntryMonthlyChecklist(
        editingEntry,
        {
          cuenta_gestion_id: checklistAccountId,
          movido_a_cuenta: editChecklistMoved,
        },
        { reload: false },
      );
      setEditingEntry(null);
      await loadAll({ silent: true });
      return;
    }

    // Suscripciones: historial de precios (meses anteriores conservan el importe).
    // Resto (ahorro, fondos, etc.): partir la serie — cerrar la antigua y crear
    // una nueva desde este mes, para no reescribir meses pasados vía monto_estimado.
    if (!isSub && entryAppliesBeforeMonth(editingEntry, month, year)) {
      const { mes_fin, anio_fin } = lastActiveMonthBefore(month, year);
      await api.updateRecurringEntry(editingEntry.id, {
        ...editingEntry,
        mes_fin,
        anio_fin,
      });
      const created = await api.createRecurringEntry({
        ...buildEntryUpdatePayload(editingEntry),
        es_ingreso: false,
        empresa: editingEntry.empresa ?? null,
        mes_inicio: month,
        anio_inicio: year,
        mes_fin: null,
        anio_fin: null,
        historial_precios: null,
        cuenta_destino_id: recurringChecklistAccount ?? cuentaId,
      });
      await api.upsertMonthlyBudget({
        recurring_entry_id: created.id,
        mes: month,
        anio: year,
        monto_real: editForm.monto_estimado,
        excluido: false,
        cuenta_gestion_id: checklistAccountId,
        movido_a_cuenta: editChecklistMoved,
        movido_checked_at: editChecklistMoved ? new Date().toISOString() : null,
      });
      setEditingEntry(null);
      await loadAll({ silent: true });
      addToast(`Partida actualizada desde ${monthScopeLabel}. Meses anteriores sin cambios.`, "success");
      return;
    }

    const priceHistory = isSub
      ? applySubscriptionPriceChange(editingEntry, editForm.monto_estimado, month, year)
      : editingEntry.historial_precios ?? null;
    await api.updateRecurringEntry(editingEntry.id, {
      ...editingEntry,
      ...buildEntryUpdatePayload(editingEntry),
      historial_precios: priceHistory,
      cuenta_destino_id: recurringChecklistAccount ?? cuentaId,
    });
    await api.upsertMonthlyBudget({
      recurring_entry_id: editingEntry.id,
      mes: month,
      anio: year,
      monto_real: editForm.monto_estimado,
      excluido: false,
    });
    await saveEntryMonthlyChecklist(
      editingEntry,
      {
        cuenta_gestion_id: checklistAccountId,
        movido_a_cuenta: editChecklistMoved,
      },
      { reload: false },
    );
    setEditingEntry(null);
    await loadAll({ silent: true });
    const priceChanged = isSub && Math.abs(editForm.monto_estimado - editingEntry.monto_estimado) >= 0.005;
    addToast(
      priceChanged
        ? `Precio actualizado desde ${monthScopeLabel}. Meses anteriores sin cambios.`
        : `Partida actualizada desde ${monthScopeLabel}.`,
      "success",
    );
  }
  useEffect(() => {
    if (fondoEntries.length === 0) {
      setFondoBalances({});
      return;
    }
    api.getFondoBalances().then(list => {
      const m: Record<number, number> = {};
      for (const f of list) m[f.id] = f.balance;
      setFondoBalances(m);
    }).catch(() => {});
  }, [fondoEntries]);

  const carteraOptions = useMemo(() =>
    [...new Set(investments.map(i => (i.cartera || "").trim()).filter(Boolean))],
    [investments]
  );

  const goalProgressOpts = useMemo(() => ({ debts, fondoBalances }), [debts, fondoBalances]);

  const toggleGroup = (name: string) =>
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  async function submitNewEntry() {
    const isSub = newEntry.tipo_partida === "suscripcion";
    const isAi = newEntry.tipo_partida === "ahorro_inversion";
    const isFondo = newEntry.tipo_partida === "gasto" && newEntry.es_fondo;
    let cuentaId: number | null = (isAi && newEntry.destino === "cuenta" || isFondo) && newEntry.cuenta_destino_id !== "" ? Number(newEntry.cuenta_destino_id) : null;
    if (isFondo && newEntry.createAccount) {
      const newAcc = await api.createAccount({ alias_real: newEntry.nombre, alias_anonimo: null, banco: newEntry.newAccountBanco, tipo: newEntry.newAccountTipo, balance_actual: 0, iban: null });
      cuentaId = newAcc.id;
    }
    await api.createRecurringEntry({
      nombre: newEntry.nombre,
      categoria: isSub ? "Suscripciones" : newEntry.categoria,
      monto_estimado: newEntry.monto_estimado,
      es_fijo: newEntry.es_fijo,
      es_ingreso: false,
      empresa: null,
      tipo_partida: newEntry.tipo_partida,
      cuenta_destino_id: cuentaId,
      cartera_destino: isAi && newEntry.destino === "cartera" && newEntry.cartera_destino ? newEntry.cartera_destino : null,
      bloque: newEntry.bloque || null,
      objetivo_monto: isAi && newEntry.destino === "cuenta" && newEntry.objetivo_monto !== "" ? Number(newEntry.objetivo_monto) : null,
      objetivo_fecha: isAi && newEntry.destino === "cuenta" && newEntry.objetivo_fecha ? newEntry.objetivo_fecha : null,
      rentabilidad_anual_pct: isAi && newEntry.rentabilidad_anual_pct !== "" ? Number(newEntry.rentabilidad_anual_pct) : null,
      mes_inicio: isSub ? newEntry.mes_inicio : month,
      anio_inicio: isSub ? newEntry.anio_inicio : year,
      es_puntual: isSub ? false : isFondo ? false : newEntry.es_puntual,
      es_fondo: isFondo,
      frecuencia: isSub ? newEntry.frecuencia : null,
      fecha_pago: isSub ? newEntry.fecha_pago : null,
      mes_cobro: isSub ? newEntry.mes_cobro : null,
      meses_excluidos: isSub && newEntry.meses_excluidos.length > 0 ? JSON.stringify(newEntry.meses_excluidos) : null,
      goal_id: newEntry.goal_id,
    });
    if (isFondo) {
      setExpandedGroups(prev => new Set([...prev, "__fondos__"]));
    }
    resetForm();
    setAddingEntry(false);
    await loadAll({ silent: true });
    addToast(isFondo ? "Fondo añadido al presupuesto." : isSub ? "Suscripción añadida." : "Partida añadida al presupuesto.", "success");
  }

  async function assignAvailableToLibre() {
    const amount = Math.round(availableToAssign * 100) / 100;
    if (amount <= 0.01) return;

    const libre = puntualGastoEntries.find((e) => isLibrePlannedGasto(e));
    if (libre) {
      const current = mbMap[libre.id] ?? libre.monto_estimado;
      const next = Math.round((current + amount) * 100) / 100;
      await api.upsertMonthlyBudget({
        recurring_entry_id: libre.id,
        mes: month,
        anio: year,
        monto_real: next,
      });
      addToast(`Añadidos ${formatEUR(amount)} a Libre (total ${formatEUR(next)}).`, "success");
    } else {
      const created = await api.createRecurringEntry({
        nombre: LIBRE_GASTO_NAME,
        categoria: "Deseos",
        monto_estimado: amount,
        es_fijo: false,
        es_ingreso: false,
        empresa: null,
        tipo_partida: "gasto",
        bloque: "deseos",
        cuenta_destino_id: null,
        cartera_destino: null,
        objetivo_monto: null,
        objetivo_fecha: null,
        mes_inicio: month,
        anio_inicio: year,
        es_puntual: true,
        es_fondo: false,
        frecuencia: null,
        fecha_pago: null,
        mes_cobro: null,
        meses_excluidos: null,
      });
      await api.upsertMonthlyBudget({
        recurring_entry_id: created.id,
        mes: month,
        anio: year,
        monto_real: amount,
      });
      setExpandedGroups((prev) => new Set([...prev, "__puntual__"]));
      addToast(`Asignados ${formatEUR(amount)} a gasto Libre (Deseos).`, "success");
    }
    await loadAll({ silent: true });
  }

  const payrollCompanyConfig = parseJsonValue<PayrollCompanyConfig>(settings.payroll_company_config ?? null, {});

  async function syncIncomeTransaction(opts: {
    description: string;
    amount: number;
    category: string;
    empresa?: string;
    preferredAccountId?: number | null;
  }) {
    const accountId = resolveIncomeAccountId(accounts, {
      empresa: opts.empresa,
      payrollConfig: payrollCompanyConfig,
      preferredAccountId: opts.preferredAccountId,
    });
    if (accountId == null) {
      addToast("Ingreso real guardado, pero no hay cuenta para crear el movimiento.", "info");
      return;
    }
    const empresaKey = (opts.empresa || "").trim().toLowerCase();
    const cfg = empresaKey ? payrollCompanyConfig[empresaKey] as { income_mode?: string } | undefined : undefined;
    const date = incomeTxDateIso(year, month, { incomeMode: cfg?.income_mode });
    try {
      const result = await ensureIncomeTransaction(
        { createTransaction: api.createTransaction, updateTransaction: api.updateTransaction },
        {
          description: opts.description,
          amount: opts.amount,
          accountId,
          category: opts.category,
          date,
          existing: monthlyTransactions,
        },
      );
      if (result === "created") {
        addToast("Movimiento de ingreso creado en Transacciones.", "success");
      } else if (result === "updated") {
        addToast("Movimiento de ingreso actualizado.", "success");
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : "No se pudo sincronizar el movimiento.", "error");
    }
  }

  async function savePayrollReal(empresa: string, val: number) {
    let entry = findPayrollEntry(recurringEntries, empresa);
    if (!entry) {
      entry = await api.createRecurringEntry({
        nombre: `Nómina ${empresa}`,
        monto_estimado: 0,
        es_ingreso: true,
        es_fijo: true,
        categoria: "Nómina",
        empresa,
        tipo_partida: null,
        cuenta_destino_id: null,
        cartera_destino: null,
        bloque: null,
        objetivo_monto: null,
        objetivo_fecha: null,
        mes_inicio: month,
        anio_inicio: year,
        es_puntual: false,
        es_fondo: false,
        frecuencia: null,
        fecha_pago: null,
        mes_cobro: null,
        meses_excluidos: null,
      });
    }
    await api.upsertMonthlyBudget({
      recurring_entry_id: entry.id,
      mes: month,
      anio: year,
      monto_real: val,
    });
    await syncIncomeTransaction({
      description: payrollIncomeTxDescription(empresa, month, year),
      amount: val,
      category: "Nómina",
      empresa,
      preferredAccountId: entry.cuenta_destino_id ?? null,
    });
    await loadAll({ silent: true });
  }

  const saveAssigned = async (entryId: number, val: number) => {
    try {
      await api.upsertMonthlyBudget({ recurring_entry_id: entryId, mes: month, anio: year, monto_real: val });
      setEditingId(null);
      const entry = recurringEntries.find((e) => e.id === entryId);
      if (entry?.es_ingreso) {
        await syncIncomeTransaction({
          description: otherIncomeTxDescription(entry.nombre, month, year),
          amount: val,
          category: entry.categoria || "Otros ingresos",
          empresa: entry.empresa || undefined,
          preferredAccountId: entry.cuenta_destino_id ?? null,
        });
      }
      await loadAll({ silent: true });
    } catch (err) {
      addToast(err instanceof Error ? err.message : "No se pudo guardar el importe.", "error");
    }
  };

  const copyFromPrev = async () => {
    setCopying(true);
    try {
      const result = await api.copyMonthlyBudget(prevMonth, prevYear, month, year);
      addToast(`Copiadas ${result.copied} partidas de ${MONTH_NAMES[prevMonth - 1]} ${prevYear}.`, "success");
      await loadAll({ silent: true });
    } catch {
      addToast("No hay presupuesto configurado en el mes anterior.", "error");
    } finally {
      setCopying(false);
    }
  };

  const apply503020Template = async () => {
    const net = totalIncomeExpected;
    if (net <= 0.01) return;
    const { deseos, ahorro } = split503020(net);
    setApplyingTemplate(true);
    try {
      let libre = activeExpenseEntries.find((e) => isLibrePlannedGasto(e));
      if (!libre) {
        libre = await api.createRecurringEntry({
          nombre: LIBRE_GASTO_NAME,
          categoria: "Deseos",
          monto_estimado: deseos,
          es_fijo: false,
          es_ingreso: false,
          empresa: null,
          tipo_partida: "gasto",
          bloque: "deseos",
          cuenta_destino_id: null,
          cartera_destino: null,
          objetivo_monto: null,
          objetivo_fecha: null,
          mes_inicio: month,
          anio_inicio: year,
          es_puntual: true,
          es_fondo: false,
          frecuencia: null,
          fecha_pago: null,
          mes_cobro: null,
          meses_excluidos: null,
        });
      }
      await api.upsertMonthlyBudget({
        recurring_entry_id: libre.id,
        mes: month,
        anio: year,
        monto_real: deseos,
      });

      let ahorroEntry = activeExpenseEntries.find((e) => isAhorroInversionTipo(e.tipo_partida));
      if (!ahorroEntry) {
        ahorroEntry = await api.createRecurringEntry({
          nombre: "Ahorro e inversión",
          categoria: "Ahorro",
          monto_estimado: ahorro,
          es_fijo: true,
          es_ingreso: false,
          empresa: null,
          tipo_partida: "ahorro_inversion",
          bloque: "ahorro_inversion",
          cuenta_destino_id: null,
          cartera_destino: null,
          objetivo_monto: null,
          objetivo_fecha: null,
          mes_inicio: month,
          anio_inicio: year,
          es_puntual: false,
          es_fondo: false,
          frecuencia: null,
          fecha_pago: null,
          mes_cobro: null,
          meses_excluidos: null,
        });
      }
      await api.upsertMonthlyBudget({
        recurring_entry_id: ahorroEntry.id,
        mes: month,
        anio: year,
        monto_real: ahorro,
      });

      await loadAll({ silent: true });
      addToast(
        `Plantilla 50/30/20: Libre ${formatEUR(deseos)} (30%) · Ahorro ${formatEUR(ahorro)} (20%). Necesidades (${formatEUR(templateSplit.necesidades)}) las defines con fondos y suscripciones.`,
        "success",
      );
    } catch (err) {
      addToast(err instanceof Error ? err.message : "No se pudo aplicar la plantilla.", "error");
    } finally {
      setApplyingTemplate(false);
    }
  };

  const resetForm = () => setNewEntry(emptyNewEntry(month, year));

  const availColor = availableToAssign > 0.01
    ? "var(--color-positive)"
    : availableToAssign < -0.01
    ? "var(--color-negative)"
    : "var(--text-muted)";

  async function promoteWishlistItem(wishlistId: number, nombre: string) {
    try {
      await api.promoteWishlistItem(wishlistId, month, year);
      setShowWishlistPicker(false);
      await loadAll({ silent: true });
      addToast(`"${nombre}" añadido al presupuesto. Sigue en la lista de deseos.`, "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "No se pudo añadir el deseo.", "error");
    }
  }

  async function saveIncomeSource(payload: Omit<RecurringEntry, "id">) {
    if (editingIncomeSource) {
      await api.updateRecurringEntry(editingIncomeSource.id, { ...editingIncomeSource, ...payload });
    } else {
      await api.createRecurringEntry(payload);
    }
    addToast(editingIncomeSource ? "Ingreso actualizado." : "Ingreso añadido.", "success");
    setAddingIncome(false);
    setEditingIncomeSource(null);
    await loadAll({ silent: true });
  }

  return {
    budget,
    editingId, setEditingId,
    editingVal, setEditingVal,
    addingIncome, setAddingIncome,
    editingIncomeSource, setEditingIncomeSource,
    editingIncomeKey, setEditingIncomeKey,
    expandedGroups, toggleGroup,
    addingEntry, setAddingEntry,
    newEntry, setNewEntry,
    copying, applyingTemplate,
    fondoBalances,
    showWishlistPicker, setShowWishlistPicker,
    editSubmit, deleteSubmit, addSubmit, debtMarkSubmit, debtExtraSubmit, libreSubmit,
    editingEntry, setEditingEntry,
    editForm, setEditForm,
    editChecklistAccountId, setEditChecklistAccountId,
    editChecklistMoved, setEditChecklistMoved,
    openEdit,
    restoreToMonth, pauseEntryThisMonth, cancelEntryFromMonth,
    submitDeleteEntry, submitEditEntry, submitNewEntry,
    assignAvailableToLibre, savePayrollReal, saveAssigned,
    copyFromPrev, apply503020Template, resetForm,
    markDebtInstallmentPaid, commitDebtExtraPayment, promoteWishlistItem, saveIncomeSource,
    getEntryMonthlyChecklist, saveEntryMonthlyChecklist,
    monthScopeLabel, carteraOptions, goalProgressOpts, availColor,
  };
}
