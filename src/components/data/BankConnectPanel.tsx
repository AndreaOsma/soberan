import { useEffect, useMemo, useState } from "react";
import { api } from "../../services/api";
import type { Account } from "../../types";
import { useNotify } from "../../hooks/useNotify";
import { bankAccountDisplayName, formatBankImportMessage } from "../../utils/bankSync";

type RemoteBank = {
  id: string;
  name: string;
  bic?: string;
  logo?: string;
  countries?: string[];
};

type RequisitionRow = {
  id: number;
  requisition_id: string;
  institution_id: string;
  institution_name?: string | null;
  status: string;
  link?: string | null;
  reference?: string | null;
  created_at?: string | null;
};

type RequisitionDetail = {
  id: number;
  requisition_id: string;
  institution_id: string;
  status: string;
  link?: string | null;
  accounts: Array<{
    gocardless_account_id: string;
    iban?: string | null;
    name?: string | null;
    currency?: string | null;
  }>;
};

type Props = {
  accounts: Account[];
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialSearch?: string;
};

const PENDING_REQ_LS = "soberan_pending_bank_requisition";

function statusLabel(status: string) {
  const value = (status || "").toUpperCase();
  if (value === "LN" || value === "LINKED") return "Vinculada";
  if (value === "SU") return "Aceptada";
  if (value === "EX") return "Expirada";
  if (value === "RJ") return "Rechazada";
  if (value === "GC") return "GoCardless";
  return value || "Pendiente";
}

function isFinalStatus(status: string) {
  const value = (status || "").toUpperCase();
  // GoCardless: LN=linked, SU=successful/accepted, EX=expired, RJ=rejected.
  return value === "LN" || value === "SU" || value === "EX" || value === "RJ";
}

function smartAccountName(
  remote: RequisitionDetail["accounts"][number],
  institutionName?: string,
) {
  return bankAccountDisplayName(remote, institutionName);
}

function resolveInstitutionName(
  detail: RequisitionDetail | null,
  requisitions: RequisitionRow[],
  selectedReq: string | null,
  banks: RemoteBank[],
): string | undefined {
  if (!detail) return undefined;
  const fromReq = requisitions.find((row) => row.requisition_id === selectedReq)?.institution_name;
  if (fromReq?.trim()) return fromReq.trim();
  const fromBank = banks.find((bank) => bank.id === detail.institution_id)?.name;
  if (fromBank?.trim()) return fromBank.trim();
  return detail.institution_id || undefined;
}

