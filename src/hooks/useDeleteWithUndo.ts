import type { ToastItem } from "../components/Toast";
import type { AddToastOptions } from "./useAppToasts";

type AddToast = (
  message: string,
  type: "success" | "error" | "info",
  opts?: AddToastOptions,
) => void;

type Options = {
  addToast: AddToast;
  dismissToast: (id: number) => void;
  allocateToastId: () => number;
  pushToast: (toast: ToastItem) => void;
};

/** Optimistic delete: shows an undo toast for 5s, only commits if it's not cancelled. */
export function useDeleteWithUndo({ addToast, dismissToast, allocateToastId, pushToast }: Options) {
  function deleteWithUndo(label: string, onCommit: () => Promise<void>, onCancel?: () => void) {
    const id = allocateToastId();
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        await onCommit();
      } catch {
        addToast("No se pudo eliminar.", "error");
        onCancel?.();
      }
      dismissToast(id);
    }, 5000);
    pushToast({
      id,
      message: `${label} — se eliminará en 5 s`,
      type: "info" as const,
      duration: 5500,
      action: {
        label: "Deshacer",
        onClick: () => {
          cancelled = true;
          window.clearTimeout(timer);
          onCancel?.();
        },
      },
    });
  }

  return deleteWithUndo;
}
