import { useState } from "react";
import { GlassModal } from "./GlassModal";
import { API_BASE_URL } from "../services/api";

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const FEEDBACK_TYPES = [
  { value: "bug", label: "🐛 Algo está roto" },
  { value: "idea", label: "💡 Idea / sugerencia" },
  { value: "ui", label: "🎨 Diseño / usabilidad" },
  { value: "other", label: "💬 Otro" },
];

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

type Props = {
  addToast: (message: string, type: "success" | "error" | "info") => void;
};

export function FeedbackWidget({ addToast }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [type, setType] = useState("bug");
  const [images, setImages] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    if (sending) return;
    setIsOpen(false);
    setMessage("");
    setType("bug");
    setImages([]);
    setError("");
  };

  const onFilesSelected = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (images.length >= MAX_IMAGES) {
        setError(`Máximo ${MAX_IMAGES} imágenes.`);
        break;
      }
      if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES) {
        setError("Imagen demasiado grande (máx. 5MB) o no es una imagen.");
        continue;
      }
      try {
        const dataUrl = await readAsDataUrl(file);
        setImages((prev) => [...prev, dataUrl]);
      } catch {
        /* ignore unreadable file */
      }
    }
  };

  const send = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Escribe algo primero.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          type,
          images,
          context: {
            platform: navigator.userAgent,
            locale: navigator.language,
          },
        }),
      });
      if (!res.ok) throw new Error("failed");
      close();
      addToast("¡Gracias! Feedback enviado.", "success");
    } catch {
      setError("No se pudo enviar — inténtalo de nuevo.");
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="feedback-fab"
        title="Enviar feedback"
        aria-label="Enviar feedback"
        onClick={() => setIsOpen(true)}
      >
        <svg
          className="feedback-fab__icon"
          viewBox="0 0 24 24"
          width="1.25rem"
          height="1.25rem"
          aria-hidden="true"
          focusable="false"
        >
          {/* Megaphone — distinct from the chat-fab speech bubble (asistente). */}
          <path
            fill="currentColor"
            d="M3 10v4a1 1 0 0 0 1 1h1.4l1.3 3.1A1.2 1.2 0 0 0 8.8 19H10a1 1 0 0 0 1-1v-2.1l7.2 2.4A1.5 1.5 0 0 0 21 16.9V7.1a1.5 1.5 0 0 0-2-1.4L11.8 8H5a2 2 0 0 0-2 2Zm8.8-.7 6.2-2.1v9.6l-6.2-2.1V9.3ZM5 10.2h5.8v3.6H6a.8.8 0 0 1-.8-.8v-2.8Zm3.8 6.3-.8-2h1.6v2h-.8Z"
          />
        </svg>
      </button>

      <GlassModal isOpen={isOpen} onClose={close} title="¿Algo va mal? Cuéntanoslo" maxWidth="26rem">
        <p className="feedback-hint">
          Va directo a quien lleva soberan — se adjunta el contexto de esta pantalla automáticamente.
        </p>

        <label className="feedback-label" htmlFor="feedback-type">Tipo</label>
        <select
          id="feedback-type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {FEEDBACK_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <textarea
          className="feedback-textarea"
          rows={5}
          placeholder="¿Qué ha pasado?"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />

        <div className="feedback-attach-row">
          <label className="button-secondary feedback-attach-btn">
            Adjuntar captura
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => void onFilesSelected(e.target.files)}
            />
          </label>
          {images.length > 0 && (
            <div className="feedback-previews">
              {images.map((src, i) => (
                <div key={i} className="feedback-preview">
                  <img src={src} alt="" />
                  <button
                    type="button"
                    className="feedback-preview__remove"
                    onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label="Quitar imagen"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <p className="feedback-error">{error}</p>}

        <div className="feedback-actions">
          <button type="button" className="button-secondary" onClick={close} disabled={sending}>
            Cancelar
          </button>
          <button type="button" onClick={() => void send()} disabled={sending}>
            {sending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </GlassModal>
    </>
  );
}
