import type { Dispatch, SetStateAction } from "react";
import { GlassModal } from "../GlassModal";
import { ModalFormError } from "../ModalFormError";
import { GoalSelect } from "../goals/GoalSelect";
import type { Account, Goal, RecurringEntry, WishlistItem } from "../../types";
import type { MenuKey } from "../../config/ui";
import type { BudgetDestino, BudgetTipoPartida } from "../../utils/budgetTipo";
import { isWishlistActive } from "../../utils/wishlist";
import { isLibrePlannedGasto } from "../../hooks/useBudgetMonth";
import { MONTH_NAMES, type BudgetEntryFormState } from "../../hooks/useBudgetEntries";
import { budgetExpenseCategoryOptions } from "../../utils/expenseCategories";

/** UI-level "tipo" shown in the Nueva/Editar partida selector.
 * Fondo and Gasto planificado both persist as tipo_partida "gasto" —
 * only es_fondo tells them apart. Deuda has no form state of its own:
 * picking it just redirects to Pasivos. */
type UiTipoPartida = "fondo" | "gasto_planificado" | "deuda" | "ahorro_inversion" | "suscripcion";

function uiTipoFor(form: Pick<BudgetEntryFormState, "tipo_partida" | "es_fondo">): Exclude<UiTipoPartida, "deuda"> {
  if (form.tipo_partida === "gasto") return form.es_fondo ? "fondo" : "gasto_planificado";
  return form.tipo_partida;
}

type AsyncSubmit = {
  saving: boolean;
  error: string | null;
  run: (action: () => Promise<void>) => Promise<void>;
};

type Props = {
  month: number;
  year: number;
  accounts: Account[];
  goals: Goal[];
  wishlist: WishlistItem[];
  onNavigate: (key: MenuKey) => void;
  setShowWishlistPicker: (v: boolean) => void;
  carteraOptions: string[];
  monthScopeLabel: string;
  editingEntry: RecurringEntry | null;
  setEditingEntry: (entry: RecurringEntry | null) => void;
  editForm: BudgetEntryFormState;
  setEditForm: Dispatch<SetStateAction<BudgetEntryFormState>>;
  editChecklistAccountId: number | "";
  setEditChecklistAccountId: Dispatch<SetStateAction<number | "">>;
  editChecklistMoved: boolean;
  setEditChecklistMoved: Dispatch<SetStateAction<boolean>>;
  addingEntry: boolean;
  setAddingEntry: (v: boolean) => void;
  newEntry: BudgetEntryFormState;
  setNewEntry: Dispatch<SetStateAction<BudgetEntryFormState>>;
  editSubmit: AsyncSubmit;
  deleteSubmit: AsyncSubmit;
  addSubmit: AsyncSubmit;
  submitEditEntry: (scope: "this_month" | "following") => Promise<void>;
  submitDeleteEntry: (scope: "this_month" | "following") => Promise<void>;
  submitNewEntry: () => Promise<void>;
  resetForm: () => void;
};

