import { useEffect, useState } from "react";
import { api } from "../../services/api";
import type { Transaction } from "../../types";

type Hint = {
  transaction_id: number;
  amount: number;
  description_raw?: string;
  empresa?: string;
  kind: string;
  categoria?: string;
  account_id?: number;
  date?: string;
};

type Props = {
  transactions: Transaction[];
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
};

export function PayrollHintsBanner({ transactions, formatEUR, addToast, loadAll }: Props) {
  const [hints, setHints] = useState<Hint[]>([]);

  useEffect(() => {
    void api.getBankPayrollHints().then((res) => setHints(res.hints as Hint[])).catch(() => {});
  }, [transactions.length]);

  if (hints.length === 0) return null;

  return (
    <article className="card" style={{ marginBottom: "1rem" }}>
      <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>Movimientos detectados</h3>
      <ul className="list" style={{ fontSize: "0.85rem" }}>
        {hints.slice(0, 5).map((hint) => (
          <li key={hint.transaction_id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
            <span>
              {hint.kind === "payroll" ? "¿Nómina" : "¿Ingreso"} {hint.empresa ? `· ${hint.empresa}` : ""}
              <small className="muted" style={{ marginLeft: "0.35rem" }}>{hint.description_raw || ""}</small>
            </span>
            <div className="inline-actions">
              <strong className="sensitive positive">{formatEUR(hint.amount)}</strong>
              <button
                type="button"
                className="button-secondary"
                style={{ fontSize: "0.78rem", padding: "0.2rem 0.45rem" }}
                onClick={() => void (async () => {
                  try {
                    const tx = transactions.find((t) => t.id === hint.transaction_id);
                    if (!tx) {
                      addToast("Movimiento no encontrado.", "error");
                      return;
                    }
                    const cat = hint.kind === "payroll" ? "Nómina" : (hint.categoria || "Otros ingresos");
                    await api.patchTransactionCategory(tx, cat);
                    const token = (tx.description_raw || "").trim().split(/\s+/)[0]?.toLowerCase();
                    if (token && token.length >= 4) {
                      try {
                        await api.learnCategoryRule(token, cat);
                      } catch {
                        // opcional
                      }
                    }
                    setHints((prev) => prev.filter((h) => h.transaction_id !== hint.transaction_id));
                    await loadAll({ silent: true });
                    addToast("Movimiento categorizado.", "success");
                  } catch {
                    addToast("No se pudo categorizar.", "error");
                  }
                })()}
              >
                Confirmar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}
