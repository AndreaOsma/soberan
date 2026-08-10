import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, API_BASE_URL } from "../services/api";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type PendingWrite = { call_id: string; tool: string; args: Record<string, unknown>; summary: string };

type Options = {
  chatEnabled: boolean;
  desktopMode: boolean;
};

export function useChat({ chatEnabled, desktopMode }: Options) {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    try {
      const stored = localStorage.getItem("soberan-chat-history");
      return stored ? (JSON.parse(stored) as ChatMessage[]) : [];
    } catch {
      return [];
    }
  });
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStatus, setChatStatus] = useState<string | null>(null);
  const [chatOnline, setChatOnline] = useState<boolean | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingWrite[] | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [messageQueue, setMessageQueue] = useState<string[]>([]);

  // sendChat/doSend need the message list as of "right now" to build the
  // request body, but state updates aren't synchronous — a ref mirrors
  // chatMessages so queued sends (processed later, after other renders)
  // always read the truly-current history instead of a stale closure.
  const chatMessagesRef = useRef<ChatMessage[]>(chatMessages);
  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  useEffect(() => {
    try {
      localStorage.setItem("soberan-chat-history", JSON.stringify(chatMessages.slice(-100)));
    } catch {
      /* ignore */
    }
  }, [chatMessages]);

  useEffect(() => {
    if (!chatOpen || !chatEnabled) return;
    setChatOnline(null);
    api
      .getChatStatus()
      .then((d) => setChatOnline(d.ollama === "ok"))
      .catch(() => setChatOnline(false));
  }, [chatOpen, chatEnabled]);

  useEffect(() => {
    document.body.classList.toggle("chat-open", chatOpen && chatEnabled);
    return () => document.body.classList.remove("chat-open");
  }, [chatOpen, chatEnabled]);

  const doSend = useCallback(async (newMessages: ChatMessage[]) => {
    const ollamaOfflineMsg = desktopMode
      ? "El asistente requiere Ollama en tu PC. Instálalo desde ollama.com o ignora el chat — el resto de Soberan funciona sin él."
      : "Ollama no disponible — asegúrate de que el servidor Ollama está activo antes de usar el asistente.";
    setChatLoading(true);
    setChatStatus(null);
    try {
      const res = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (res.status === 503 || (data.detail ?? "").toString().toLowerCase().includes("ollama")) {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: typeof data.detail === "string" ? data.detail : ollamaOfflineMsg },
          ]);
        } else {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Error: ${data.detail ?? "Sin respuesta"}` },
          ]);
        }
        return;
      }

      // Backend streams ndjson: one {"status": ...} line per real step
      // (tool call, generating reply), then a terminal {"reply": ...} or
      // {"error": ...} line. Read incrementally so the UI reflects actual
      // backend progress instead of a static "…".
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("Sin cuerpo de respuesta");
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let finalReply: string | null = null;
      let finalError: string | null = null;
      let finalConfirm: PendingWrite[] | null = null;

      const handleEvt = (evt: any) => {
        if (evt.status) setChatStatus(evt.status);
        else if (evt.confirm !== undefined) finalConfirm = evt.confirm;
        else if (evt.reply !== undefined) finalReply = evt.reply;
        else if (evt.error !== undefined) finalError = evt.error;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          handleEvt(JSON.parse(line));
        }
      }
      if (buffer.trim()) handleEvt(JSON.parse(buffer));

      if (finalConfirm) {
        setPendingConfirm(finalConfirm);
      } else if (finalError) {
        setChatMessages((prev) => [...prev, { role: "assistant", content: finalError as string }]);
      } else {
        setChatMessages((prev) => [...prev, { role: "assistant", content: finalReply ?? "Sin respuesta." }]);
      }
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", content: ollamaOfflineMsg }]);
    } finally {
      setChatLoading(false);
      setChatStatus(null);
    }
  }, [desktopMode]);

  // Typing/sending is never blocked by chatLoading — a message submitted
  // while the assistant is still answering just joins the chat right away
  // (so it doesn't look like it vanished) and waits its turn; the effect
  // below sends it once the current request (and any pending confirmation)
  // clears.
  async function sendMessage(rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    // Computed explicitly (not read back from chatMessagesRef) because the
    // ref only updates via an effect after this render commits — reading
    // it here, in the same tick as the setChatMessages call below, would
    // still see the OLD value and send the backend a history missing the
    // message the user just typed.
    const newMessages: ChatMessage[] = [...chatMessagesRef.current, { role: "user", content: text }];
    setChatMessages(newMessages);
    if (chatLoading || pendingConfirm) {
      setMessageQueue((prev) => [...prev, text]);
    } else {
      await doSend(newMessages);
    }
  }

  async function sendChat(e: FormEvent) {
    e.preventDefault();
    await sendMessage(chatInput);
    setChatInput("");
  }

  useEffect(() => {
    if (chatLoading || pendingConfirm || messageQueue.length === 0) return;
    setMessageQueue((prev) => prev.slice(1));
    // Unlike the immediate-send path above, it's safe to read the ref here:
    // this effect runs on its own tick, strictly after the render (and ref
    // sync) that appended every queued message's user bubble, so it always
    // reflects the true up-to-date history.
    void doSend(chatMessagesRef.current);
  }, [chatLoading, pendingConfirm, messageQueue, doSend]);

  async function confirmWrites() {
    if (!pendingConfirm || !pendingConfirm.length) return;
    setConfirmLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/chat/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          writes: pendingConfirm.map((w) => ({ tool: w.tool, args: w.args })),
        }),
      });
      const data = await res.json();
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.ok ? data.reply : `Error: ${data.detail ?? "Sin respuesta"}` },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "No se pudo confirmar la acción — inténtalo de nuevo." },
      ]);
    } finally {
      setPendingConfirm(null);
      setConfirmLoading(false);
    }
  }

  function cancelWrites() {
    setChatMessages((prev) => [
      ...prev,
      { role: "assistant", content: "Cancelado. No se ha hecho ningún cambio." },
    ]);
    setPendingConfirm(null);
  }

  return {
    chatOpen,
    setChatOpen,
    chatMessages,
    setChatMessages,
    chatInput,
    setChatInput,
    chatLoading,
    chatStatus,
    chatOnline,
    sendChat,
    sendMessage,
    pendingConfirm,
    confirmLoading,
    confirmWrites,
    cancelWrites,
  };
}
