import { useEffect, useMemo, useState } from "react";
import type { CalendarEvent } from "../../types";
import { api } from "../../services/api";
import { EmptyState } from "../../components/EmptyState";
import { MonthCalendarGrid, type CalendarGridEvent } from "../../components/calendar/MonthCalendarGrid";
import { YearCalendarGrid } from "../../components/calendar/YearCalendarGrid";
import { ICalSection } from "../../components/calendar/ICalSection";
import { PeriodViewToggle } from "../../components/PeriodViewToggle";
import type { MenuKey } from "../../config/ui";
import { CAL_LEGEND_ITEMS } from "../../utils/statusColors";
import { useIcalSubscribeLink } from "../../hooks/useIcalSubscribeLink";

type Props = {
  month: number;
  year: number;
  settings: Record<string, string>;
  calendarEvents: CalendarEvent[];
  formatEUR: (value: number) => string;
  saveSetting: (key: string, val: string, notify?: boolean) => Promise<void>;
  onNavigate: (key: MenuKey) => void;
  onGoToMonth?: (month: number, year: number) => void;
  onShiftPeriod?: (delta: number) => void;
};

export function PaymentsCalendarView({
  month,
  year,
  settings,
  calendarEvents,
  formatEUR,
  saveSetting,
  onNavigate,
  onGoToMonth,
  onShiftPeriod,
}: Props) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"month" | "year">("year");
  const [yearEvents, setYearEvents] = useState<CalendarEvent[]>([]);
  const [yearLoading, setYearLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const { link: icalLink, loading: icalLoading } = useIcalSubscribeLink(settings);

  useEffect(() => {
    if (viewMode !== "year") return;
    let cancelled = false;
    setYearLoading(true);
    api.getCalendarPagosYear(year)
      .then((rows) => { if (!cancelled) setYearEvents(rows); })
      .catch(() => { if (!cancelled) setYearEvents([]); })
      .finally(() => { if (!cancelled) setYearLoading(false); });
    return () => { cancelled = true; };
  }, [viewMode, year]);

  useEffect(() => {
    setSelectedDay(null);
  }, [month, year, viewMode]);

  const gridEvents = useMemo(
    () => calendarEvents.map((ev, i) => ({
      key: `ev-${ev.id ?? i}-${ev.fecha}`,
      fecha: ev.fecha,
      titulo: ev.titulo,
      monto: Number(ev.monto || 0),
      tipo: ev.tipo,
      seccion: ev.seccion,
    })),
    [calendarEvents],
  );

  const selectedDayEvents = useMemo(
    () => (selectedDay ? gridEvents.filter((ev) => ev.fecha.slice(0, 10) === selectedDay) : []),
    [gridEvents, selectedDay],
  );

  const eventsByMonth = useMemo(() => {
    const map: Record<number, CalendarGridEvent[]> = {};
    const source = viewMode === "year" ? yearEvents : calendarEvents;
    source.forEach((ev, i) => {
      const m = Number(ev.fecha.slice(5, 7));
      if (!map[m]) map[m] = [];
      map[m]!.push({
        key: `ev-${ev.id ?? i}-${ev.fecha}`,
        fecha: ev.fecha,
        titulo: ev.titulo,
        monto: Number(ev.monto || 0),
        tipo: ev.tipo,
        seccion: ev.seccion,
      });
    });
    return map;
  }, [viewMode, yearEvents, calendarEvents]);

  const yearOptions = useMemo(() => {
    const now = new Date().getFullYear();
    return Array.from({ length: 41 }, (_, i) => now - 20 + i);
  }, []);

  const activeEvents = viewMode === "year" ? yearEvents : calendarEvents;
  const isCurrentPeriod =
    viewMode === "year"
      ? year === new Date().getFullYear()
      : month === new Date().getMonth() + 1 && year === new Date().getFullYear();

  return (
    <div className="cal-root">
      <div className="cal-header">
        <div className="cal-header__period-wrap">
          <div className="content-toolbar__period cal-header__period" role="group" aria-label="Período del calendario">
            {onShiftPeriod && (
              <button
                type="button"
                className="button-secondary"
                style={{ padding: "0.25rem 0.5rem", fontWeight: 600, fontSize: "1rem", lineHeight: 1 }}
                onClick={() => onShiftPeriod(viewMode === "year" ? -12 : -1)}
                aria-label={viewMode === "year" ? "Año anterior" : "Mes anterior"}
              >
                ‹
              </button>
            )}
            {viewMode === "month" && (
              <select
                className="period-select"
                value={month}
                onChange={(e) => onGoToMonth?.(Number(e.target.value), year)}
                aria-label="Seleccionar mes"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Intl.DateTimeFormat("es", { month: "long" }).format(new Date(2000, i))}
                  </option>
                ))}
              </select>
            )}
            <select
              className="period-select"
              value={year}
              onChange={(e) => onGoToMonth?.(month, Number(e.target.value))}
              aria-label="Seleccionar año"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {!isCurrentPeriod && onGoToMonth && (
              <button
                type="button"
                className="button-secondary"
                style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
                onClick={() => {
                  const n = new Date();
                  onGoToMonth(n.getMonth() + 1, n.getFullYear());
                }}
                aria-label="Volver al período actual"
              >
                Hoy
              </button>
            )}
            {onShiftPeriod && (
              <button
                type="button"
                className="button-secondary"
                style={{ padding: "0.25rem 0.5rem", fontWeight: 600, fontSize: "1rem", lineHeight: 1 }}
                onClick={() => onShiftPeriod(viewMode === "year" ? 12 : 1)}
                aria-label={viewMode === "year" ? "Año siguiente" : "Mes siguiente"}
              >
                ›
              </button>
            )}
          </div>
          {viewMode === "month" && (
            <PeriodViewToggle
              mode={viewMode}
              onChange={setViewMode}
              yearLabel="Vista anual"
              hideMonthButton
            />
          )}
        </div>
        <div className="cal-header__actions">
          {icalLink ? (
            <a
              className="cal-ical-btn"
              href={icalLink.href}
              {...(icalLink.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              title="Suscribirse al calendario en iCal / Apple Calendar"
            >
              📅 Suscribir iCal
            </a>
          ) : (
            <button type="button" className="cal-ical-btn" disabled={icalLoading} title="Preparando enlace de suscripción">
              {icalLoading ? "Preparando…" : "iCal no disponible"}
            </button>
          )}
          <button
            type="button"
            className={`cal-nav-btn${optionsOpen ? " is-active" : ""}`}
            onClick={() => setOptionsOpen((o) => !o)}
            title="Opciones del calendario"
            aria-expanded={optionsOpen}
          >
            ⚙️
          </button>
        </div>
      </div>

      {optionsOpen && (
        <article className="card" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginTop: 0, fontSize: "1rem" }}>Opciones del calendario</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "0.75rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.ical_include_subs !== "0"}
                onChange={(e) => void saveSetting("ical_include_subs", e.target.checked ? "1" : "0", true)}
              />
              Incluir suscripciones en iCal
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.ical_include_income !== "0"}
                onChange={(e) => void saveSetting("ical_include_income", e.target.checked ? "1" : "0", true)}
              />
              Incluir ingresos en iCal
            </label>
          </div>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem" }}>
              Día nómina en calendario
              <input
                type="number"
                min={1}
                max={28}
                key={`inc-${settings.recurring_income_day}`}
                defaultValue={Number(settings.recurring_income_day || "1")}
                onBlur={(e) => void saveSetting("recurring_income_day", String(Number(e.target.value) || 1))}
                style={{ width: "4rem" }}
              />
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem" }}>
              Fecha cobro nómina
              <button
                type="button"
                className="button-secondary"
                style={{ fontSize: "0.8rem" }}
                onClick={() => void saveSetting(
                  "recurring_income_mode",
                  settings.recurring_income_mode === "penultimate" ? "fixed" : "penultimate",
                  true,
                )}
              >
                {settings.recurring_income_mode === "penultimate" ? "Penúltimo hábil" : "Día fijo"}
              </button>
            </div>
          </div>
          <ICalSection settings={settings} />
        </article>
      )}

      {activeEvents.length === 0 && !yearLoading ? (
        <EmptyState
          icon="📅"
          title="Sin pagos programados"
          description={viewMode === "year"
            ? "No hay ingresos, suscripciones ni cuotas de deuda programados en este año."
            : "Configura ingresos recurrentes, suscripciones o deudas para ver el calendario de pagos."}
          actionLabel="Ir a Presupuesto"
          onAction={() => onNavigate("Presupuesto")}
        />
      ) : null}

      {viewMode === "year" ? (
        yearLoading ? (
          <article className="card"><p className="muted">Cargando calendario {year}…</p></article>
        ) : (
          <YearCalendarGrid
            year={year}
            eventsByMonth={eventsByMonth}
            formatEUR={formatEUR}
            currentMonth={month}
            onSelectMonth={(m) => {
              setViewMode("month");
              onGoToMonth?.(m, year);
            }}
          />
        )
      ) : (
        <>
          <MonthCalendarGrid
            month={month}
            year={year}
            events={gridEvents}
            formatEUR={formatEUR}
            selectedDay={selectedDay}
            onDayClick={(ds) => setSelectedDay((prev) => (prev === ds ? null : ds))}
          />
          {selectedDay && (
            <div className="cal-day-panel" role="region" aria-label="Detalle del día">
              <div className="cal-day-panel__head">
                <h3>
                  {new Date(`${selectedDay}T12:00:00`).toLocaleDateString("es-ES", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </h3>
                <button
                  type="button"
                  className="button-secondary"
                  style={{ fontSize: "0.75rem", padding: "0.2rem 0.45rem", flexShrink: 0 }}
                  onClick={() => setSelectedDay(null)}
                >
                  Cerrar
                </button>
              </div>
              {selectedDayEvents.length === 0 ? (
                <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>Sin pagos este día.</p>
              ) : (
                <ul className="cal-day-panel__list">
                  {selectedDayEvents.map((ev) => (
                    <li key={ev.key} className={`cal-day-panel__item`}>
                      <div className="cal-day-panel__item-main">
                        <span className="cal-day-panel__item-title">{ev.titulo}</span>
                        {(ev.seccion || ev.tipo) && (
                          <span className="cal-day-panel__item-meta muted">
                            {[ev.seccion, ev.tipo].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </div>
                      <strong className="cal-day-panel__item-amount sensitive">{formatEUR(ev.monto)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      <div className="cal-legend">
        {CAL_LEGEND_ITEMS.map(({ className, label }) => (
          <span key={label} className="cal-legend-item">
            <span className={`cal-legend-dot ${className}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
