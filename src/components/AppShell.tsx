import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { alertActionFor } from "../utils/alertActions";
import { APP_VERSION, formatCopyrightYearRange } from "../utils/copyright";
import { AppearanceToggle } from "./AppearanceToggle";
import { DensityToggle } from "./DensityToggle";
import { DesktopUpdateBanner, type DesktopUpdateInfo } from "./DesktopUpdateBanner";
import { FloatingSidebar } from "./FloatingSidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { ViewSkeleton } from "./ViewSkeleton";
import type { AlertItem } from "../types";
import type { MenuKey } from "../config/ui";

type Props = {
  effectiveDark: boolean;
  privacyMode: boolean;
  uiDensity: "minimal" | "detailed";
  shellStyle: CSSProperties;
  currentMenu: MenuKey;
  setCurrentMenu: (menu: MenuKey) => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  dayNightMode: "day" | "night" | "auto";
  setDayNightMode: (mode: "day" | "night" | "auto") => void;
  setUiDensity: (density: "minimal" | "detailed") => void;
  setPrivacyMode: (value: boolean | ((prev: boolean) => boolean)) => void;
  setMethodGuideOpen: (open: boolean) => void;
  alerts: AlertItem[];
  highAlertsCount: number;
  alertsPopoverOpen: boolean;
  setAlertsPopoverOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  desktopMode: boolean;
  desktopUpdate: DesktopUpdateInfo | null;
  dismissDesktopUpdate: () => void;
  showContentToolbar: boolean;
  showToolbarActions: boolean;
  showToolbarPeriod: boolean;
  monthRefreshing: boolean;
  month: number;
  year: number;
  adjustMonth: (offset: number) => void;
  setMonth: (month: number) => void;
  setYear: (year: number) => void;
  setIsTxModalOpen: (open: boolean) => void;
  setIsAccountModalOpen: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  message: string | null;
  children: ReactNode;
  modals: ReactNode;
};

