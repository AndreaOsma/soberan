import { api } from "../../services/api";
import { EmptyState } from "../../components/EmptyState";
import { GoalProgressBlock } from "../../components/goals/GoalProgressBlock";
import { wishlistPriorityClass } from "../../utils/statusColors";
import { isWishlistActive, isWishlistArchived } from "../../utils/wishlist";
import { buildGoalProgressSnapshot, goalProgressLabel } from "../../utils/goalProgress";
import type { Account, Debt, Goal, Investment, MonthlyBudget, RecurringEntry, WishlistItem } from "../../types";
import type { Dispatch, SetStateAction } from "react";

const MONTH_NAMES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

type Props = {
  accounts: Account[];
  goals: Goal[];
  debts: Debt[];
  investments: Investment[];
  wishlist: WishlistItem[];
  recurringEntries: RecurringEntry[];
  monthlyBudgets: MonthlyBudget[];
  month: number;
  year: number;
  formatEUR: (v: number) => string;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  deleteWithUndo: (label: string, onCommit: () => Promise<void>) => void;
  fondoBalances: Record<number, number>;
  showCompletedGoals: boolean;
  setShowCompletedGoals: Dispatch<SetStateAction<boolean>>;
  showArchivedWishlist: boolean;
  setShowArchivedWishlist: Dispatch<SetStateAction<boolean>>;
  setIsGoalFormOpen: (v: boolean) => void;
  setIsWishlistFormOpen: (v: boolean) => void;
  setEditGoalModal: (v: Goal | null) => void;
  setEditWishlistModal: (v: WishlistItem | null) => void;
  setPromoteModal: (v: WishlistItem | null) => void;
  setPromoteMonth: (v: number) => void;
  setPromoteYear: (v: number) => void;
  setPurchaseModal: (v: WishlistItem | null) => void;
};

