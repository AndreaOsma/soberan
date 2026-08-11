import { useState } from "react";
import { api } from "../../services/api";
import { parseJsonValue } from "../../utils/format";
import { useNotify } from "../../hooks/useNotify";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, isLegacyCategory, normalizeCategory } from "../../utils/expenseCategories";
import type { Transaction } from "../../types";

type Props = {
  settings: Record<string, string>;
  transactions: Transaction[];
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
};

function isWeakCategory(cat: string): boolean {
  const normalized = normalizeCategory(cat);
  if (!normalized) return true;
  return isLegacyCategory(cat) && !EXPENSE_CATEGORIES.includes(normalized as never)
    && !INCOME_CATEGORIES.includes(normalized as never);
}

export function TransactionHygienePanel({ settings, transactions, addToast, loadAll }: Props) {
  const [open, setOpen] = useState(false);
  const [newRulePattern, setNewRulePattern] = useState("");
  const [newRuleCategory, setNewRuleCategory] = useState("");
  const [newNamePattern, setNewNamePattern] = useState("");
  const [newNameLabel, setNewNameLabel] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const { busy, notifyAfter } = useNotify({ addToast, loadAll });
  const anyBusy = busy || cleaning;

  const getRules = () => parseJsonValue<Record<string, string>>(settings.category_rules ?? null, {});
  const getMerchantNames = () => parseJsonValue<Record<string, string>>(settings.merchant_names ?? null, {});
  const rules = getRules();
  const merchantNames = getMerchantNames();
  const weakCount = transactions.filter((tx) => isWeakCategory(tx.category_anon)).length;
  const dupCount = transactions.filter((tx, idx, arr) => {
    const key = `${tx.description_raw.trim().toLowerCase()}|${Number(tx.amount).toFixed(2)}|${tx.date.slice(0, 10)}`;
    return arr.findIndex((c) => `${c.description_raw.trim().toLowerCase()}|${Number(c.amount).toFixed(2)}|${c.date.slice(0, 10)}` === key) !== idx;
  }).length;
  const noDesc = transactions.filter((tx) => tx.description_raw.trim().length === 0).length;
  const taxonomy = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
  const now = new Date();

  return (
    <article className="card">
      <button
        type="button"
        className="collapsible-card-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <h2 style={{ margin: 0, fontSize: "1rem" }}>Higiene y reglas de categoría</h2>
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          {weakCount > 0 ? `${weakCount} sin categoría` : "OK"} {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div style={{ marginTop: "0.75rem" }}>
          <ul className="list" style={{ marginBottom: "0.75rem" }}>
            <li><span>Posibles duplicados</span><strong>{dupCount}</strong></li>
            <li><span>Sin categoría válida</span><strong className={weakCount > 0 ? "negative" : ""}>{weakCount}</strong></li>
            <li><span>Sin descripción</span><strong>{noDesc}</strong></li>
          </ul>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.75rem" }}>
            «Limpiar gastos» solo afecta gastos sin categoría o con nombre bancario; los ingresos no se tocan.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
            <button
              type="button"
              className="button-secondary"
              style={{ fontSize: "0.875rem" }}
              disabled={anyBusy || weakCount === 0 || Object.keys(rules).length === 0}
              onClick={() => void notifyAfter(async () => {
                const uncategorized = transactions.filter((tx) => isWeakCategory(tx.category_anon));
                let applied = 0;
                for (const tx of uncategorized) {
                  const desc = tx.description_raw.toLowerCase();
                  const match = Object.entries(rules).find(([pattern]) => desc.includes(pattern.toLowerCase()));
                  if (match) {
                    await api.patchTransactionCategory(tx, normalizeCategory(match[1]) || match[1]);
                    applied++;
                  }
                }
                if (applied === 0) throw new Error("Ninguna regla coincidió.");
              }, "Auto-categorización completada.", "No se pudo auto-categorizar.")}
            >
              Auto-categorizar sin categoría
            </button>
            <button
              type="button"
              className="button-secondary"
              style={{ fontSize: "0.875rem" }}
              disabled={anyBusy}
              onClick={() => {
                void (async () => {
                  setCleaning(true);
                  try {
                    const result = await api.smartCleanExpenses(now.getMonth() + 1, now.getFullYear());
                    await loadAll({ silent: true });
                    if (result.categorized === 0 && result.renamed === 0) {
                      addToast("Nada que limpiar este mes.", "info");
                    } else {
                      addToast(
                        `${result.categorized} categorizados, ${result.renamed} renombrados.`,
                        "success",
                      );
                    }
                  } catch (err) {
                    addToast(err instanceof Error ? err.message : "No se pudo limpiar gastos.", "error");
                  } finally {
                    setCleaning(false);
                  }
                })();
              }}
            >
              Limpiar gastos del mes
            </button>
          </div>
          <div className="grid two-col" style={{ gap: "0.75rem" }}>
            <label>
              Texto en descripción
              <input value={newRulePattern} onChange={(e) => setNewRulePattern(e.target.value)} placeholder="mercadona" />
            </label>
            <label>
              Categoría
              <select value={newRuleCategory} onChange={(e) => setNewRuleCategory(e.target.value)}>
                <option value="">— elegir —</option>
                {taxonomy.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <button
            type="button"
            style={{ marginTop: "0.5rem" }}
            disabled={anyBusy}
            onClick={() => void notifyAfter(async () => {
              if (!newRulePattern.trim() || !newRuleCategory.trim()) throw new Error("Completa texto y categoría.");
              await api.learnCategoryRule(newRulePattern.trim().toLowerCase(), newRuleCategory.trim());
              setNewRulePattern("");
              setNewRuleCategory("");
            }, "Regla guardada.", "No se pudo guardar regla.")}
          >
            Añadir regla
          </button>
          {Object.keys(rules).length > 0 && (
            <ul className="list" style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
              {Object.entries(rules).map(([pattern, category]) => (
                <li key={pattern}>
                  <span><code>{pattern}</code> → {category}</span>
                </li>
              ))}
            </ul>
          )}

          <h3 style={{ margin: "1.25rem 0 0.5rem", fontSize: "0.95rem" }}>Nombres de comercio</h3>
          <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            Token del banco → nombre corto. También se aprende al renombrar un gasto a mano.
          </p>
          <div className="grid two-col" style={{ gap: "0.75rem" }}>
            <label>
              Texto en descripción
              <input value={newNamePattern} onChange={(e) => setNewNamePattern(e.target.value)} placeholder="mercadona" />
            </label>
            <label>
              Nombre visible
              <input value={newNameLabel} onChange={(e) => setNewNameLabel(e.target.value)} placeholder="Mercadona" />
            </label>
          </div>
          <button
            type="button"
            style={{ marginTop: "0.5rem" }}
            disabled={anyBusy}
            onClick={() => void notifyAfter(async () => {
              if (!newNamePattern.trim() || !newNameLabel.trim()) throw new Error("Completa texto y nombre.");
              await api.learnMerchantName(newNamePattern.trim().toLowerCase(), newNameLabel.trim());
              setNewNamePattern("");
              setNewNameLabel("");
            }, "Nombre guardado.", "No se pudo guardar el nombre.")}
          >
            Añadir nombre
          </button>
          {Object.keys(merchantNames).length > 0 && (
            <ul className="list" style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
              {Object.entries(merchantNames).map(([pattern, name]) => (
                <li key={pattern}>
                  <span><code>{pattern}</code> → {name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