export function AppShell({
  effectiveDark,
  privacyMode,
  uiDensity,
  shellStyle,
  currentMenu,
  setCurrentMenu,
  isSidebarOpen,
  setIsSidebarOpen,
  dayNightMode,
  setDayNightMode,
  setUiDensity,
  setPrivacyMode,
  setMethodGuideOpen,
  alerts,
  highAlertsCount,
  alertsPopoverOpen,
  setAlertsPopoverOpen,
  desktopMode,
  desktopUpdate,
  dismissDesktopUpdate,
  showContentToolbar,
  showToolbarActions,
  showToolbarPeriod,
  monthRefreshing,
  month,
  year,
  adjustMonth,
  setMonth,
  setYear,
  setIsTxModalOpen,
  setIsAccountModalOpen,
  loading,
  error,
  message,
  children,
  modals,
}: Props) {
  const alertsPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!alertsPopoverOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAlertsPopoverOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (alertsPopoverRef.current && !alertsPopoverRef.current.contains(e.target as Node)) {
        setAlertsPopoverOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [alertsPopoverOpen, setAlertsPopoverOpen]);

  return (
    <main
      className={`app-shell ${effectiveDark ? "theme-dark" : "theme-light"} ${privacyMode ? "privacy-mode" : ""} density-${uiDensity}`}
      style={shellStyle}
    >
      <FloatingSidebar
        currentMenu={currentMenu}
        setCurrentMenu={setCurrentMenu}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        focusSearch={isSidebarOpen}
      />

      <nav className="topbar">
        <div className="topbar-start">
          <button
            className="topbar-menu-btn"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Abrir menú"
            title="Menú (⌘K)"
          >
            ☰
          </button>
          <span className="topbar-brand">Soberan</span>
        </div>
        <div className="topbar-center">
          <h1 className="topbar-title">{currentMenu}</h1>
        </div>
        <div className="topbar-end">
          {currentMenu === "Resumen Ejecutivo" && (
            <DensityToggle value={uiDensity} onChange={setUiDensity} />
          )}
          <button
            type="button"
            className="topbar-icon-btn topbar-help-btn"
            onClick={() => setMethodGuideOpen(true)}
            title="Cómo funciona"
            aria-label="Cómo funciona"
          >
            ?
          </button>
          <button
            type="button"
            className="topbar-icon-btn"
            onClick={() => setPrivacyMode(!privacyMode)}
            title={privacyMode ? "Desactivar privacidad" : "Activar privacidad"}
            aria-label={privacyMode ? "Desactivar modo privacidad" : "Activar modo privacidad"}
          >
            {privacyMode ? "🕶️" : "👀"}
          </button>
          <div className="alerts-popover-wrap" ref={alertsPopoverRef}>
            <button
              type="button"
              className={`badge ${highAlertsCount > 0 ? "negative" : "positive"} alerts-popover-trigger`}
              onClick={() => setAlertsPopoverOpen((o) => !o)}
              title={highAlertsCount > 0 ? `${highAlertsCount} alerta${highAlertsCount !== 1 ? "s" : ""} alta` : "Sin alertas"}
              aria-expanded={alertsPopoverOpen}
              aria-controls="alerts-popover"
              aria-haspopup="true"
            >
              {highAlertsCount > 0 ? `⚠ ${highAlertsCount}` : "✓ OK"}
            </button>
            {alertsPopoverOpen && alerts.length > 0 && (
              <div id="alerts-popover" className="alerts-popover" role="region" aria-label="Alertas activas">
                <p className="alerts-popover__title">Alertas activas</p>
                <div className="alerts-popover__list">
                  {alerts.slice(0, 8).map((a, i) => {
                    const action = alertActionFor(a.tipo);
                    return (
                      <div key={i} className="alerts-popover__item">
                        <span className={`priority-tag priority-${a.severidad}`}>
                          {a.severidad === "alta" ? "Alta" : a.severidad === "media" ? "Media" : "Baja"}
                        </span>
                        <div className="alerts-popover__item-body">
                          <span>{a.mensaje}</span>
                          <button
                            type="button"
                            className="button-secondary alerts-popover__cta"
                            onClick={() => {
                              setCurrentMenu(action.menu);
                              setAlertsPopoverOpen(false);
                            }}
                          >
                            {action.label} →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {alerts.length > 8 && (
                    <p className="muted alerts-popover__more">+{alerts.length - 8} más</p>
                  )}
                </div>
              </div>
            )}
            {alertsPopoverOpen && alerts.length === 0 && (
              <div id="alerts-popover" className="alerts-popover alerts-popover--empty" role="region" aria-label="Alertas activas">
                <span className="positive">✓ Sin anomalías detectadas</span>
              </div>
            )}
          </div>
          <AppearanceToggle value={dayNightMode} onChange={setDayNightMode} />
        </div>
      </nav>

      <section className="content">
        {desktopMode && desktopUpdate?.update_available && (
          <DesktopUpdateBanner update={desktopUpdate} onDismiss={dismissDesktopUpdate} />
        )}
        {showContentToolbar && (
          <div className="content-toolbar">
            {showToolbarActions && (
              <div className="content-toolbar__actions">
                <button onClick={() => setIsTxModalOpen(true)}>+ Movimiento</button>
                {(["Cuentas"] as MenuKey[]).includes(currentMenu) && (
                  <button className="button-secondary" onClick={() => setIsAccountModalOpen(true)}>
                    + Cuenta
                  </button>
                )}
              </div>
            )}
            {showToolbarPeriod && (
              <div className="content-toolbar__period">
                <button
                  type="button"
                  className="button-secondary content-toolbar__period-nav"
                  onClick={() => adjustMonth(-1)}
                  disabled={monthRefreshing}
                  aria-label="Mes anterior"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className={`period-label${monthRefreshing ? " period-label--refreshing" : ""}`}
                  onClick={() => {
                    const n = new Date();
                    setMonth(n.getMonth() + 1);
                    setYear(n.getFullYear());
                  }}
                  title="Volver al mes actual"
                  aria-busy={monthRefreshing}
                >
                  {new Intl.DateTimeFormat("es", { month: "long" }).format(new Date(year, month - 1))} {year}
                  {(month !== new Date().getMonth() + 1 || year !== new Date().getFullYear()) && (
                    <span style={{ marginLeft: "0.4rem", fontSize: "0.7rem", opacity: 0.55 }}>· hoy</span>
                  )}
                </button>
                <button
                  type="button"
                  className="button-secondary content-toolbar__period-nav"
                  onClick={() => adjustMonth(1)}
                  disabled={monthRefreshing}
                  aria-label="Mes siguiente"
                >
                  ›
                </button>
              </div>
            )}
          </div>
        )}

        {loading ? <ViewSkeleton rows={4} /> : null}
        {!loading && error ? <p className="error-banner">{error}</p> : null}
        {!loading && message ? <p className="success-banner">{message}</p> : null}

        {!loading ? children : null}

        <footer className="site-footer">
          <small>
            &copy; {formatCopyrightYearRange()}{" "}
            <a
              href="https://andreaosma.com"
              className="site-footer__link"
              target="_blank"
              rel="noopener noreferrer"
            >
              Andrea Osma Rafael
            </a>
            . Todos los derechos reservados.
          </small>
          <small>
            v{APP_VERSION} • Built with Vite
          </small>
        </footer>
      </section>

      {modals}

      <MobileBottomNav
        currentMenu={currentMenu}
        onNavigate={(key) => {
          setCurrentMenu(key);
          setIsSidebarOpen(false);
        }}
        onMore={() => setIsSidebarOpen(true)}
      />
    </main>
  );
}
