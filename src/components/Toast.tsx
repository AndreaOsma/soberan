import { useEffect } from "react";

export type ToastItem = {
  id: number;
  message: string;
  type: "success" | "error" | "info";
  duration?: number;
  action?: { label: string; onClick: () => void };
};

type Props = {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
};

export function ToastContainer({ toasts, onDismiss }: Props) {
  return (
    <div className="toast-container" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <Toast key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const duration = item.duration ?? 4000;
  const live = item.type === "error" ? "assertive" : "polite";

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(item.id), duration);
    return () => clearTimeout(timer);
  }, [item.id, duration, onDismiss]);

  return (
    <div className={`toast toast-${item.type}`} role="alert" aria-live={live}>
      <span className="toast-message">{item.message}</span>
      {item.action && (
        <button
          className="toast-action"
          onClick={() => {
            item.action!.onClick();
            onDismiss(item.id);
          }}
        >
          {item.action.label}
        </button>
      )}
      <button className="toast-close" onClick={() => onDismiss(item.id)} aria-label="Cerrar notificación">×</button>
    </div>
  );
}
