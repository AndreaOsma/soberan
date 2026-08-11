import { useCallback, useState } from "react";

type ToastType = "success" | "error" | "info";

type NotifyOptions = {
  addToast: (msg: string, type: ToastType) => void;
  loadAll?: (opts?: { silent?: boolean }) => Promise<void>;
};

export function useNotify({ addToast, loadAll }: NotifyOptions) {
  const [busy, setBusy] = useState(false);

  const notifyAfter = useCallback(
    async (action: () => Promise<void>, okText: string, failText: string) => {
      setBusy(true);
      try {
        await action();
        addToast(okText, "success");
        if (loadAll) await loadAll({ silent: true });
      } catch (err) {
        addToast(err instanceof Error ? err.message : failText, "error");
      } finally {
        setBusy(false);
      }
    },
    [addToast, loadAll]
  );

  return { busy, notifyAfter };
}
