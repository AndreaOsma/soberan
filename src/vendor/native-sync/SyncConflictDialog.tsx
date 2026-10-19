/* GENERADO desde dev/lib/native-sync (Homelab): no lo edites aquí, edita la librería y ejecuta su sync.mjs */
import { useEffect, useRef, useState } from "react";
import type { SyncConflict } from "./useAutoSync";

type Props = {
  conflict: SyncConflict | null;
  resolving: boolean;
  resolve: (keep: "local" | "remote") => Promise<void>;
};

function formatWhen(iso: string): string {
  if (!iso) return "nunca";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Pregunta qué versión manda cuando este dispositivo y Google Drive cambiaron a la vez.
 * <dialog> nativo con showModal(): foco atrapado, Esc y fondo inerte sin código propio. Esc
 * solo lo cierra; el conflicto vuelve en el siguiente auto-sync, nunca se pierde nada por
 * cerrar. La opción descartada queda igualmente en sync-backups/ del dispositivo.
 */
export function SyncConflictDialog({ conflict, resolving, resolve }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (conflict && !dialog.open) {
      setError(null);
      dialog.showModal();
    } else if (!conflict && dialog.open) {
      dialog.close();
    }
  }, [conflict]);

  async function choose(keep: "local" | "remote") {
    setError(null);
    try {
      await resolve(keep);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo sincronizar. Inténtalo de nuevo.");
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="sync-conflict-title"
      className="card"
      style={{ maxWidth: "26rem", width: "calc(100% - 2rem)", border: "none", borderRadius: "1rem", padding: "1.25rem" }}
    >
      <h2 id="sync-conflict-title" style={{ marginTop: 0 }}>Hay cambios en dos sitios</h2>
      <p style={{ marginTop: 0 }}>
        Has cambiado datos en este dispositivo y, desde la última sincronización, también se han guardado
        cambios desde otro en Google Drive. Elige cuál se queda.
      </p>
      {conflict && (
        <p className="muted" style={{ fontSize: "0.82rem" }}>
          Última sincronización de este dispositivo: {formatWhen(conflict.last_sync_at)}
          <br />
          Última versión en Google Drive: {formatWhen(conflict.remote_modified)}
        </p>
      )}
      <p className="muted" style={{ fontSize: "0.78rem" }}>
        La versión que descartes se guarda como copia en este dispositivo.
      </p>
      {error && (
        <p role="alert" style={{ color: "var(--danger, #c0392b)", fontSize: "0.85rem" }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
        <button type="button" disabled={resolving} aria-busy={resolving} onClick={() => void choose("local")}>
          {resolving ? "Sincronizando…" : "Quedarme con este dispositivo"}
        </button>
        <button type="button" className="button-secondary" disabled={resolving} onClick={() => void choose("remote")}>
          Usar lo de Google Drive
        </button>
      </div>
    </dialog>
  );
}
