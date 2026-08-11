import { useCallback, useRef, useState } from "react";
import type { ToastItem } from "../components/Toast";

export type AddToastOptions = {
  duration?: number;
  action?: { label: string; onClick: () => void };
};

export function useAppToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

  const addToast = useCallback(
    (message: string, type: "success" | "error" | "info", opts?: AddToastOptions) => {
      const id = ++toastIdRef.current;
      setToasts((prev) => [...prev, { id, message, type, ...opts }]);
    },
    [],
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const allocateToastId = useCallback(() => ++toastIdRef.current, []);

  const pushToast = useCallback((toast: ToastItem) => {
    setToasts((prev) => [...prev, toast]);
  }, []);

  return { toasts, addToast, dismissToast, allocateToastId, pushToast };
}
