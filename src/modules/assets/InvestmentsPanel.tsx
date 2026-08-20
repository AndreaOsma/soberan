import { useState } from "react";
import { api } from "../../services/api";
import { GlassModal } from "../../components/GlassModal";
import { InvestmentModal } from "../../components/modals/InvestmentModal";
import type { Account, Investment } from "../../types";
import { parseNum } from "../../utils/format";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { InvestmentsConnectPanel } from "../../components/data/InvestmentsConnectPanel";
import { ModalFormError } from "../../components/ModalFormError";

type KrakenBalance = { asset: string; amount: number; eur_value: number | null; eur_price: number | null; type: string };

export type InvestmentsPanelProps = {
  accounts: Account[];
  investments: Investment[];
  settings: Record<string, string>;
  krakenBalances: KrakenBalance[];
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  deleteWithUndo: (label: string, onCommit: () => Promise<void>) => void;
};

export function InvestmentsPanel({
  accounts, investments, settings, krakenBalances,
  formatEUR, addToast, loadAll, deleteWithUndo,
}: InvestmentsPanelProps) {
  const [cryptoExpanded, setCryptoExpanded] = useState(false);
  const [showInvestmentForm, setShowInvestmentForm] = useState(false);
  const [investmentForm, setInvestmentForm] = useState({
    nombre: "", monto_invertido: 0, valor_actual: 0, tipo: "Inv", cartera: "", fecha_inicio: ""
  });
  const [editInvestmentModal, setEditInvestmentModal] = useState<Investment | null>(null);
  const createSubmit = useAsyncSubmit();

  const TIPO_ALIASES: Record<string, string> = {
    fondos_indexados: "fondo", fondo_indexado: "fondo", fondos: "fondo", indexado: "fondo",
  };
  const normTipo = (t: string | undefined) => TIPO_ALIASES[t ?? ""] ?? t ?? "Inv";
  const TIPO_LABEL: Record<string, string> = {
    Inv: "General", ETF: "ETF", fondo: "Fondo indexado",
    accion: "Acciones", crypto: "Cripto",
    pension: "Pensión / Seguro", deuda: "Renta fija", efectivo: "Efectivo",
  };

  const totalInvested = investments.reduce((s, i) => s + Number(i.monto_invertido || 0), 0);
  const totalCurrent = investments.reduce((s, i) => s + Number(i.valor_actual || 0), 0);
  const pnl = totalCurrent - totalInvested;
  const pnlPct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;

  const nonCryptoInvestments = investments.filter((i) => i.tipo !== "crypto");
  const carteras = [...new Set(nonCryptoInvestments.map((i) => (i.cartera || "").trim() || "Sin cartera"))].sort();
  const showCarteraHeaders = carteras.length > 1 || (carteras.length === 1 && carteras[0] !== "Sin cartera");

  return (
    <>
      <section className="grid">
        <InvestmentsConnectPanel
          accounts={accounts}
          investments={investments}
          settings={settings}
          krakenBalances={krakenBalances}
          formatEUR={formatEUR}
          addToast={addToast}
          loadAll={loadAll}
        />
        {investments.length > 0 && (
          <article className="card inv-summary">
            <div className="inv-summary__kpis">
              <div className="inv-summary__kpi">
                <span className="muted">Invertido</span>
                <strong className="sensitive">{formatEUR(totalInvested)}</strong>
              </div>
              <div className="inv-summary__sep" />
              <div className="inv-summary__kpi">
                <span className="muted">Valor actual</span>
                <strong className="sensitive">{formatEUR(totalCurrent)}</strong>
              </div>
              <div className="inv-summary__sep" />
              <div className="inv-summary__kpi">
                <span className="muted">P&L</span>
                <strong className={pnl >= 0 ? "positive" : "negative"}>
                  {pnl >= 0 ? "+" : ""}{formatEUR(pnl)}
                </strong>
              </div>
              <div className="inv-summary__sep" />
              <div className="inv-summary__kpi">
                <span className="muted">Rentabilidad</span>
                <strong className={pnlPct >= 0 ? "positive" : "negative"}>
                  {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                </strong>
              </div>
            </div>
          </article>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" onClick={() => setShowInvestmentForm(true)}>+ Añadir inversión</button>
        </div>

        {investments.length === 0 ? (
          <article className="card">
            <div className="empty-state">
              <div className="empty-state-icon">📈</div>
              <h3>Sin inversiones registradas</h3>
              <p>Registra tus fondos, acciones o criptomonedas para hacer seguimiento de tu patrimonio.</p>
            </div>
          </article>
        ) : (
          carteras.map((cartera) => {
            const carteraItems = nonCryptoInvestments.filter((i) => ((i.cartera || "").trim() || "Sin cartera") === cartera);
            const carteraTotal = carteraItems.reduce((s, i) => s + Number(i.valor_actual || 0), 0);
            const carteraInvested = carteraItems.reduce((s, i) => s + Number(i.monto_invertido || 0), 0);
            const carteraPnl = carteraTotal - carteraInvested;
            const carteraPct = carteraInvested > 0 ? (carteraPnl / carteraInvested) * 100 : null;
            const tiposInCartera = [...new Set(carteraItems.map((i) => normTipo(i.tipo)))];

            return (
              <article key={cartera} className="card">
                {showCarteraHeaders && (
                  <div className="inv-cartera-head">
                    <h3 className="inv-cartera-head__name">{cartera}</h3>
                    <div className="inv-cartera-head__kpis">
                      <span className="sensitive">{formatEUR(carteraTotal)}</span>
                      {carteraPct !== null && (
                        <span className={`inv-pnl-badge ${carteraPnl >= 0 ? "positive" : "negative"}`}>
                          {carteraPnl >= 0 ? "+" : ""}{formatEUR(carteraPnl)} ({carteraPct >= 0 ? "+" : ""}{carteraPct.toFixed(1)}%)
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {tiposInCartera.map((tipo) => {
                  const group = carteraItems.filter((i) => normTipo(i.tipo) === tipo);
                  const groupTotal = group.reduce((s, i) => s + Number(i.valor_actual || 0), 0);
                  const groupInvested = group.reduce((s, i) => s + Number(i.monto_invertido || 0), 0);
                  const groupPnl = groupTotal - groupInvested;
                  return (
                    <div key={tipo} className="inv-tipo-section">
                      <div className="inv-group-head">
                        <span className="inv-group-head__label muted">{TIPO_LABEL[tipo] ?? tipo}</span>
                        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                          <span className="sensitive" style={{ fontSize: "0.85rem" }}>{formatEUR(groupTotal)}</span>
                          {groupInvested > 0 && (
                            <span className={`inv-pnl-badge ${groupPnl >= 0 ? "positive" : "negative"}`}>
                              {groupPnl >= 0 ? "+" : ""}{((groupPnl / groupInvested) * 100).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                      <ul className="list">
                        {group.map((item) => {
                          const itemPnl = Number(item.valor_actual || 0) - Number(item.monto_invertido || 0);
                          const itemPnlPct = item.monto_invertido > 0 ? (itemPnl / item.monto_invertido) * 100 : null;
                          const barWidth = totalCurrent > 0 ? Math.min(100, (Number(item.valor_actual || 0) / totalCurrent) * 100) : 0;
                          const holdingLabel = (() => {
                            if (!item.fecha_inicio) return null;
                            const start = new Date(item.fecha_inicio);
                            const now = new Date();
                            const diffMs = now.getTime() - start.getTime();
                            if (diffMs <= 0) return null;
                            const totalMonths = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44));
                            const years = Math.floor(totalMonths / 12);
                            const months = totalMonths % 12;
                            if (years === 0) return `${months}m`;
                            if (months === 0) return `${years}a`;
                            return `${years}a ${months}m`;
                          })();
                          return (
                            <li key={item.id} className="inv-item">
                              <div className="inv-item__main">
                                <div className="inv-item__info">
                                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                    <span className="inv-item__name">{item.nombre}</span>
                                    {holdingLabel && (
                                      <span className="muted" style={{ fontSize: "0.72rem", background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: "0.25rem", padding: "0.1rem 0.35rem" }} title={`Desde ${item.fecha_inicio?.slice(0, 10)}`}>
                                        {holdingLabel}
                                      </span>
                                    )}
                                  </div>
                                  <div className="inv-item__bar-wrap">
                                    <div className="inv-item__bar" style={{ width: `${barWidth}%` }} />
                                  </div>
                                </div>
                                <div className="inv-item__nums">
                                  <strong className="sensitive">{formatEUR(item.valor_actual)}</strong>
                                  {item.monto_invertido > 0 && (
                                    <span className={`inv-item__pnl ${itemPnl >= 0 ? "positive" : "negative"}`}>
                                      {itemPnl >= 0 ? "+" : ""}{formatEUR(itemPnl)}
                                      {itemPnlPct !== null && ` (${itemPnlPct >= 0 ? "+" : ""}${itemPnlPct.toFixed(1)}%)`}
                                    </span>
                                  )}
                                </div>
                                <button type="button" className="button-secondary" style={{ flexShrink: 0, padding: "0.25rem 0.5rem" }}
                                  onClick={() => setEditInvestmentModal(item)}>✎</button>
                                <button type="button" className="danger" style={{ flexShrink: 0 }}
                                  aria-label={`Eliminar inversión ${item.nombre}`} title="Eliminar"
                                  onClick={() => deleteWithUndo("Inversión", () => api.deleteInvestment(item.id).then(() => loadAll()))}>🗑</button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </article>
            );
          })
        )}

        {(() => {
          const cryptoInvestments = investments.filter((inv) => inv.tipo === "crypto");
          const hasKraken = krakenBalances.length > 0;
          const cryptoTotal = hasKraken
            ? krakenBalances.reduce((acc, b) => acc + (b.eur_value ?? 0), 0)
            : cryptoInvestments.reduce((s, i) => s + Number(i.valor_actual || 0), 0);
          const cryptoInvested = cryptoInvestments.reduce((s, i) => s + Number(i.monto_invertido || 0), 0);
          const cryptoPnl = cryptoTotal - (hasKraken ? 0 : cryptoInvested);
          const hasCrypto = hasKraken || cryptoInvestments.length > 0;
          if (!hasCrypto) return null;
          return (
            <article className="card">
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", gap: "1rem" }}
                onClick={() => setCryptoExpanded(p => !p)}
              >
                <h2 style={{ margin: 0, flexShrink: 0 }}>
                  <span style={{ opacity: 0.5, marginRight: "0.4rem" }}>{cryptoExpanded ? "▼" : "▶"}</span>
                  Criptomonedas
                </h2>
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {!hasKraken && cryptoInvested > 0 && (
                    <span className="muted sensitive" style={{ fontSize: "0.8rem" }}>inv: {formatEUR(cryptoInvested)}</span>
                  )}
                  <strong className="sensitive" style={{ fontSize: "0.85rem" }}>{formatEUR(cryptoTotal)}</strong>
                  {!hasKraken && cryptoInvested > 0 && (
                    <span className={`inv-pnl-badge ${cryptoPnl >= 0 ? "positive" : "negative"}`}>
                      {cryptoPnl >= 0 ? "+" : ""}{formatEUR(cryptoPnl)}
                    </span>
                  )}
                </div>
              </div>
              {cryptoExpanded && (
                <div style={{ marginTop: "1rem" }}>
                  {hasKraken && krakenBalances.length > 0 && (
                    <>
                      <h3 style={{ fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.55, marginBottom: "0.5rem" }}>Saldos Kraken en tiempo real</h3>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr><th>Activo</th><th>Tipo</th><th>Cantidad</th><th>Precio EUR</th><th>Valor EUR</th><th>%</th></tr>
                          </thead>
                          <tbody>
                            {krakenBalances.map((b) => (
                              <tr key={b.asset}>
                                <td><strong>{b.asset}</strong></td>
                                <td><span className="muted" style={{ fontSize: "0.8rem" }}>{b.type === "fiat" ? "fiat" : "crypto"}</span></td>
                                <td style={{ fontVariantNumeric: "tabular-nums" }}>{b.amount}</td>
                                <td>{b.eur_price != null ? formatEUR(b.eur_price) : b.type === "fiat" ? "—" : <span className="muted">sin precio</span>}</td>
                                <td className={b.eur_value != null ? "sensitive" : "muted"}>{b.eur_value != null ? formatEUR(b.eur_value) : "—"}</td>
                                <td className="muted" style={{ fontSize: "0.85rem" }}>
                                  {cryptoTotal > 0 && b.eur_value != null ? `${((b.eur_value / cryptoTotal) * 100).toFixed(1)}%` : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  {hasKraken && cryptoInvestments.some(inv => !inv.nombre.startsWith("Kraken ")) && (
                    <div style={{ padding: "0.5rem 0.75rem", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "0.4rem", fontSize: "0.82rem", margin: "0.75rem 0" }}>
                      ⚠ Hay posiciones manuales de tipo "crypto" y saldo Kraken activo — verifica que no estés contabilizando los mismos activos dos veces.
                    </div>
                  )}
                  {cryptoInvestments.length > 0 && (
                    <>
                      <h3 style={{ fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.55, margin: "0.75rem 0 0.5rem" }}>Posiciones registradas</h3>
                      <ul className="list">
                        {cryptoInvestments.map((inv) => {
                          const pl = Number(inv.valor_actual || 0) - Number(inv.monto_invertido || 0);
                          const plPct = inv.monto_invertido > 0 ? (pl / inv.monto_invertido) * 100 : null;
                          return (
                            <li key={inv.id}>
                              <span>{inv.nombre.replace("Kraken ", "")}</span>
                              <div className="inline-actions" style={{ fontSize: "0.83rem" }}>
                                {inv.monto_invertido > 0 && (
                                  <span className="muted sensitive" style={{ fontSize: "0.78rem" }}>{formatEUR(inv.monto_invertido)}</span>
                                )}
                                <strong className="sensitive">{formatEUR(inv.valor_actual)}</strong>
                                {inv.monto_invertido > 0 && (
                                  <span className={`inv-pnl-badge ${pl >= 0 ? "positive" : "negative"}`}>
                                    {pl >= 0 ? "+" : ""}{formatEUR(pl)}{plPct !== null && ` (${plPct >= 0 ? "+" : ""}${plPct.toFixed(1)}%)`}
                                  </span>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                  {!hasKraken && (
                    <p className="muted" style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
                      Sin datos de Kraken — los saldos se cargan automáticamente si las credenciales API están configuradas en Ajustes.
                    </p>
                  )}
                </div>
              )}
            </article>
          );
        })()}
        {(() => {
          const cashAccounts = accounts.filter(a => a.tipo === "inversiones");
          if (cashAccounts.length === 0) return null;
          const cashTotal = cashAccounts.reduce((s, a) => s + Number(a.balance_actual || 0), 0);
          return (
            <article className="card">
              <div className="inv-cartera-head" style={{ marginBottom: "0.75rem" }}>
                <h2 style={{ margin: 0 }}>Efectivo en carteras</h2>
                <strong className="sensitive">{formatEUR(cashTotal)}</strong>
              </div>
              <ul className="list">
                {cashAccounts.map(a => (
                  <li key={a.id}>
                    <div>
                      <span>{a.alias_real}</span>
                      {a.banco && <small className="muted" style={{ marginLeft: "0.5rem" }}>· {a.banco}</small>}
                    </div>
                    <strong className="sensitive">{formatEUR(a.balance_actual)}</strong>
                  </li>
                ))}
              </ul>
            </article>
          );
        })()}
      </section>

      {editInvestmentModal && (
        <InvestmentModal
          item={editInvestmentModal}
          knownCarteras={[...new Set(investments.map(i => (i.cartera || "").trim()).filter(Boolean))]}
          onClose={() => setEditInvestmentModal(null)}
          onSaved={loadAll}
        />
      )}

      <GlassModal isOpen={showInvestmentForm} onClose={() => setShowInvestmentForm(false)} title="Nueva inversión">
        <ModalFormError error={createSubmit.error} />
        <form onSubmit={(e) => {
          e.preventDefault();
          void createSubmit.run(async () => {
            await api.createInvestment({ ...investmentForm, fecha_inicio: investmentForm.fecha_inicio ? `${investmentForm.fecha_inicio}T00:00:00` : undefined });
            setInvestmentForm({ nombre: "", monto_invertido: 0, valor_actual: 0, tipo: "Inv", cartera: "", fecha_inicio: "" });
            setShowInvestmentForm(false);
            addToast("Inversión creada.", "success");
            await loadAll({ silent: true });
          });
        }}>
          <label>Nombre<input value={investmentForm.nombre} onChange={e => setInvestmentForm(p => ({ ...p, nombre: e.target.value }))} required autoFocus /></label>
          <div className="grid two-col" style={{ gap: "0.75rem", marginTop: "0.75rem" }}>
            <label>Tipo<select value={investmentForm.tipo} onChange={e => setInvestmentForm(p => ({ ...p, tipo: e.target.value }))}>
              <option value="fondo">Fondo indexado</option><option value="ETF">ETF</option><option value="accion">Acciones</option>
              <option value="crypto">Cripto</option><option value="pension">Pensión / Seguro</option><option value="deuda">Renta fija</option><option value="Inv">General</option>
            </select></label>
            <label>Cartera
              <input list="cartera-list-modal" value={investmentForm.cartera} placeholder="ej. MyInvestor…" onChange={e => setInvestmentForm(p => ({ ...p, cartera: e.target.value }))} />
              <datalist id="cartera-list-modal">{[...new Set(investments.map(i => (i.cartera || "").trim()).filter(Boolean))].map(c => <option key={c} value={c} />)}</datalist>
            </label>
            <label>Monto invertido<input type="number" step="0.01" value={investmentForm.monto_invertido || ""} onChange={e => setInvestmentForm(p => ({ ...p, monto_invertido: parseNum(e.target.value) }))} /></label>
            <label>Valor actual<input type="number" step="0.01" value={investmentForm.valor_actual || ""} onChange={e => setInvestmentForm(p => ({ ...p, valor_actual: parseNum(e.target.value) }))} /></label>
            <label>Fecha inicio<input type="date" value={investmentForm.fecha_inicio} onChange={e => setInvestmentForm(p => ({ ...p, fecha_inicio: e.target.value }))} /></label>
          </div>
          <div className="modal-actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="button-secondary" onClick={() => setShowInvestmentForm(false)}>Cancelar</button>
            <button type="submit" disabled={createSubmit.saving}>{createSubmit.saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      </GlassModal>

      </>
    );
}