export function GoalsWishlistPanel({
  accounts, goals, debts, investments, wishlist, recurringEntries, monthlyBudgets,
  month, year, formatEUR, loadAll, deleteWithUndo,
  fondoBalances,
  showCompletedGoals, setShowCompletedGoals,
  showArchivedWishlist, setShowArchivedWishlist,
  setIsGoalFormOpen, setIsWishlistFormOpen,
  setEditGoalModal, setEditWishlistModal,
  setPromoteModal, setPromoteMonth, setPromoteYear, setPurchaseModal,
}: Props) {
  return (
        <section className="grid one-col">
          <article className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2>Objetivos</h2>
              <button onClick={() => setIsGoalFormOpen(true)}>+ Nuevo objetivo</button>
            </div>
            {goals.length === 0 ? (
              <EmptyState
                icon="🎯"
                title="Sin objetivos definidos"
                description="Define metas financieras para conectar tu ahorro con propósitos concretos."
                actionLabel="+ Añadir objetivo"
                onAction={() => setIsGoalFormOpen(true)}
              />
            ) : (() => {
              const goalOpts = { debts, fondoBalances };
              const activeGoals = goals.filter(g => !buildGoalProgressSnapshot(g, accounts, investments, recurringEntries, monthlyBudgets, month, year, goalOpts).isComplete);
              const completedGoals = goals.filter(g => buildGoalProgressSnapshot(g, accounts, investments, recurringEntries, monthlyBudgets, month, year, goalOpts).isComplete);
              const visibleGoals = showCompletedGoals ? goals : activeGoals;
              return (
                <>
                  <ul className="goals-list">
                    {visibleGoals.map((goal) => {
                      const linkedAccount = goal.account_id ? accounts.find(a => a.id === goal.account_id) : null;
                      const snapshot = buildGoalProgressSnapshot(goal, accounts, investments, recurringEntries, monthlyBudgets, month, year, goalOpts);
                      const daysToDeadline = goal.fecha_limite
                        ? Math.ceil((new Date(goal.fecha_limite).getTime() - Date.now()) / 86_400_000)
                        : null;
                      return (
                        <li key={goal.id} style={snapshot.isComplete ? { opacity: 0.5 } : undefined}>
                          <div className="goal-header">
                            <div>
                              <span>{snapshot.isComplete && "✓ "}{goal.nombre}</span>
                              {linkedAccount && (
                                <small className="muted" style={{ marginLeft: "0.5rem" }}>
                                  · {linkedAccount.alias_real}
                                </small>
                              )}
                              {goal.cartera_destino && (
                                <small className="muted" style={{ marginLeft: "0.5rem" }}>
                                  · {goal.cartera_destino}
                                </small>
                              )}
                            </div>
                            <div className="inline-actions">
                              <button type="button" className="button-secondary" style={{ padding: "0.25rem 0.5rem" }}
                                aria-label={`Editar objetivo ${goal.nombre}`} title="Editar"
                                onClick={() => setEditGoalModal(goal)}>✎</button>
                              <button type="button" className="danger"
                                aria-label={`Eliminar objetivo ${goal.nombre}`} title="Eliminar"
                                onClick={() => deleteWithUndo("Meta", () => api.deleteGoal(goal.id).then(() => loadAll()))}>
                                🗑
                              </button>
                            </div>
                          </div>
                          <GoalProgressBlock snapshot={snapshot} formatEUR={formatEUR} />
                          <small className="muted" style={{ display: "block", marginTop: "0.35rem" }}>
                            Fuente: {goalProgressLabel(snapshot)}
                            {snapshot.monthlyContribution > 0 ? (
                              <> · Aportación en presupuesto ({MONTH_NAMES[month - 1]} {year}): <span className="sensitive">{formatEUR(snapshot.monthlyContribution)}</span>/mes</>
                            ) : snapshot.fundingKind === "partidas" ? (
                              <> · Sin aportación planificada este mes</>
                            ) : null}
                            {!snapshot.isComplete && daysToDeadline !== null && daysToDeadline < 180 && (
                              <span className={daysToDeadline < 30 ? "negative" : ""}> · vence en {daysToDeadline}d</span>
                            )}
                          </small>
                        </li>
                      );
                    })}
                  </ul>
                  {completedGoals.length > 0 && (
                    <button
                      type="button"
                      className="button-secondary"
                      style={{ marginTop: "0.75rem", fontSize: "0.8rem" }}
                      onClick={() => setShowCompletedGoals(v => !v)}
                    >
                      {showCompletedGoals
                        ? "Ocultar completadas"
                        : `Ver completadas (${completedGoals.length})`}
                    </button>
                  )}
                </>
              );
            })()}
          </article>

          <article className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h2>Lista de deseos</h2>
              <button onClick={() => setIsWishlistFormOpen(true)}>+ Añadir</button>
            </div>
            {(() => {
              const activeWishlist = wishlist.filter(isWishlistActive);
              const archivedWishlist = wishlist.filter(isWishlistArchived);
              const visibleWishlist = showArchivedWishlist ? wishlist : activeWishlist;

              if (wishlist.length === 0) {
                return (
                  <EmptyState
                    icon="✨"
                    title="Sin deseos anotados"
                    description="Apunta cosas que quieres comprar algún día sin comprometerte todavía."
                    actionLabel="+ Añadir deseo"
                    onAction={() => setIsWishlistFormOpen(true)}
                  />
                );
              }

              return (
                <>
                  {activeWishlist.length === 0 && !showArchivedWishlist ? (
                    <p className="muted" style={{ fontSize: "0.88rem" }}>
                      No hay deseos activos.{" "}
                      {archivedWishlist.length > 0 && (
                        <button type="button" className="button-secondary" style={{ fontSize: "inherit", padding: "0.1rem 0.35rem" }}
                          onClick={() => setShowArchivedWishlist(true)}>
                          Ver archivados ({archivedWishlist.length})
                        </button>
                      )}
                    </p>
                  ) : (
                    <ul className="list">
                      {visibleWishlist.map(item => {
                        const archived = isWishlistArchived(item);
                        return (
                          <li key={item.id} style={{ opacity: archived ? 0.55 : 1 }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", flex: 1 }}>
                              <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                                <span className={`wishlist-priority-dot ${wishlistPriorityClass(item.prioridad)}`} />
                                {archived ? <s>{item.nombre}</s> : item.nombre}
                                {item.recurring_entry_id && !archived && (
                                  <span className="muted" style={{ fontSize: "0.72rem", padding: "0.05rem 0.35rem", borderRadius: "0.25rem", background: "var(--glass-bg)" }}>
                                    en presupuesto
                                  </span>
                                )}
                                {archived && item.monto_real != null && (
                                  <span className="muted sensitive" style={{ fontSize: "0.75rem" }}>
                                    pagado {formatEUR(item.monto_real)}
                                  </span>
                                )}
                                {item.url && (
                                  <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.7rem", opacity: 0.6 }}>↗</a>
                                )}
                              </span>
                              {item.notas && <small className="muted" style={{ fontSize: "0.75rem" }}>{item.notas}</small>}
                            </div>
                            <div className="inline-actions" style={{ fontSize: "0.83rem" }}>
                              {!archived && item.monto_estimado != null && (
                                <span className="muted sensitive">{formatEUR(item.monto_estimado)}</span>
                              )}
                              {!archived && (
                                <>
                                  <button type="button" title="Añadir al presupuesto"
                                    style={{ padding: "0.2rem 0.4rem", fontSize: "0.75rem" }}
                                    className="button-secondary"
                                    onClick={() => { setPromoteModal(item); setPromoteMonth(new Date().getMonth() + 1); setPromoteYear(new Date().getFullYear()); }}>
                                    → plan
                                  </button>
                                  <button type="button" title="Marcar como comprado"
                                    style={{ padding: "0.2rem 0.4rem", fontSize: "0.75rem" }}
                                    className="button-secondary"
                                    onClick={() => setPurchaseModal(item)}>
                                    ✓ comprado
                                  </button>
                                  <button type="button" className="button-secondary" style={{ padding: "0.2rem 0.4rem" }}
                                    aria-label={`Editar deseo ${item.nombre}`} title="Editar"
                                    onClick={() => setEditWishlistModal(item)}>✎</button>
                                  <button type="button" className="danger"
                                    aria-label={`Eliminar deseo ${item.nombre}`} title="Eliminar"
                                    onClick={() => deleteWithUndo("Deseo", () => api.deleteWishlistItem(item.id).then(() => loadAll()))}>🗑</button>
                                </>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {archivedWishlist.length > 0 && (
                    <button type="button" className="button-secondary" style={{ marginTop: "0.75rem", fontSize: "0.82rem" }}
                      onClick={() => setShowArchivedWishlist(v => !v)}>
                      {showArchivedWishlist
                        ? "Ocultar archivados"
                        : `Ver archivados (${archivedWishlist.length})`}
                    </button>
                  )}
                </>
              );
            })()}
          </article>
        </section>
  );
}
