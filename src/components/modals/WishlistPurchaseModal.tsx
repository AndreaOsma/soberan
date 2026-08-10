import { useState } from "react";
import type { Account, WishlistItem } from "../../types";
import { api } from "../../services/api";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../ModalFormError";
import { EditModalShell } from "../EditModalShell";
import { parseNum } from "../../utils/format";

const lbl = { display: "flex", flexDirection: "column" as const, gap: "0.25rem" };

interface Props {
  item: WishlistItem;
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function WishlistPurchaseModal({ item, accounts, onClose, onSaved }: Props) {
  const defaultAccount = accounts.find((a) => a.tipo === "fondos") ?? accounts[0];
  const { saving, error, run } = useAsyncSubmit();
  const [form, setForm] = useState({
    monto_real: item.monto_estimado != null ? String(item.monto_estimado) : "",
    account_id: defaultAccount?.id ?? 0,
    fecha: todayIso(),
  });
  const set = (k: string, v: string | number) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <EditModalShell title="Marcar como comprado" onClose={onClose}>
      <ModalFormError error={error} />
      <p className="muted" style={{ fontSize: "0.88rem", marginBottom: "0.75rem" }}>
        <strong>{item.nombre}</strong> se archivará y se registrará el gasto en transacciones.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const monto = parseNum(form.monto_real);
            if (monto <= 0) throw new Error("Indica el precio real pagado.");
            if (!form.account_id) throw new Error("Selecciona una cuenta.");
            await api.purchaseWishlistItem(item.id, {
              monto_real: monto,
              account_id: form.account_id,
              fecha: form.fecha ? `${form.fecha}T12:00:00` : undefined,
            });
            onSaved();
            onClose();
          });
        }}
      >
        <div className="grid two-col" style={{ gap: "0.75rem", marginBottom: "0.75rem" }}>
          <label style={lbl}>
            Precio real (€)
            <input
              type="text"
              inputMode="decimal"
              value={form.monto_real}
              onChange={(e) => set("monto_real", e.target.value)}
              required
              autoFocus
            />
          </label>
          <label style={lbl}>
            Fecha de compra
            <input type="date" value={form.fecha} onChange={(e) => set("fecha", e.target.value)} required />
          </label>
        </div>
        <label style={{ ...lbl, marginBottom: "1rem" }}>
          Cuenta
          <select value={form.account_id || ""} onChange={(e) => set("account_id", Number(e.target.value))} required>
            {accounts.length === 0 ? (
              <option value="">Sin cuentas</option>
            ) : (
              accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.alias_real}
                </option>
              ))
            )}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" disabled={saving || accounts.length === 0}>
            {saving ? "Guardando…" : "Confirmar compra"}
          </button>
        </div>
      </form>
    </EditModalShell>
  );
}
