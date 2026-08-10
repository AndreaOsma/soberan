import { useState, type FormEvent, type ReactNode } from "react";
import type { ChatMessage, PendingWrite } from "../../hooks/useChat";

function renderRich(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}

type Props = {
  desktopMode: boolean;
  chatOpen: boolean;
  setChatOpen: (updater: boolean | ((prev: boolean) => boolean)) => void;
  chatMessages: ChatMessage[];
  setChatMessages: (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  chatLoading: boolean;
  chatStatus: string | null;
  chatOnline: boolean | null;
  sendMessage: (text: string) => void | Promise<void>;
  pendingConfirm: PendingWrite[] | null;
  confirmLoading: boolean;
  confirmWrites: () => void | Promise<void>;
  cancelWrites: () => void;
};

export function ChatPanel({
  desktopMode,
  chatOpen,
  setChatOpen,
  chatMessages,
  setChatMessages,
  chatLoading,
  chatStatus,
  chatOnline,
  sendMessage,
  pendingConfirm,
  confirmLoading,
  confirmWrites,
  cancelWrites,
}: Props) {
  // Local draft so typing does not re-render App / data hooks on every key.
  const [draft, setDraft] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void sendMessage(text);
  }

  return (
    <>
      <button
        className="chat-fab"
        onClick={() => setChatOpen((o) => !o)}
        aria-label="Abrir asistente"
        title="Asistente financiero"
      >
        {chatOpen ? (
          "✕"
        ) : (
          <svg
            className="chat-fab__icon"
            viewBox="0 0 24 24"
            width="1.25rem"
            height="1.25rem"
            aria-hidden="true"
            focusable="false"
          >
            <path
              fill="currentColor"
              d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4.5 3.5A.8.8 0 0 1 3 19.9V6a2 2 0 0 1 2-2Zm2 4v2h12V8H6Zm0 4v2h8v-2H6Z"
            />
          </svg>
        )}
        {!chatOpen && chatOnline === false && (
          <span className="chat-fab__offline" title="Ollama no disponible" />
        )}
      </button>

      {chatOpen && (
        <div className="chat-panel glass">
          <div className="chat-header">
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <strong>Asistente</strong>
              {chatOnline === false && (
                <span
                  style={{
                    fontSize: "0.7rem",
                    color: "#ef4444",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.2rem",
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "#ef4444",
                      display: "inline-block",
                    }}
                  />
                  {desktopMode ? "Ollama no instalado" : "Ollama sin conexión"}
                </span>
              )}
              {chatOnline === true && (
                <span
                  style={{
                    fontSize: "0.7rem",
                    color: "#10b981",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.2rem",
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "#10b981",
                      display: "inline-block",
                    }}
                  />
                  conectado
                </span>
              )}
            </div>
            <button
              onClick={() => setChatMessages([])}
              title="Limpiar conversación"
              style={{ background: "none", border: "none", cursor: "pointer", opacity: 0.6, fontSize: "0.8rem" }}
            >
              limpiar
            </button>
          </div>
          <div className="chat-messages">
            {chatMessages.length === 0 && (
              <p className="chat-empty">
                {desktopMode
                  ? "Pregúntame sobre tus finanzas (requiere Ollama local) o usa el menú para planificar."
                  : "Pregúntame sobre tus finanzas o dime que registre algo."}
              </p>
            )}
            {chatMessages.map((m, i) => (
              <div key={i} className={`chat-bubble ${m.role}`}>
                {renderRich(m.content)}
              </div>
            ))}
            {chatLoading && (
              <div className="chat-bubble assistant chat-typing">{chatStatus ?? "…"}</div>
            )}
            {pendingConfirm && pendingConfirm.length > 0 && (
              <div className="chat-bubble assistant chat-confirm">
                <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>
                  {pendingConfirm.length === 1
                    ? "¿Confirmas esta acción?"
                    : `¿Confirmas estas ${pendingConfirm.length} acciones?`}
                </p>
                <ul style={{ margin: "0 0 0.75rem", paddingLeft: "1.1rem" }}>
                  {pendingConfirm.map((w) => (
                    <li key={w.call_id}>{w.summary}</li>
                  ))}
                </ul>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" onClick={() => confirmWrites()} disabled={confirmLoading}>
                    {confirmLoading ? "Aplicando…" : "Confirmar"}
                  </button>
                  <button type="button" onClick={cancelWrites} disabled={confirmLoading}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
          <form className="chat-input-row" onSubmit={onSubmit}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="¿En qué te ayudo?"
              disabled={!!pendingConfirm}
              autoFocus
            />
            <button
              type="submit"
              disabled={!!pendingConfirm || !draft.trim()}
              aria-label="Enviar mensaje"
            >
              ↑
            </button>
          </form>
        </div>
      )}
    </>
  );
}
