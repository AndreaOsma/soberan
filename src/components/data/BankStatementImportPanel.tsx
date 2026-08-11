import { useState } from "react";
import { api } from "../../services/api";
import { useNotify } from "../../hooks/useNotify";
import type { Account } from "../../types";
import { buildRevolutImportPreview, type BankImportRow } from "../../utils/bankStatementImport";

type Props = {
  accounts: Account[];
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
};

export function BankStatementImportPanel({ accounts, formatEUR, addToast, loadAll }: Props) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<BankImportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { busy, notifyAfter } = useNotify({ addToast, loadAll });

  return (
    <article className="card">
      <button
        type="button"
        className="collapsible-card-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <h2 style={{ margin: 0, fontSize: "1rem" }}>Importar extracto bancario</h2>
        <span className="muted" style={{ fontSize: "0.8rem" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ marginTop: "0.75rem" }}>
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
            Revolut (CSV consolidado) · ING (PDF mensual)
          </p>
          <label>
            Archivo CSV o PDF
            <input
              type="file"
              accept=".csv,.pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setError(null);
                setPreview(null);
                if (file.name.toLowerCase().endsWith(".pdf")) {
                  void notifyAfter(async () => {
                    const result = await api.importIngPdf(file);
                    if (!result.accounts.length) throw new Error("No se encontraron saldos en el PDF");
                    const rows: BankImportRow[] = result.accounts.map((a) => {
                      const existing = accounts.find((acc) => acc.alias_anonimo === a.alias_anonimo);
                      return {
                        accountId: existing?.id ?? null,
                        alias: existing?.alias_real ?? a.alias_real,
                        oldBalance: existing?.balance_actual ?? 0,
                        newBalance: a.balance,
                        source: `ING ${a.alias_real.includes("Naranja") ? "NARANJA" : "NÓMINA"} · PDF`,
                        isNew: !existing,
                      };
                    });
                    setPreview(rows);
                  }, `${file.name} analizado.`, "No se pudo procesar el PDF de ING.");
                } else {
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const text = ev.target?.result as string;
                    const { preview: rows, error: err } = buildRevolutImportPreview(text, accounts);
                    if (err) setError(err);
                    else setPreview(rows);
                  };
                  reader.readAsText(file, "utf-8");
                }
              }}
            />
          </label>
          {error && <p className="negative" style={{ fontSize: "0.85rem" }}>{error}</p>}
          {preview && preview.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Cuenta</th><th>Saldo actual</th><th>Saldo nuevo</th><th>Diferencia</th></tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => {
                      const diff = row.newBalance - row.oldBalance;
                      return (
                        <tr key={i}>
                          <td>{row.isNew ? <span className="badge" style={{ marginRight: "0.35rem" }}>NUEVO</span> : null}{row.alias}</td>
                          <td className="sensitive">{formatEUR(row.oldBalance)}</td>
                          <td className="sensitive"><strong>{formatEUR(row.newBalance)}</strong></td>
                          <td className={diff === 0 ? "muted" : diff > 0 ? "positive" : "negative"}>
                            {diff > 0 ? "+" : ""}{formatEUR(diff)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                style={{ marginTop: "0.75rem" }}
                disabled={busy}
                onClick={() => void notifyAfter(async () => {
                  for (const row of preview) {
                    if (row.isNew && row.toCreate) {
                      await api.createAccount({ ...row.toCreate, balance_actual: row.newBalance });
                    } else if (row.accountId !== null) {
                      const acc = accounts.find((a) => a.id === row.accountId);
                      if (acc) await api.updateAccount(row.accountId, { ...acc, balance_actual: row.newBalance });
                    }
                  }
                  await loadAll();
                  setPreview(null);
                }, "Saldos actualizados.", "Error al aplicar importación.")}
              >
                Aplicar cambios
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
