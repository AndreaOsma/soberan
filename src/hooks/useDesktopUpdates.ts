import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../services/api";
import type { DesktopUpdateInfo } from "../components/DesktopUpdateBanner";
import type { AddToastOptions } from "./useAppToasts";

type AddToast = (
  message: string,
  type: "success" | "error" | "info",
  opts?: AddToastOptions,
) => void;

type Options = {
  desktopCheckUpdates: string | undefined;
  addToast: AddToast;
};

export function useDesktopUpdates({ desktopCheckUpdates, addToast }: Options) {
  const [desktopMode, setDesktopMode] = useState(false);
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateInfo | null>(null);
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/desktop/info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { desktop?: boolean; version?: string } | null) => {
        setDesktopMode(Boolean(d?.desktop));
        setDesktopVersion(d?.version ?? null);
      })
      .catch(() => {
        setDesktopMode(false);
        setDesktopVersion(null);
      });
  }, []);

  useEffect(() => {
    if (!desktopMode) {
      setDesktopUpdate(null);
      return;
    }
    if (desktopCheckUpdates === "0") {
      setDesktopUpdate({ update_available: false, check_enabled: false });
      return;
    }
    fetch(`${API_BASE_URL}/desktop/update-check`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DesktopUpdateInfo | null) => {
        if (!d) return;
        const dismissed = localStorage.getItem("soberan-update-dismissed");
        if (d.update_available && dismissed === d.latest_version) {
          setDesktopUpdate({ ...d, update_available: false });
          return;
        }
        setDesktopUpdate(d);
      })
      .catch(() => setDesktopUpdate(null));
  }, [desktopMode, desktopCheckUpdates]);

  const dismissDesktopUpdate = useCallback(() => {
    setDesktopUpdate((prev) => {
      if (prev?.latest_version) {
        try {
          localStorage.setItem("soberan-update-dismissed", prev.latest_version);
        } catch {
          /* ignore */
        }
      }
      return prev ? { ...prev, update_available: false } : prev;
    });
  }, []);

  const checkDesktopUpdatesNow = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/desktop/update-check?force=1`);
      if (!r.ok) throw new Error("offline");
      const d = (await r.json()) as DesktopUpdateInfo;
      setDesktopUpdate(d);
      if (d.update_available) {
        addToast(`Nueva versión disponible: v${d.latest_version}`, "info");
      } else if (d.error) {
        addToast("No se pudo comprobar actualizaciones (sin conexión).", "info");
      } else {
        addToast(`Estás al día (v${d.current_version ?? desktopVersion ?? "?"}).`, "success");
      }
    } catch {
      addToast("No se pudo comprobar actualizaciones.", "error");
    }
  }, [addToast, desktopVersion]);

  return {
    desktopMode,
    desktopUpdate,
    desktopVersion,
    dismissDesktopUpdate,
    checkDesktopUpdatesNow,
  };
}
