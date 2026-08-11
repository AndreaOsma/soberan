import { useState } from "react";
import { api } from "../../services/api";
import { GlassModal } from "../../components/GlassModal";
import { CardModal } from "../../components/modals/CardModal";
import type { Card } from "../../types";
import { parseNum } from "../../utils/format";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../../components/ModalFormError";

export type CardsPanelProps = {
  cards: Card[];
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  deleteWithUndo: (label: string, onCommit: () => Promise<void>) => void;
};

export function CardsPanel({
  cards, formatEUR, addToast, loadAll, deleteWithUndo,
}: CardsPanelProps) {
  const [isCardFormOpen, setIsCardFormOpen] = useState(false);
  const [cardForm, setCardForm] = useState({ nombre: "", tipo: "D", banco: "", limite: 0 });
  const [editCardModal, setEditCardModal] = useState<Card | null>(null);
  const createSubmit = useAsyncSubmit();

  return (
    <>
      <section className="grid one-col">
        <article className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2>Tarjetas</h2>
            <button onClick={() => setIsCardFormOpen(true)}>+ Nueva tarjeta</button>
          </div>
          {cards.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">💳</div>
              <h3>Sin tarjetas registradas</h3>
              <p>Añade tus tarjetas de débito y crédito.</p>
              <button onClick={() => setIsCardFormOpen(true)}>+ Añadir tarjeta</button>
            </div>
          ) : (
            <ul className="list">
              {cards.map((item) => (
                <li key={item.id}>
                  <span>{item.nombre} · {item.banco}</span>
                  <div className="inline-actions">
                    <strong>{item.tipo === "D" ? "Débito" : "Crédito"}{item.limite ? ` · ${formatEUR(item.limite)}` : ""}</strong>
                    <button type="button" className="button-secondary" style={{ padding: "0.25rem 0.5rem" }}
                      aria-label={`Editar tarjeta ${item.nombre}`} title="Editar"
                      onClick={() => setEditCardModal(item)}>✎</button>
                    <button type="button" className="danger"
                      aria-label={`Eliminar tarjeta ${item.nombre}`} title="Eliminar"
                      onClick={() => deleteWithUndo("Tarjeta", () => api.deleteCard(item.id).then(() => loadAll()))}>
                      🗑
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      {editCardModal && <CardModal item={editCardModal} onClose={() => setEditCardModal(null)} onSaved={loadAll} />}

      <GlassModal isOpen={isCardFormOpen} onClose={() => setIsCardFormOpen(false)} title="Nueva tarjeta">
        <ModalFormError error={createSubmit.error} />
        <form onSubmit={(e) => {
          e.preventDefault();
          void createSubmit.run(async () => {
            await api.createCard({ ...cardForm, limite: cardForm.limite > 0 ? cardForm.limite : undefined });
            setCardForm({ nombre: "", tipo: "D", banco: "", limite: 0 });
            setIsCardFormOpen(false);
            addToast("Tarjeta creada.", "success");
            await loadAll({ silent: true });
          });
        }}>
          <label>Nombre<input value={cardForm.nombre} onChange={e => setCardForm(p => ({ ...p, nombre: e.target.value }))} required autoFocus /></label>
          <div className="grid two-col" style={{ gap: "0.75rem", marginTop: "0.75rem" }}>
            <label>Tipo<select value={cardForm.tipo} onChange={e => setCardForm(p => ({ ...p, tipo: e.target.value }))}><option value="D">Débito</option><option value="C">Crédito</option></select></label>
            <label>Banco<input value={cardForm.banco} onChange={e => setCardForm(p => ({ ...p, banco: e.target.value }))} required /></label>
            <label>Límite (€)<input type="number" value={cardForm.limite || ""} onChange={e => setCardForm(p => ({ ...p, limite: parseNum(e.target.value) }))} /></label>
          </div>
          <div className="modal-actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="button-secondary" onClick={() => setIsCardFormOpen(false)}>Cancelar</button>
            <button type="submit" disabled={createSubmit.saving}>{createSubmit.saving ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      </GlassModal>

      </>
    );
}
