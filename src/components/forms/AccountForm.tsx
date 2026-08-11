import { useState, type FormEvent } from "react";

export type AccountFormValues = {
  alias_real: string;
  alias_anonimo: string;
  tipo: string;
  balance_actual: number;
  banco: string;
};

type Props = {
  saving?: boolean;
  onSubmit: (values: AccountFormValues) => void | Promise<void>;
};

const EMPTY: AccountFormValues = {
  alias_real: "",
  alias_anonimo: "",
  tipo: "gasto",
  balance_actual: 0,
  banco: "",
};

export function AccountForm({ saving = false, onSubmit }: Props) {
  const [form, setForm] = useState<AccountFormValues>(EMPTY);
  const [balanceInput, setBalanceInput] = useState("");
  const set = <K extends keyof AccountFormValues>(key: K, value: AccountFormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const balance = Number.parseFloat(balanceInput.replace(",", "."));
        void onSubmit({ ...form, balance_actual: Number.isFinite(balance) ? balance : 0 });
      }}
      className="smart-links modal-form modal-form--account"
    >
      <p className="modal-form__intro">Crea una cuenta con nombre claro y saldo inicial para empezar a registrar movimientos.</p>
      <label className="modal-form__label">
        Alias real
        <span className="modal-form__helper">Nombre visible dentro de Soberan.</span>
        <input
          value={form.alias_real}
          onChange={(e) => set("alias_real", e.target.value)}
          required
          placeholder="Ej: Cuenta Principal"
          autoFocus
        />
      </label>
      <label className="modal-form__label">
        Alias anónimo
        <span className="modal-form__helper">Opcional. Útil si prefieres ocultar el banco real en algunas vistas.</span>
        <input
          value={form.alias_anonimo}
          onChange={(e) => set("alias_anonimo", e.target.value)}
          placeholder="Ej: Banco A"
        />
      </label>
      <label className="modal-form__label">
        Banco
        <span className="modal-form__helper">Entidad o proveedor de la cuenta.</span>
        <input
          value={form.banco}
          onChange={(e) => set("banco", e.target.value)}
          required
          placeholder="Ej: Revolut"
        />
      </label>
      <div className="grid two-col modal-form__two-col">
        <label className="modal-form__label">
          Tipo
          <select value={form.tipo} onChange={(e) => set("tipo", e.target.value)}>
            <option value="gasto">Gasto</option>
            <option value="ahorro">Ahorro</option>
            <option value="inversiones">Inversiones</option>
            <option value="metas">Metas</option>
          </select>
        </label>
        <label className="modal-form__label">
          Saldo
          <span className="modal-form__helper">Puedes ajustarlo más tarde si aún no lo tienes exacto.</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={balanceInput}
            onChange={(e) => setBalanceInput(e.target.value)}
          />
        </label>
      </div>
      <div className="modal-form__status-row" aria-live="polite">
        <span className="modal-form__required">Los campos obligatorios se guardan al momento.</span>
        {saving ? <span className="modal-form__status">Guardando cuenta...</span> : null}
      </div>
      <button type="submit" disabled={saving} className="modal-form__submit">
        {saving ? "Guardando…" : "Guardar cuenta"}
      </button>
    </form>
  );
}
