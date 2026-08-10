import { useMemo, useState, type FormEvent } from "react";
import type { Account } from "../../types";
import { categoryOptionsForAmount } from "../../utils/expenseCategories";

export type TxFormValues = {
  account_id: number;
  amount: number;
  category_anon: string;
  description_raw: string;
  tipo_meta: string;
  date: string;
};

type Props = {
  accounts: Account[];
  knownCategories: string[];
  categoryRules?: Record<string, string>;
  initialAccountId?: number;
  saving?: boolean;
  onSubmit: (values: TxFormValues) => void | Promise<void>;
};

function emptyForm(initialAccountId = 0): TxFormValues {
  return {
    account_id: initialAccountId,
    amount: 0,
    category_anon: "",
    description_raw: "",
    tipo_meta: "",
    date: "",
  };
}

export function TxForm({
  accounts,
  knownCategories,
  categoryRules = {},
  initialAccountId = 0,
  saving = false,
  onSubmit,
}: Props) {
  const [form, setForm] = useState(() => emptyForm(initialAccountId || accounts[0]?.id || 0));
  const [amountInput, setAmountInput] = useState(() => (form.amount === 0 ? "" : String(form.amount)));
  const set = <K extends keyof TxFormValues>(key: K, value: TxFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const suggestedCategory = useMemo(() => {
    const text = (form.description_raw || "").toLowerCase();
    if (!text) return "";
    const matched = Object.entries(categoryRules).find(([pattern]) => text.includes(pattern.toLowerCase()));
    return matched?.[1] || "";
  }, [form.description_raw, categoryRules]);

  const suggestedCategoryId = suggestedCategory ? "tx-category-suggested" : undefined;
  const amountPreview = Number.parseFloat(amountInput.replace(",", "."));
  const options = useMemo(() => {
    const base = categoryOptionsForAmount(Number.isFinite(amountPreview) ? amountPreview : -1, form.category_anon);
    const extra = knownCategories.filter((c) => c && !base.includes(c));
    return [...base, ...extra];
  }, [amountPreview, form.category_anon, knownCategories]);

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const amount = Number.parseFloat(amountInput.replace(",", "."));
        if (!Number.isFinite(amount)) return;
        void onSubmit({
          ...form,
          amount,
          category_anon: form.category_anon || suggestedCategory,
        });
      }}
      className="smart-links modal-form modal-form--tx"
    >
      <p className="modal-form__intro">Registra el movimiento con una descripción y categoría que luego puedas filtrar fácilmente.</p>
      <label className="modal-form__label">
        Cuenta
        <span className="modal-form__helper">Selecciona dónde ocurrió el movimiento.</span>
        <select
          value={form.account_id}
          onChange={(e) => set("account_id", Number(e.target.value))}
          required
        >
          <option value={0}>Seleccionar cuenta...</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.alias_real} ({a.banco})
            </option>
          ))}
        </select>
      </label>
      <label className="modal-form__label">
        Descripción
        <span className="modal-form__helper">Usa el texto del banco o una nota breve fácil de reconocer.</span>
        <input
          value={form.description_raw}
          onChange={(e) => set("description_raw", e.target.value)}
          required
          placeholder="Ej: Compra Mercadona"
          autoFocus
        />
      </label>
      <div className="grid two-col modal-form__two-col">
        <label className="modal-form__label">
          Importe
          <span className="modal-form__helper">Negativo para gasto, positivo para ingreso o ajuste.</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            required
          />
        </label>
        <label className="modal-form__label">
          Fecha
          <span className="modal-form__helper">Si la dejas vacía, podrás completarla después.</span>
          <input
            type="date"
            value={form.date}
            onChange={(e) => set("date", e.target.value)}
          />
        </label>
      </div>
      <label className="modal-form__label">
        Categoría
        <span className="modal-form__helper">Elige una categoría de la lista fija (gasto o ingreso según el importe).</span>
        {suggestedCategory && (
          <span id={suggestedCategoryId} className="modal-form__hint">
            Sugerida: {suggestedCategory}
          </span>
        )}
        <select
          value={form.category_anon}
          onChange={(e) => set("category_anon", e.target.value)}
          aria-describedby={suggestedCategoryId}
        >
          <option value="">— elegir categoría —</option>
          {form.category_anon && !options.includes(form.category_anon) && (
            <option value={form.category_anon}>{form.category_anon} (legacy)</option>
          )}
          {options.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
      <div className="modal-form__status-row" aria-live="polite">
        <span className="modal-form__required">Los campos obligatorios se guardan al momento.</span>
        {saving ? <span className="modal-form__status">Guardando movimiento...</span> : null}
      </div>
      <button type="submit" disabled={saving} className="modal-form__submit">
        {saving ? "Guardando…" : "Guardar movimiento"}
      </button>
    </form>
  );
}
