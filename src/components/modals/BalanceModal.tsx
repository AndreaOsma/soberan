import { useState } from "react";
import type { Account } from "../../types";
import { api } from "../../services/api";
import { parseNum } from "../../utils/format";
import { ModalFormError } from "../ModalFormError";
import { EditModalShell } from "../EditModalShell";

interface Props {
  accountId: number;
  alias: string;
  current: number;
  account: Account;
  formatEUR: (v: number) => string;
  onClose: () => void;
  onSaved: () => void;
}

export function BalanceModal({ accountId, alias, current, account, formatEUR, onClose, onSaved }: Props) {
  const [value, setValue] = useState(String(current));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const val = parseNum(value);
    if (isNaN(val)) {
      setError("Introduce un importe válido.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.updateAccount(accountId, { ...account, balance_actual: val });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el saldo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditModalShell title={`Editar saldo — ${alias}`} onClose={onClose}>
        <p className="modal-subtitle muted">Saldo actual: {formatEUR(current)}</p>
        <ModalFormError error={error} />
        <input
          type="text"
          inputMode="decimal"
          className="modal-input"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={async e => {
            if (e.key === "Enter") { await save(); }
            else if (e.key === "Escape") { onClose(); }
          }}
          autoFocus
        />
        <div className="modal-actions">
          <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" onClick={() => void save()} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
        </div>
    </EditModalShell>
  );
}
