import { useCallback, useState } from "react";

type Options = {
  onError?: (message: string) => void;
};

export function useAsyncSubmit(options?: Options) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onError = options?.onError;

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setSaving(true);
      setError(null);
      try {
        await action();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "No se pudo completar la operación.";
        setError(msg);
        onError?.(msg);
      } finally {
        setSaving(false);
      }
    },
    [onError]
  );

  const clearError = useCallback(() => setError(null), []);

  return { saving, error, run, clearError };
}
