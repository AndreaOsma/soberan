import { useMemo, useRef, useState } from "react";
import { api } from "../../services/api";
import { BankConnectPanel } from "./BankConnectPanel";
import {
  formatBankLastSync,
  formatBankSyncMessage,
  isBankLinked,
  isBankSyncStale,
} from "../../utils/bankSync";
import type { Account, Investment } from "../../types";

type KrakenBalance = {
  asset: string;
  amount: number;
  eur_value: number | null;
};

type Props = {
  accounts: Account[];
  investments: Investment[];
  settings: Record<string, string>;
  krakenBalances: KrakenBalance[];
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
};

function isMyInvestorAccount(account: Account): boolean {
  const hay = `${account.banco || ""} ${account.alias_real || ""}`.toLowerCase();
  return hay.includes("myinvestor");
}

export function InvestmentsConnectPanel({
  accounts,
  investments,
  settings,
  krakenBalances,
  formatEUR,
  addToast,
  loadAll,
}: Props) {
  const [bankOpen, setBankOpen] = useState(false);
  const [syncingKraken, setSyncingKraken] = useState(false);
  const [syncingMyInvestor, setSyncingMyInvestor] = useState(false);
  const [importingPdf, setImportingPdf] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const krakenConfigured = Boolean((settings.kraken_api_key || "").trim() && (settings.kraken_api_secret || "").trim());
  const krakenLive = krakenBalances.length > 0;
  const krakenTotal = krakenBalances.reduce((sum, row) => sum + (row.eur_value ?? 0), 0);

  const myInvestorAccounts = useMemo(
    () => accounts.filter((account) => isBankLinked(account) && isMyInvestorAccount(account)),
    [accounts],
  );
  const myInvestorPositions = useMemo(
    () => investments.filter((inv) => (inv.cartera || "").toLowerCase().includes("myinvestor")),
    [investments],
  );
  const myInvestorStale = myInvestorAccounts.some((account) => isBankSyncStale(account.last_sync_at));
  const lastPdfImport = settings.myinvestor_last_import_at;

  async function syncKrakenNow() {
    setSyncingKraken(true);
    try {
      await api.syncKraken();
      await loadAll({ silent: true });
      addToast("Kraken sincronizado.", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "No se pudo sincronizar Kraken.", "error");
    } finally {
      setSyncingKraken(false);
    }
  }

  async function syncMyInvestorBanks() {
    setSyncingMyInvestor(true);
    try {
      const result = await api.syncBankAccounts({});
      await loadAll({ silent: true });
      addToast(formatBankSyncMessage(result.created, result.updated), "success");
    } catch {
      addToast("No se pudo sincronizar MyInvestor.", "error");
    } finally {
      setSyncingMyInvestor(false);
    }
  }

  async function importMyInvestorPdf(file: File) {
    setImportingPdf(true);
    try {
      const result = await api.applyMyInvestorPdf(file, "MyInvestor");
      await loadAll({ silent: true });
      addToast(
        `Cartera MyInvestor actualizada: ${result.positions_total} posición${result.positions_total === 1 ? "" : "es"} (${result.created} nuevas, ${result.updated} actualizadas).`,
        "success",
      );
    } catch (err) {
      addToast(err instanceof Error ? err.message : "No se pudo importar el PDF.", "error");
    } finally {
      setImportingPdf(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  }

  return (
    <>
      <article className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ margin: "0 0 0.75rem" }}>Conexiones</h2>
        <p className="muted" style={{ fontSize: "0.85rem", margin: "0 0 1rem" }}>
          Conecta Kraken y MyInvestor como las cuentas bancarias: saldos y movimientos automáticos donde la API lo permite.
        </p>

        <div className="grid two-col" style={{ gap: "1rem" }}>
          <section
            style={{
              padding: "1rem",
              borderRadius: "0.75rem",
              border: "1px solid var(--border-soft)",
              background: "var(--surface-soft)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
              <div>
                <div style={{ fontWeight: 600 }}>Kraken</div>
                <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.8rem" }}>
                  Cripto · saldos, posiciones y movimientos en tiempo real.
                </p>
              </div>
              {krakenLive && (
                <span className="badge positive" style={{ alignSelf: "flex-start" }}>
                  Conectado · {formatEUR(krakenTotal)}
                </span>
              )}
            </div>

            {krakenConfigured ? (
              <div className="inline-actions" style={{ flexWrap: "wrap" }}>
                <button type="button" className="button-secondary" disabled={syncingKraken} onClick={() => void syncKrakenNow()}>
                  {syncingKraken ? "Sincronizando…" : "Sync ahora"}
                </button>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
                Configura tu API Key/Secret de Kraken en Configuración → Integraciones.
              </p>
            )}
          </section>

          <section
            style={{
              padding: "1rem",
              borderRadius: "0.75rem",
              border: "1px solid var(--border-soft)",
              background: "var(--surface-soft)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
              <div>
                <div style={{ fontWeight: 600 }}>MyInvestor</div>
                <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.8rem" }}>
                  Cuenta y movimientos vía open banking · cartera de fondos vía PDF.
                </p>
              </div>
              {myInvestorAccounts.length > 0 && (
                <span className="badge positive" style={{ alignSelf: "flex-start" }}>
                  {myInvestorAccounts.length} cuenta{myInvestorAccounts.length === 1 ? "" : "s"}
                </span>
              )}
            </div>

            <div className="inline-actions" style={{ flexWrap: "wrap", marginBottom: "0.75rem" }}>
              <button type="button" onClick={() => setBankOpen(true)}>
                {myInvestorAccounts.length > 0 ? "Gestionar conexión" : "Conectar MyInvestor"}
              </button>
              {myInvestorAccounts.length > 0 && (
                <button type="button" className="button-secondary" disabled={syncingMyInvestor} onClick={() => void syncMyInvestorBanks()}>
                  {syncingMyInvestor ? "Sincronizando…" : "Sync banco"}
                </button>
              )}
            </div>

            {myInvestorAccounts.length > 0 && (
              <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 0.75rem" }}>
                {myInvestorStale ? "Sync bancaria pendiente." : "Cuenta bancaria al día."}
                {myInvestorAccounts[0]?.last_sync_at ? ` · ${formatBankLastSync(myInvestorAccounts[0].last_sync_at)}` : ""}
              </p>
            )}

            <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: "0.75rem" }}>
              <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: "0.35rem" }}>Cartera de fondos</div>
              <p className="muted" style={{ fontSize: "0.78rem", margin: "0 0 0.5rem" }}>
                Exporta en la app: Mi posición → Exportar PDF. Se actualizan posiciones al instante.
                {myInvestorPositions.length > 0 ? ` · ${myInvestorPositions.length} posiciones registradas` : ""}
                {lastPdfImport ? ` · PDF: ${formatBankLastSync(lastPdfImport)}` : ""}
              </p>
              <input
                ref={pdfInputRef}
                type="file"
                accept=".pdf"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importMyInvestorPdf(file);
                }}
              />
              <button
                type="button"
                className="button-secondary"
                disabled={importingPdf}
                onClick={() => pdfInputRef.current?.click()}
              >
                {importingPdf ? "Importando…" : "Actualizar cartera (PDF)"}
              </button>
            </div>
          </section>
        </div>
      </article>

      <BankConnectPanel
        accounts={accounts}
        addToast={addToast}
        loadAll={loadAll}
        open={bankOpen}
        onOpenChange={setBankOpen}
        initialSearch="MyInvestor"
      />
    </>
  );
}