export function BankConnectPanel({
  accounts, addToast, loadAll, open: openProp, onOpenChange, initialSearch,
}: Props) {
  const BANKS_PAGE_SIZE = 60;
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp ?? openInternal;
  const setOpen = (value: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof value === "function" ? value(open) : value;
    if (openProp === undefined) setOpenInternal(next);
    onOpenChange?.(next);
  };
  const [country, setCountry] = useState("ES");
  const [search, setSearch] = useState("");
  const [banks, setBanks] = useState<RemoteBank[]>([]);
  const [banksPage, setBanksPage] = useState(1);
  const [requisitions, setRequisitions] = useState<RequisitionRow[]>([]);
  const [selectedReq, setSelectedReq] = useState<string | null>(null);
  const [detail, setDetail] = useState<RequisitionDetail | null>(null);
  const [draftLinks, setDraftLinks] = useState<Record<string, string>>({});
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [loadingReqs, setLoadingReqs] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const { busy, notifyAfter } = useNotify({ addToast, loadAll });

  const filteredBanks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? banks.filter((b) => {
      const hay = `${b.name} ${b.id} ${b.bic || ""}`.toLowerCase();
      return hay.includes(q);
        })
      : banks;

    return [...base].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  }, [banks, search]);

  const totalBankPages = Math.max(1, Math.ceil(filteredBanks.length / BANKS_PAGE_SIZE));
  const visibleBanks = useMemo(() => {
    const page = Math.min(banksPage, totalBankPages);
    const start = (page - 1) * BANKS_PAGE_SIZE;
    return filteredBanks.slice(start, start + BANKS_PAGE_SIZE);
  }, [banksPage, filteredBanks, totalBankPages]);

  async function refreshBanks() {
    setLoadingBanks(true);
    try {
      const rows = await api.listBanks(country);
      setBanks(rows);
      setBanksPage(1);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "No se pudo cargar la lista de bancos.", "error");
    } finally {
      setLoadingBanks(false);
    }
  }

  useEffect(() => {
    setBanksPage(1);
  }, [country, search]);

  useEffect(() => {
    if (banksPage <= totalBankPages) return;
    setBanksPage(totalBankPages);
  }, [banksPage, totalBankPages]);

  async function refreshRequisitions(silent = false) {
    if (!silent) setLoadingReqs(true);
    try {
      const rows = await api.listBankRequisitions();
      setRequisitions(rows);
      const pending = localStorage.getItem(PENDING_REQ_LS);
      if (pending && rows.some((r) => r.requisition_id === pending)) {
        setSelectedReq(pending);
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : "No se pudieron cargar las conexiones bancarias.", "error");
    } finally {
      if (!silent) setLoadingReqs(false);
    }
  }

  async function refreshDetail(requisitionId: string) {
    setLoadingDetail(true);
    try {
      const row = await api.getBankRequisition(requisitionId);
      setDetail(row);
      setSelectedReq(requisitionId);
      if (row.status === "LN" || row.status === "SU" || row.accounts.length > 0) {
        const imported = await api.importBankAccounts();
        const msg = formatBankImportMessage(imported.imported, imported.transactions_created);
        if (msg) addToast(msg, "success");
        await loadAll({ silent: true });
        localStorage.removeItem(PENDING_REQ_LS);
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : "No se pudo refrescar el consentimiento bancario.", "error");
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void refreshBanks();
    void refreshRequisitions();
    if (initialSearch?.trim()) {
      setSearch(initialSearch.trim());
      setBanksPage(1);
    }
    // refreshBanks/refreshRequisitions are plain closures (not memoized); they'd
    // change identity every render and re-fire this effect in a loop if listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, country, initialSearch]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromBank = params.get("bank_return");
    const pending = localStorage.getItem(PENDING_REQ_LS);
    if (!fromBank && !pending) return;
    setOpen(true);
    if (pending) {
      void refreshRequisitions(true).then(() => void refreshDetail(pending));
    }
    if (fromBank) {
      params.delete("bank_return");
      const nextQs = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${nextQs ? `?${nextQs}` : ""}`);
    }
    // mount-only behavior
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh while consent is pending so the user doesn't need manual "Refrescar estado".
  useEffect(() => {
    if (!open) return;
    if (!detail?.requisition_id) return;
    if (isFinalStatus(detail.status)) return;

    const handle = window.setInterval(() => {
      // Only refresh the consent detail; keep it lightweight (no loadAll()).
      void refreshDetail(detail.requisition_id);
    }, 15_000);

    return () => window.clearInterval(handle);
    // Intentionally depends on detail.requisition_id/status so it stops when status turns final.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, detail?.requisition_id, detail?.status]);

  async function startBankConsent(bank: RemoteBank) {
    const redirect = `${window.location.origin}${window.location.pathname}?bank_return=1`;
    await notifyAfter(async () => {
      const res = await api.createBankRequisition({
        institution_id: bank.id,
        redirect_url: redirect,
        institution_name: bank.name,
      });
      if (!res.link) throw new Error("GoCardless no devolvió enlace de consentimiento.");
      localStorage.setItem(PENDING_REQ_LS, res.requisition_id);
      window.location.href = res.link;
    }, `Abriendo consentimiento para ${bank.name}.`, "No se pudo iniciar la conexión bancaria.");
  }

  async function applyLink(remoteId: string) {
    const selected = draftLinks[remoteId] || "";
    const remote = detail?.accounts.find((a) => a.gocardless_account_id === remoteId);
    if (!remote) return;

    const institutionName = resolveInstitutionName(detail, requisitions, selectedReq, banks);

    await notifyAfter(async () => {
      let soberanAccountId: number;
      if (selected.startsWith("existing:")) {
        soberanAccountId = Number(selected.slice("existing:".length));
      } else if (selected === "new") {
        const created = await api.createAccount({
          alias_real: smartAccountName(remote, institutionName),
          alias_anonimo: null,
          tipo: "gasto",
          balance_actual: 0,
          banco: institutionName || "Banco vinculado",
          iban: remote.iban || null,
        });
        soberanAccountId = created.id;
      } else {
        throw new Error("Selecciona una cuenta destino o crea una nueva.");
      }
      await api.linkBankAccount({
        soberan_account_id: soberanAccountId,
        gocardless_account_id: remoteId,
        institution_name: institutionName,
      });
      await loadAll({ silent: true });
      if (selectedReq) {
        await refreshDetail(selectedReq);
      }
    }, "Cuenta bancaria vinculada.", "No se pudo vincular la cuenta bancaria.");
  }

  return (
    <article className="card">
      <button
        type="button"
        className="collapsible-card-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <h2 style={{ margin: 0, fontSize: "1rem" }}>Conectar banco (Open Banking)</h2>
        <span className="muted" style={{ fontSize: "0.8rem" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ marginTop: "0.75rem" }}>
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
            El usuario autoriza su banco mediante GoCardless Bank Account Data. Luego podrás vincular las cuentas y sincronizar movimientos.
          </p>

          <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              País
              <select value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="ES">España</option>
                <option value="PT">Portugal</option>
                <option value="FR">Francia</option>
                <option value="DE">Alemania</option>
                <option value="IT">Italia</option>
                <option value="NL">Países Bajos</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              Buscar banco
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Santander, BBVA, ING…"
              />
            </label>
          </div>

          <div className="grid two-col" style={{ gap: "0.75rem" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <strong>Bancos compatibles</strong>
                <div className="inline-actions">
                  <span className="muted" style={{ fontSize: "0.78rem" }}>
                    {filteredBanks.length} banco{filteredBanks.length === 1 ? "" : "s"}
                  </span>
                  <button type="button" className="button-secondary" onClick={() => void refreshBanks()} disabled={loadingBanks}>
                    {loadingBanks ? "Cargando…" : "Recargar"}
                  </button>
                </div>
              </div>
              <div className="list" style={{ maxHeight: "18rem", overflow: "auto" }}>
                {visibleBanks.map((bank) => (
                  <div key={bank.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", padding: "0.75rem", border: "1px solid var(--border-soft)", borderRadius: "0.75rem" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{bank.name}</div>
                      <div className="muted" style={{ fontSize: "0.78rem" }}>{bank.id}{bank.bic ? ` · ${bank.bic}` : ""}</div>
                    </div>
                    <button type="button" onClick={() => void startBankConsent(bank)} disabled={busy}>
                      Conectar
                    </button>
                  </div>
                ))}
                {!loadingBanks && filteredBanks.length === 0 && (
                  <p className="muted" style={{ margin: 0 }}>Sin resultados para esa búsqueda.</p>
                )}
              </div>
              {filteredBanks.length > BANKS_PAGE_SIZE && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                  <span className="muted" style={{ fontSize: "0.78rem" }}>
                    Página {Math.min(banksPage, totalBankPages)} de {totalBankPages}
                  </span>
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setBanksPage((page) => Math.max(1, page - 1))}
                      disabled={banksPage <= 1}
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setBanksPage((page) => Math.min(totalBankPages, page + 1))}
                      disabled={banksPage >= totalBankPages}
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <strong>Consentimientos</strong>
                <button type="button" className="button-secondary" onClick={() => void refreshRequisitions()} disabled={loadingReqs}>
                  {loadingReqs ? "Cargando…" : "Recargar"}
                </button>
              </div>
              <div className="list" style={{ maxHeight: "18rem", overflow: "auto" }}>
                {requisitions.map((req) => (
                  <div key={req.requisition_id} style={{ padding: "0.75rem", border: "1px solid var(--border-soft)", borderRadius: "0.75rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "flex-start" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{req.institution_name || req.institution_id}</div>
                        <div className="muted" style={{ fontSize: "0.78rem" }}>
                          {statusLabel(req.status)}
                          {req.created_at ? ` · ${new Date(req.created_at).toLocaleString("es-ES")}` : ""}
                        </div>
                      </div>
                      <div className="inline-actions">
                        <button type="button" className="button-secondary" onClick={() => void refreshDetail(req.requisition_id)}>
                          Ver
                        </button>
                        <button type="button" className="danger" onClick={() => void notifyAfter(async () => {
                          await api.deleteBankRequisition(req.requisition_id);
                          if (selectedReq === req.requisition_id) setDetail(null);
                          await refreshRequisitions(true);
                        }, "Consentimiento eliminado.", "No se pudo eliminar el consentimiento.")}>
                          🗑
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {!loadingReqs && requisitions.length === 0 && (
                  <p className="muted" style={{ margin: 0 }}>Aún no hay consentimientos creados.</p>
                )}
              </div>
            </div>
          </div>

          {detail && (
            <div style={{ marginTop: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                <strong>Cuenta(s) devueltas por el banco</strong>
                <div className="inline-actions">
                  <button type="button" className="button-secondary" onClick={() => void refreshDetail(detail.requisition_id)} disabled={loadingDetail}>
                    {loadingDetail ? "Refrescando…" : "Refrescar estado"}
                  </button>
                  <button type="button" onClick={() => void notifyAfter(async () => {
                    await api.syncBankAccounts({});
                    await loadAll({ silent: true });
                  }, "Sincronización bancaria lanzada.", "No se pudo sincronizar el banco.")}>
                    Sync ahora
                  </button>
                </div>
              </div>
              <p className="muted" style={{ fontSize: "0.8rem", marginTop: 0 }}>
                Estado actual: <strong>{statusLabel(detail.status)}</strong>
                {(detail.status === "LN" || detail.status === "SU") && (
                  <> · Las cuentas aparecen automáticamente en <strong>Cuentas</strong>.</>
                )}
              </p>
              <div className="list">
                {detail.accounts.map((remote) => {
                  const institutionName = resolveInstitutionName(detail, requisitions, selectedReq, banks);
                  const linked = accounts.find((a) => a.gocardless_account_id === remote.gocardless_account_id);
                  return (
                    <div key={remote.gocardless_account_id} style={{ padding: "0.85rem", border: "1px solid var(--border-soft)", borderRadius: "0.75rem" }}>
                      <div style={{ marginBottom: "0.5rem" }}>
                        <div style={{ fontWeight: 600 }}>{smartAccountName(remote, institutionName)}</div>
                        <div className="muted" style={{ fontSize: "0.78rem" }}>
                          {remote.iban || remote.gocardless_account_id}
                          {remote.currency ? ` · ${remote.currency}` : ""}
                        </div>
                      </div>
                      {linked ? (
                        <div className="inline-actions">
                          <span className="badge positive">Vinculada a {linked.alias_real}</span>
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() => void notifyAfter(async () => {
                              await api.syncBankAccounts({ account_id: linked.id });
                              await loadAll({ silent: true });
                            }, `Cuenta ${linked.alias_real} sincronizada.`, "No se pudo sincronizar esta cuenta.")}
                          >
                            Sync
                          </button>
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() => void notifyAfter(async () => {
                              await api.unlinkBankAccount(linked.id);
                              await loadAll({ silent: true });
                              await refreshDetail(detail.requisition_id);
                            }, "Cuenta desvinculada.", "No se pudo desvincular la cuenta.")}
                          >
                            Desvincular
                          </button>
                        </div>
                      ) : (
                        <div className="grid two-col" style={{ gap: "0.75rem", alignItems: "end" }}>
                          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                            Vincular con
                            <select
                              value={draftLinks[remote.gocardless_account_id] || ""}
                              onChange={(e) => setDraftLinks((prev) => ({ ...prev, [remote.gocardless_account_id]: e.target.value }))}
                            >
                              <option value="">Selecciona cuenta…</option>
                              {accounts.map((a) => (
                                <option key={a.id} value={`existing:${a.id}`}>
                                  {a.alias_real} · {a.banco}
                                </option>
                              ))}
                              <option value="new">Crear cuenta nueva</option>
                            </select>
                          </label>
                          <button type="button" onClick={() => void applyLink(remote.gocardless_account_id)} disabled={busy}>
                            Vincular
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {detail.accounts.length === 0 && (
                  <p className="muted" style={{ margin: 0 }}>
                    Este consentimiento aún no devuelve cuentas. Refresca el estado tras completar la autorización en el banco.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
