type DesktopUpdateInfo = {
  update_available: boolean;
  current_version?: string;
  latest_version?: string | null;
  download_url?: string | null;
  release_url?: string | null;
  check_enabled?: boolean;
  error?: string | null;
};

type Props = {
  update: DesktopUpdateInfo | null;
  onDismiss: () => void;
};

export function DesktopUpdateBanner({ update, onDismiss }: Props) {
  if (!update?.update_available || !update.latest_version) return null;

  const href = update.download_url || update.release_url || "#";

  return (
    <div className="desktop-update-banner" role="status">
      <div className="desktop-update-banner__text">
        <strong>Hay una actualización disponible</strong>
        <span className="muted">
          {" "}v{update.current_version} → v{update.latest_version}
        </span>
      </div>
      <div className="desktop-update-banner__actions">
        <a
          className="button-secondary desktop-update-banner__btn"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          Descargar
        </a>
        <button type="button" className="desktop-update-banner__dismiss" onClick={onDismiss} aria-label="Ignorar esta versión">
          ✕
        </button>
      </div>
    </div>
  );
}

export type { DesktopUpdateInfo };
