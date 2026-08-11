import { useMemo, useState } from "react";
import type { Transaction, Account, RecurringEntry, TransactionSplit } from "../../types";
import { api } from "../../services/api";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../ModalFormError";
import { EditModalShell } from "../EditModalShell";
import { categoryOptionsForAmount } from "../../utils/expenseCategories";
import { toDateOnly } from "../../utils/format";
import { maybeLearnMerchantName } from "../../utils/merchantNaming";
import { equalSplitDraft } from "../../utils/expenseSplits";

const lbl = { display: "flex", flexDirection: "column" as const, gap: "0.25rem" };

type SplitDraft = {
  person_name: string;
  amount: string;
  is_me: boolean;
  settled: boolean;
};

interface Props {
  item: Transaction;
  accounts: Account[];
  recurringEntries: RecurringEntry[];
  transactions?: Transaction[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  addToast?: (msg: string, type: "success" | "error" | "info") => void;
}

function draftsFromSplits(splits: TransactionSplit[] | undefined): SplitDraft[] {
  if (!splits?.length) return [];
  return splits.map((s) => ({
    person_name: s.person_name || (s.is_me ? "Yo" : ""),
    amount: String(s.amount),
    is_me: Boolean(s.is_me),
    settled: Boolean(s.settled),
  }));
}

export function TransactionModal({ item, accounts, onClose, onSaved, addToast }: Props) {
  const { saving, error, run } = useAsyncSubmit();
  const [form, setForm] = useState({
    account_id: item.account_id ?? (accounts[0]?.id ?? 0),
    amount: String(item.amount),
    category_anon: item.category_anon ?? "",
    description_raw: item.description_raw ?? "",
    tipo_meta: item.tipo_meta ?? "",
    date: toDateOnly(item.date),
  });
  const [splitsEnabled, setSplitsEnabled] = useState((item.splits?.length ?? 0) > 0);
  const [splitDrafts, setSplitDrafts] = useState<SplitDraft[]>(() => draftsFromSplits(item.splits));
  const [equalNames, setEqualNames] = useState("");

  const amountNum = parseFloat(String(form.amount).replace(",", "."));
  const isExpense = Number.isFinite(amountNum) ? amountNum < 0 : Number(item.amount) < 0;
  const totalAbs = Number.isFinite(amountNum) ? Math.abs(amountNum) : Math.abs(Number(item.amount));
  const splitSum = splitDrafts.reduce((s, row) => s + (parseFloat(row.amount.replace(",", ".")) || 0), 0);
  const splitDiff = Math.round((splitSum - totalAbs) * 100) / 100;

  const categoryOptions = useMemo(() => {
    return categoryOptionsForAmount(Number.isFinite(amountNum) ? amountNum : Number(item.amount), form.category_anon);
  }, [amountNum, form.category_anon, item.amount]);
  const set = (k: string, v: string | number) => setForm((p) => ({ ...p, [k]: v }));

  function enableSplits() {
    setSplitsEnabled(true);
    if (splitDrafts.length === 0) {
      const half = Math.round((totalAbs / 2) * 100) / 100;
      const rest = Math.round((totalAbs - half) * 100) / 100;
      setSplitDrafts([
        { person_name: "Yo", amount: String(half), is_me: true, settled: false },
        { person_name: "", amount: String(rest), is_me: false, settled: false },
      ]);
    }
  }

  function applyEqualSplit() {
    const names = equalNames.split(/[,;]/).map((n) => n.trim()).filter(Boolean);
    const draft = equalSplitDraft(totalAbs, names);
    if (draft.length < 2) {
      addToast?.("Indica al menos una persona (además de ti).", "error");
      return;
    }
    setSplitsEnabled(true);
    setSplitDrafts(draft.map((d) => ({
      person_name: d.person_name,
      amount: String(d.amount),
      is_me: d.is_me,
      settled: d.settled,
    })));
  }

  return (
    <EditModalShell title="Editar transacción" onClose={onClose}>
      <ModalFormError error={error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            if (!form.account_id) {
              throw new Error("Selecciona una cuenta para el movimiento.");
            }
            const amount = parseFloat(form.amount.replace(",", "."));
            if (!Number.isFinite(amount)) {
              throw new Error("Importe no válido.");
            }
            if (!form.date) {
              throw new Error("La fecha es obligatoria.");
            }
            await api.updateTransaction(item.id, {
              account_id: Number(form.account_id),
              amount,
              category_anon: form.category_anon.trim(),
              description_raw: form.description_raw.trim() || "—",
              tipo_meta: form.tipo_meta || undefined,
              date: `${form.date}T00:00:00`,
            });
            await maybeLearnMerchantName({
              amount,
              previousDescription: item.description_raw || "",
              newDescription: form.description_raw.trim() || "—",
              learn: api.learnMerchantName,
            });

            if (amount < 0 && splitsEnabled) {
              const payload = splitDrafts.map((row) => ({
                person_name: row.person_name.trim(),
                amount: parseFloat(row.amount.replace(",", ".")),
                is_me: row.is_me,
                settled: row.settled,
              }));
              if (payload.some((p) => !Number.isFinite(p.amount) || p.amount <= 0)) {
                throw new Error("Cada parte del split debe ser un importe positivo.");
              }
              await api.putTransactionSplits(item.id, payload);
            } else if ((item.splits?.length ?? 0) > 0 && (!splitsEnabled || amount >= 0)) {
              await api.putTransactionSplits(item.id, []);
            }

            addToast?.("Movimiento actualizado.", "success");
            await onSaved();
            onClose();
          });
        }}
      >
        <label style={{ ...lbl, marginBottom: "0.75rem" }}>
          Descripción
          <input
            value={form.description_raw}
            onChange={(e) => set("description_raw", e.target.value)}
            autoFocus
            required
          />
        </label>
        <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
          <label style={lbl}>
            Importe
            <input
              type="text"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              required
            />
            <span className="muted" style={{ fontSize: "0.75rem" }}>
              Negativo = gasto · positivo = ingreso
            </span>
          </label>
          <label style={lbl}>
            Fecha
            <input
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
              required
            />
          </label>
        </div>
        <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "1rem" }}>
          <label style={lbl}>
            Categoría
            <select value={form.category_anon} onChange={(e) => set("category_anon", e.target.value)}>
              <option value="">— sin categoría —</option>
              {form.category_anon && !categoryOptions.includes(form.category_anon) && (
                <option value={form.category_anon}>{form.category_anon} (legacy)</option>
              )}
              {categoryOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label style={lbl}>
            Cuenta
            <select
              value={form.account_id || ""}
              onChange={(e) => set("account_id", Number(e.target.value))}
              required
            >
              <option value="" disabled>
                Seleccionar cuenta…
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.alias_real}</option>
              ))}
            </select>
          </label>
        </div>

        {isExpense && (
          <fieldset style={{ border: "none", padding: 0, margin: "0 0 1rem" }}>
            <legend style={{ fontSize: "0.95rem", marginBottom: "0.35rem" }}>Dividir entre personas</legend>
            <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.5rem" }}>
              El banco sigue con el importe completo; el presupuesto solo cuenta tu parte.
            </p>
            {!splitsEnabled ? (
              <button type="button" className="button-secondary" onClick={enableSplits} disabled={saving}>
                Dividir gasto
              </button>
            ) : (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem", alignItems: "end" }}>
                  <label style={{ ...lbl, flex: "1 1 12rem" }}>
                    Partes iguales (nombres)
                    <input
                      value={equalNames}
                      onChange={(e) => setEqualNames(e.target.value)}
                      placeholder="María, Juan"
                    />
                  </label>
                  <button type="button" className="button-secondary" onClick={applyEqualSplit} disabled={saving}>
                    Repartir igual
                  </button>
                </div>
                <ul className="list" style={{ marginBottom: "0.5rem" }}>
                  {splitDrafts.map((row, idx) => (
                    <li key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 5.5rem auto auto", gap: "0.4rem", alignItems: "center" }}>
                      <input
                        aria-label={row.is_me ? "Tu parte" : "Nombre"}
                        value={row.person_name}
                        disabled={row.is_me}
                        placeholder={row.is_me ? "Yo" : "Persona"}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSplitDrafts((prev) => prev.map((r, i) => (i === idx ? { ...r, person_name: v } : r)));
                        }}
                      />
                      <input
                        aria-label="Importe de la parte"
                        inputMode="decimal"
                        value={row.amount}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSplitDrafts((prev) => prev.map((r, i) => (i === idx ? { ...r, amount: v } : r)));
                        }}
                      />
                      {!row.is_me ? (
                        <label style={{ fontSize: "0.75rem", display: "flex", gap: "0.25rem", alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={row.settled}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setSplitDrafts((prev) => prev.map((r, i) => (i === idx ? { ...r, settled: checked } : r)));
                            }}
                          />
                          pagado
                        </label>
                      ) : (
                        <span className="muted" style={{ fontSize: "0.75rem" }}>tú</span>
                      )}
                      <button
                        type="button"
                        className="button-secondary"
                        aria-label="Quitar parte"
                        disabled={row.is_me || splitDrafts.length <= 2}
                        onClick={() => setSplitDrafts((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.35rem" }}>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={saving}
                    onClick={() => setSplitDrafts((prev) => [
                      ...prev,
                      { person_name: "", amount: "0", is_me: false, settled: false },
                    ])}
                  >
                    Añadir persona
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={saving}
                    onClick={() => {
                      setSplitsEnabled(false);
                      setSplitDrafts([]);
                    }}
                  >
                    Quitar división
                  </button>
                </div>
                <p className={`muted${Math.abs(splitDiff) > 0.02 ? " negative" : ""}`} style={{ fontSize: "0.8rem" }}>
                  Suma partes: {splitSum.toFixed(2)} / {totalAbs.toFixed(2)}
                  {Math.abs(splitDiff) > 0.02 ? ` (falta ajustar ${(-splitDiff).toFixed(2)})` : ""}
                </p>
              </>
            )}
          </fieldset>
        )}

        <div className="modal-actions">
          <button type="button" className="button-secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </EditModalShell>
  );
}