export function BudgetEntryModals({
  month, year, accounts, goals, wishlist, onNavigate, setShowWishlistPicker, carteraOptions, monthScopeLabel,
  editingEntry, setEditingEntry, editForm, setEditForm,
  editChecklistAccountId, setEditChecklistAccountId, editChecklistMoved, setEditChecklistMoved,
  addingEntry, setAddingEntry, newEntry, setNewEntry,
  editSubmit, deleteSubmit, addSubmit,
  submitEditEntry, submitDeleteEntry, submitNewEntry, resetForm,
}: Props) {
  return (
    <>
    <GlassModal
      isOpen={!!editingEntry}
      onClose={() => setEditingEntry(null)}
      title="Editar partida"
    >
      <ModalFormError error={editSubmit.error} />
      <form onSubmit={e => {
        e.preventDefault();
        void editSubmit.run(() => submitEditEntry("following"));
      }}>
            <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
              {!editForm.es_ingreso && (
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1/-1" }}>
                  Tipo
                  <select
                    value={uiTipoFor(editForm)}
                    onChange={e => {
                      const v = e.target.value as Exclude<UiTipoPartida, "deuda">;
                      if (v === "fondo") setEditForm(p => ({ ...p, tipo_partida: "gasto", es_fondo: true }));
                      else if (v === "gasto_planificado") setEditForm(p => ({ ...p, tipo_partida: "gasto", es_fondo: false }));
                      else setEditForm(p => ({ ...p, tipo_partida: v as BudgetTipoPartida, es_fondo: false }));
                    }}
                  >
                    <option value="fondo">Fondo</option>
                    <option value="gasto_planificado">Gasto planificado</option>
                    <option value="ahorro_inversion">Ahorro e inversión</option>
                    <option value="suscripcion">Suscripción o factura</option>
                  </select>
                </label>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                Nombre
                <input autoFocus value={editForm.nombre} onChange={e => setEditForm(p => ({ ...p, nombre: e.target.value }))} required />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                Categoría
                <select value={editForm.categoria} onChange={e => setEditForm(p => ({ ...p, categoria: e.target.value }))}>
                  <option value="">— elegir —</option>
                  {budgetExpenseCategoryOptions(editForm.categoria).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                {editForm.tipo_partida === "suscripcion" && editForm.frecuencia === "anual" ? "Importe anual (€)" : "Importe mensual (€)"}
                <input type="number" step="0.01" value={editForm.monto_estimado || ""} onChange={e => setEditForm(p => ({ ...p, monto_estimado: parseFloat(e.target.value) || 0 }))} required />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                Tipo importe
                <select value={editForm.es_fijo ? "fijo" : "variable"} onChange={e => setEditForm(p => ({ ...p, es_fijo: e.target.value === "fijo" }))}>
                  <option value="fijo">Fijo</option>
                  <option value="variable">Variable</option>
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1/-1" }}>
                Cuenta de gestión (este mes)
                <select
                  value={editChecklistAccountId}
                  onChange={e => setEditChecklistAccountId(e.target.value === "" ? "" : Number(e.target.value))}
                >
                  <option value="">— Sin cuenta asignada</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.alias_real}{a.banco ? ` · ${a.banco}` : ""}
                    </option>
                  ))}
                </select>
                <small className="muted" style={{ fontSize: "0.78rem" }}>
                  Al guardar: puedes aplicar este cambio solo a {monthScopeLabel} o desde {monthScopeLabel} hacia adelante.
                </small>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", gridColumn: "1/-1" }}>
                <input
                  type="checkbox"
                  checked={editChecklistMoved}
                  onChange={e => setEditChecklistMoved(e.target.checked)}
                />
                Marcado como movido a cuenta (este mes)
              </label>
              {!editForm.es_ingreso && editForm.tipo_partida === "gasto" && (
                <>
                  {editingEntry && isLibrePlannedGasto(editingEntry) ? (
                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      Bloque 50/30/20
                      <span className="muted" style={{ fontSize: "0.9rem" }}>Deseos (30%) — fijo para Libre</span>
                    </label>
                  ) : (
                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      Bloque 50/30/20
                      <select value={editForm.bloque} onChange={e => setEditForm(p => ({ ...p, bloque: e.target.value as "" | "necesidades" | "deseos" | "ahorro_inversion" }))}>
                        <option value="">— Sin clasificar</option>
                        <option value="necesidades">Necesidades (50%)</option>
                        <option value="deseos">Deseos (30%)</option>
                        <option value="ahorro_inversion">Ahorro e inversión (20%)</option>
                      </select>
                    </label>
                  )}
                  {!(editingEntry && isLibrePlannedGasto(editingEntry)) && (
                  <>
                  {editForm.es_fondo && (
                    <p className="muted" style={{ fontSize: "0.78rem", gridColumn: "1/-1", margin: 0 }}>
                      Fondo: el saldo no consumido se acumula.
                    </p>
                  )}
                  {editForm.es_fondo && (
                    <div style={{ gridColumn: "1/-1", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Cuenta vinculada</span>
                      {!editForm.createAccount ? (
                        <>
                          <select required value={editForm.cuenta_destino_id} onChange={e => setEditForm(p => ({ ...p, cuenta_destino_id: e.target.value === "" ? "" : Number(e.target.value) }))}>
                            <option value="">— Selecciona una cuenta</option>
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.alias_real}{a.banco ? ` · ${a.banco}` : ""}</option>)}
                          </select>
                          <button type="button" className="btn-link" style={{ alignSelf: "flex-start", fontSize: "0.8rem" }} onClick={() => setEditForm(p => ({ ...p, createAccount: true, cuenta_destino_id: "" }))}>
                            + Crear nueva cuenta
                          </button>
                        </>
                      ) : (
                        <>
                          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--color-muted)" }}>
                            Se creará la cuenta <strong>"{editForm.nombre}"</strong>
                          </p>
                          <div className="form-grid-2">
                            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                              Banco
                              <input type="text" required value={editForm.newAccountBanco} placeholder="ej. ING, Revolut…" onChange={e => setEditForm(p => ({ ...p, newAccountBanco: e.target.value }))} />
                            </label>
                            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                              Tipo
                              <select value={editForm.newAccountTipo} onChange={e => setEditForm(p => ({ ...p, newAccountTipo: e.target.value }))}>
                                <option value="ahorro">Ahorro</option>
                                <option value="remunerada">Remunerada</option>
                                <option value="corriente">Corriente</option>
                                <option value="credito">Crédito</option>
                                <option value="inversion">Inversión</option>
                              </select>
                            </label>
                          </div>
                          <button type="button" className="btn-link" style={{ alignSelf: "flex-start", fontSize: "0.8rem" }} onClick={() => setEditForm(p => ({ ...p, createAccount: false, newAccountBanco: "", newAccountTipo: "ahorro" }))}>
                            ← Seleccionar cuenta existente
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  <GoalSelect
                    goals={goals}
                    value={editForm.goal_id}
                    onChange={(goal_id) => setEditForm((p) => ({ ...p, goal_id }))}
                    label="Objetivo vinculado (opcional)"
                  />
                  </>
                  )}
                </>
              )}
              {!editForm.es_ingreso && editForm.tipo_partida === "ahorro_inversion" && (
                <>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1/-1" }}>
                    Destino
                    <select value={editForm.destino} onChange={e => setEditForm(p => ({ ...p, destino: e.target.value as BudgetDestino, cuenta_destino_id: "", cartera_destino: "", objetivo_monto: "", objetivo_fecha: "" }))}>
                      <option value="cuenta">Cuenta</option>
                      <option value="cartera">Cartera</option>
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    Rentabilidad anual esperada (%)
                    <input
                      type="number" step="0.1" min="0" max="100" placeholder="Ej: 6 (opcional)"
                      value={editForm.rentabilidad_anual_pct}
                      onChange={e => setEditForm(p => ({ ...p, rentabilidad_anual_pct: e.target.value === "" ? "" : parseFloat(e.target.value) }))}
                    />
                    <small className="muted" style={{ fontSize: "0.78rem" }}>Si se indica, el saldo proyectado usa interés compuesto.</small>
                  </label>
                  {editForm.destino === "cuenta" && (<>
                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      Objetivo (€)
                      <input type="number" step="0.01" min="0" value={editForm.objetivo_monto} onChange={e => setEditForm(p => ({ ...p, objetivo_monto: e.target.value === "" ? "" : parseFloat(e.target.value) }))} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      Fecha objetivo
                      <input type="date" value={editForm.objetivo_fecha} onChange={e => setEditForm(p => ({ ...p, objetivo_fecha: e.target.value }))} />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1/-1" }}>
                      Cuenta vinculada
                      <select value={editForm.cuenta_destino_id} onChange={e => setEditForm(p => ({ ...p, cuenta_destino_id: e.target.value === "" ? "" : Number(e.target.value) }))}>
                        <option value="">— Sin vincular</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.alias_real}</option>)}
                      </select>
                    </label>
                  </>)}
                  {editForm.destino === "cartera" && (
                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1/-1" }}>
                      Cartera vinculada
                      <input list="cartera-edit-list" value={editForm.cartera_destino} onChange={e => setEditForm(p => ({ ...p, cartera_destino: e.target.value }))} />
                      <datalist id="cartera-edit-list">{carteraOptions.map(c => <option key={c} value={c} />)}</datalist>
                    </label>
                  )}
                </>
              )}
              {editForm.tipo_partida === "suscripcion" && (<>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1/-1" }}>
                  Inicio en presupuesto
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <select value={editForm.mes_inicio} onChange={e => setEditForm(p => ({ ...p, mes_inicio: Number(e.target.value) }))}>
                      <option value={0}>Activa siempre (sin fecha)</option>
                      {MONTH_NAMES.map((m, i) => (
                        <option key={i + 1} value={i + 1}>{m}</option>
                      ))}
                    </select>
                    {editForm.mes_inicio > 0 && (
                      <input type="number" min={2000} max={2100} value={editForm.anio_inicio} onChange={e => setEditForm(p => ({ ...p, anio_inicio: Number(e.target.value) || year }))} required style={{ width: "5.5rem" }} />
                    )}
                  </div>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  Frecuencia
                  <select value={editForm.frecuencia} onChange={e => {
                    const frecuencia = e.target.value as "mensual" | "anual";
                    setEditForm(p => ({
                      ...p,
                      frecuencia,
                      mes_cobro: frecuencia === "anual" && p.mes_cobro === 1 && p.mes_inicio ? p.mes_inicio : p.mes_cobro,
                    }));
                  }}>
                    <option value="mensual">Mensual</option>
                    <option value="anual">Anual</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  Día de cobro
                  <input type="number" min={1} max={28} value={editForm.fecha_pago} onChange={e => setEditForm(p => ({ ...p, fecha_pago: Number(e.target.value) || 1 }))} />
                </label>
                {editForm.frecuencia === "anual" && (
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    Mes de cobro
                    <select value={editForm.mes_cobro} onChange={e => setEditForm(p => ({ ...p, mes_cobro: Number(e.target.value) }))}>
                      {["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"].map((m, i) => (
                        <option key={i + 1} value={i + 1}>{m}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  Bloque 50/30/20
                  <select value={editForm.bloque} onChange={e => setEditForm(p => ({ ...p, bloque: e.target.value as "" | "necesidades" | "deseos" | "ahorro_inversion" }))}>
                    <option value="">— Sin clasificar</option>
                    <option value="necesidades">Necesidades (50%)</option>
                    <option value="deseos">Deseos (30%)</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1/-1" }}>
                  Meses excluidos (pausa la suscripción en esos meses)
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.25rem" }}>
                    {["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"].map((m, i) => {
                      const num = i + 1;
                      const checked = editForm.meses_excluidos.includes(num);
                      return (
                        <label key={num} style={{ display: "flex", alignItems: "center", gap: "0.2rem", fontSize: "0.8rem", cursor: "pointer" }}>
                          <input type="checkbox" checked={checked} onChange={() => setEditForm(p => ({
                            ...p,
                            meses_excluidos: checked ? p.meses_excluidos.filter(x => x !== num) : [...p.meses_excluidos, num]
                          }))} />
                          {m}
                        </label>
                      );
                    })}
                  </div>
                </label>
              </>)}
            </div>
            <div className="modal-actions" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}>
              <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>
                ¿Aplicar cambios solo en {monthScopeLabel} o también en los meses siguientes?
              </p>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={editSubmit.saving}
                  onClick={() => void editSubmit.run(() => submitEditEntry("this_month"))}
                >
                  {editSubmit.saving ? "Guardando…" : "Solo este mes"}
                </button>
                <button type="submit" disabled={editSubmit.saving}>
                  {editSubmit.saving ? "Guardando…" : "Este mes y siguientes"}
                </button>
                <button type="button" className="button-secondary" onClick={() => setEditingEntry(null)}>Cancelar</button>
              </div>
            </div>
            <div
              className="modal-actions"
              style={{
                flexDirection: "column",
                alignItems: "stretch",
                gap: "0.5rem",
                marginTop: "0.75rem",
                paddingTop: "0.75rem",
                borderTop: "1px solid var(--border-soft)",
              }}
            >
              <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>
                ¿Borrar esta partida solo en {monthScopeLabel} o también en los meses siguientes?
              </p>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="button-secondary danger"
                  disabled={deleteSubmit.saving || editSubmit.saving}
                  onClick={() => void deleteSubmit.run(() => submitDeleteEntry("this_month"))}
                >
                  {deleteSubmit.saving ? "Borrando…" : "Borrar solo este mes"}
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={deleteSubmit.saving || editSubmit.saving}
                  onClick={() => void deleteSubmit.run(() => submitDeleteEntry("following"))}
                >
                  {deleteSubmit.saving ? "Borrando…" : "Borrar este mes y siguientes"}
                </button>
              </div>
            </div>
          </form>
    </GlassModal>

    <GlassModal
      isOpen={addingEntry}
      onClose={() => { setAddingEntry(false); resetForm(); }}
      title="Nueva partida de presupuesto"
    >
      <ModalFormError error={addSubmit.error} />
      <form onSubmit={e => {
        e.preventDefault();
        void addSubmit.run(submitNewEntry);
      }}>
            <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1/-1" }}>
                Tipo
                <select
                  value={uiTipoFor(newEntry)}
                  onChange={e => {
                    const v = e.target.value as UiTipoPartida;
                    if (v === "deuda") {
                      setAddingEntry(false);
                      resetForm();
                      onNavigate("Pasivos");
                      return;
                    }
                    if (v === "fondo") setNewEntry(p => ({ ...p, tipo_partida: "gasto", es_fondo: true, es_puntual: false }));
                    else if (v === "gasto_planificado") setNewEntry(p => ({ ...p, tipo_partida: "gasto", es_fondo: false }));
                    else setNewEntry(p => ({ ...p, tipo_partida: v as BudgetTipoPartida, es_fondo: false }));
                  }}
                >
                  <option value="fondo">Fondo</option>
                  <option value="gasto_planificado">Gasto planificado</option>
                  <option value="deuda">Deuda</option>
                  <option value="ahorro_inversion">Ahorro e inversión</option>
                  <option value="suscripcion">Suscripción o factura</option>
                </select>
              </label>
              {newEntry.tipo_partida === "gasto" && !newEntry.es_fondo && wishlist.some(isWishlistActive) && (
                <p style={{ gridColumn: "1/-1", margin: 0, fontSize: "0.85rem" }}>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => {
                      setAddingEntry(false);
                      resetForm();
                      setShowWishlistPicker(true);
                    }}
                  >
                    → Elegir de tu lista de deseos
                  </button>
                </p>
              )}
              {newEntry.tipo_partida !== "suscripcion" && !newEntry.es_fondo && (
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1/-1" }}>
                  Recurrencia
                  <select value={newEntry.es_puntual ? "puntual" : "recurrente"} onChange={e => setNewEntry(p => ({ ...p, es_puntual: e.target.value === "puntual" }))}>
                    <option value="recurrente">Recurrente — aparece todos los meses a partir de {MONTH_NAMES[month - 1]} {year}</option>
                    <option value="puntual">Puntual — solo {MONTH_NAMES[month - 1]} {year}</option>
                  </select>
                </label>
              )}
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                Nombre
                <input autoFocus value={newEntry.nombre} onChange={e => setNewEntry(p => ({ ...p, nombre: e.target.value }))} required />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                {newEntry.tipo_partida === "suscripcion" && newEntry.frecuencia === "anual" ? "Importe anual (€)" : "Importe mensual (€)"}
                <input type="number" step="0.01" value={newEntry.monto_estimado || ""} onChange={e => setNewEntry(p => ({ ...p, monto_estimado: parseFloat(e.target.value) || 0 }))} required />
              </label>
              {newEntry.tipo_partida === "gasto" && (
                <>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    Bloque 50/30/20
                    <select value={newEntry.bloque} onChange={e => setNewEntry(p => ({ ...p, bloque: e.target.value as "" | "necesidades" | "deseos" | "ahorro_inversion" }))}>
                      <option value="">— Sin clasificar</option>
                      <option value="necesidades">Necesidades (50%)</option>
                      <option value="deseos">Deseos (30%)</option>
                      <option value="ahorro_inversion">Ahorro e inversión (20%)</option>
                    </select>
                  </label>
                  {newEntry.es_fondo && (
                    <p className="muted" style={{ fontSize: "0.78rem", gridColumn: "1/-1", margin: 0 }}>
                      Fondo: el saldo no consumido se acumula.
                    </p>
                  )}
                  {newEntry.es_fondo && (
                    <div style={{ gridColumn: "1/-1", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Cuenta vinculada</span>
                      {!newEntry.createAccount ? (
                        <>
                          <select required value={newEntry.cuenta_destino_id} onChange={e => setNewEntry(p => ({ ...p, cuenta_destino_id: e.target.value === "" ? "" : Number(e.target.value) }))}>
                            <option value="">— Selecciona una cuenta</option>
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.alias_real}{a.banco ? ` · ${a.banco}` : ""}</option>)}
                          </select>
                          <button type="button" className="btn-link" style={{ alignSelf: "flex-start", fontSize: "0.8rem" }} onClick={() => setNewEntry(p => ({ ...p, createAccount: true, cuenta_destino_id: "" }))}>
                            + Crear nueva cuenta
                          </button>
                        </>
                      ) : (
                        <>
                          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--color-muted)" }}>
                            Se creará la cuenta <strong>"{newEntry.nombre}"</strong>
                          </p>
                          <div className="form-grid-2">
                            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                              Banco
                              <input type="text" required value={newEntry.newAccountBanco} placeholder="ej. ING, Revolut…" onChange={e => setNewEntry(p => ({ ...p, newAccountBanco: e.target.value }))} />
                            </label>
                            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                              Tipo
                              <select value={newEntry.newAccountTipo} onChange={e => setNewEntry(p => ({ ...p, newAccountTipo: e.target.value }))}>
                                <option value="ahorro">Ahorro</option>
                                <option value="remunerada">Remunerada</option>
                                <option value="corriente">Corriente</option>
                                <option value="credito">Crédito</option>
                                <option value="inversion">Inversión</option>
                              </select>
                            </label>
                          </div>
                          <button type="button" className="btn-link" style={{ alignSelf: "flex-start", fontSize: "0.8rem" }} onClick={() => setNewEntry(p => ({ ...p, createAccount: false, newAccountBanco: "", newAccountTipo: "ahorro" }))}>
                            ← Seleccionar cuenta existente
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  <GoalSelect
                    goals={goals}
                    value={newEntry.goal_id}
                    onChange={(goal_id) => setNewEntry((p) => ({ ...p, goal_id }))}
                    label="Objetivo vinculado (opcional)"
                  />
                </>
              )}
              {newEntry.tipo_partida === "ahorro_inversion" && (<>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1/-1" }}>
                  Destino
                  <select value={newEntry.destino} onChange={e => setNewEntry(p => ({ ...p, destino: e.target.value as BudgetDestino, cuenta_destino_id: "", cartera_destino: "", objetivo_monto: "", objetivo_fecha: "" }))}>
                    <option value="cuenta">Cuenta</option>
                    <option value="cartera">Cartera</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  Rentabilidad anual esperada (%)
                  <input
                    type="number" step="0.1" min="0" max="100" placeholder="Ej: 6 (opcional)"
                    value={newEntry.rentabilidad_anual_pct}
                    onChange={e => setNewEntry(p => ({ ...p, rentabilidad_anual_pct: e.target.value === "" ? "" : parseFloat(e.target.value) }))}
                  />
                  <small className="muted" style={{ fontSize: "0.78rem" }}>Si se indica, el saldo proyectado usa interés compuesto.</small>
                </label>
                {newEntry.destino === "cuenta" && (<>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    Objetivo (€)
                    <input type="number" step="0.01" min="0" placeholder="Ej: 3000" value={newEntry.objetivo_monto} onChange={e => setNewEntry(p => ({ ...p, objetivo_monto: e.target.value === "" ? "" : parseFloat(e.target.value) }))} />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    Fecha objetivo
                    <input type="date" value={newEntry.objetivo_fecha} onChange={e => setNewEntry(p => ({ ...p, objetivo_fecha: e.target.value }))} />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1/-1" }}>
                    Cuenta de ahorro vinculada
                    <select value={newEntry.cuenta_destino_id} onChange={e => setNewEntry(p => ({ ...p, cuenta_destino_id: e.target.value === "" ? "" : Number(e.target.value) }))}>
                      <option value="">— Sin vincular</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.alias_real}</option>)}
                    </select>
                  </label>
                </>)}
                {newEntry.destino === "cartera" && (
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1/-1" }}>
                    Cartera vinculada
                    <input
                      list="cartera-budget-list"
                      value={newEntry.cartera_destino}
                      placeholder="Ej: MyInvestor"
                      onChange={e => setNewEntry(p => ({ ...p, cartera_destino: e.target.value }))}
                    />
                    <datalist id="cartera-budget-list">
                      {carteraOptions.map(c => <option key={c} value={c} />)}
                    </datalist>
                  </label>
                )}
              </>)}
              {newEntry.tipo_partida === "suscripcion" && (<>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", gridColumn: "1/-1" }}>
                  Inicio en presupuesto
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <select value={newEntry.mes_inicio} onChange={e => setNewEntry(p => ({ ...p, mes_inicio: Number(e.target.value) }))}>
                      {MONTH_NAMES.map((m, i) => (
                        <option key={i + 1} value={i + 1}>{m}</option>
                      ))}
                    </select>
                    <input type="number" min={2000} max={2100} value={newEntry.anio_inicio} onChange={e => setNewEntry(p => ({ ...p, anio_inicio: Number(e.target.value) || year }))} required style={{ width: "5.5rem" }} />
                  </div>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  Frecuencia
                  <select value={newEntry.frecuencia} onChange={e => {
                    const frecuencia = e.target.value as "mensual" | "anual";
                    setNewEntry(p => ({
                      ...p,
                      frecuencia,
                      mes_cobro: frecuencia === "anual" && p.mes_cobro === 1 ? p.mes_inicio : p.mes_cobro,
                    }));
                  }}>
                    <option value="mensual">Mensual</option>
                    <option value="anual">Anual</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  Día de cobro
                  <input type="number" min={1} max={28} value={newEntry.fecha_pago} onChange={e => setNewEntry(p => ({ ...p, fecha_pago: Number(e.target.value) || 1 }))} />
                </label>
                {newEntry.frecuencia === "anual" && (
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    Mes de cobro
                    <select value={newEntry.mes_cobro} onChange={e => setNewEntry(p => ({ ...p, mes_cobro: Number(e.target.value) }))}>
                      {MONTH_NAMES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                    </select>
                  </label>
                )}
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  Bloque 50/30/20
                  <select value={newEntry.bloque} onChange={e => setNewEntry(p => ({ ...p, bloque: e.target.value as "" | "necesidades" | "deseos" | "ahorro_inversion" }))}>
                    <option value="">— Sin clasificar</option>
                    <option value="necesidades">Necesidades (50%)</option>
                    <option value="deseos">Deseos (30%)</option>
                  </select>
                </label>
              </>)}
            </div>
            <div className="modal-actions">
              <button type="button" className="button-secondary" onClick={() => { setAddingEntry(false); resetForm(); }}>Cancelar</button>
              <button type="submit" disabled={addSubmit.saving}>{addSubmit.saving ? "Guardando…" : "Añadir"}</button>
            </div>
          </form>
    </GlassModal>
    </>
  );
}
