import { useMemo } from "react";
import { calendarEventClass } from "../../utils/statusColors";
import type { CalendarGridEvent } from "./MonthCalendarGrid";

type Props = {
  year: number;
  eventsByMonth: Record<number, CalendarGridEvent[]>;
  formatEUR: (v: number) => string;
  onSelectMonth: (month: number) => void;
  currentMonth?: number;
};

const MONTH_LABELS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

function isoDate(y: number, jsMonth: number, d: number) {
  return `${y}-${String(jsMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function eventTone(tipo: string): "ingreso" | "suscripcion" | "deuda" | "gasto" {
  const cls = calendarEventClass(tipo);
  if (cls.includes("ingreso")) return "ingreso";
  if (cls.includes("suscripcion")) return "suscripcion";
  if (cls.includes("deuda")) return "deuda";
  return "gasto";
}

function monthTotals(events: CalendarGridEvent[]) {
  let inflow = 0;
  let outflow = 0;
  for (const e of events) {
    const amount = Math.abs(Number(e.monto || 0));
    if (e.tipo === "ingreso" || eventTone(e.tipo) === "ingreso") inflow += amount;
    else outflow += amount;
  }
  return { inflow, outflow, net: inflow - outflow, count: events.length };
}

function MiniMonthHeatmap({
  month,
  year,
  events,
}: {
  month: number;
  year: number;
  events: CalendarGridEvent[];
}) {
  const jsMonth = month - 1;
  const firstDow = new Date(year, jsMonth, 1).getDay();
  const offset = firstDow === 0 ? 6 : firstDow - 1;
  const daysInMonth = new Date(year, jsMonth + 1, 0).getDate();
  const today = new Date();
  const todayStr = isoDate(today.getFullYear(), today.getMonth(), today.getDate());

  const byDay = new Map<string, CalendarGridEvent[]>();
  for (const ev of events) {
    const ds = ev.fecha.slice(0, 10);
    if (!byDay.has(ds)) byDay.set(ds, []);
    byDay.get(ds)!.push(ev);
  }

  return (
    <div className="cal-year-mini" aria-hidden>
      {WEEKDAYS.map((d) => (
        <span key={d} className="cal-year-mini__wd">{d}</span>
      ))}
      {Array.from({ length: offset }, (_, i) => (
        <span key={`e${i}`} className="cal-year-mini__cell cal-year-mini__cell--empty" />
      ))}
      {Array.from({ length: daysInMonth }, (_, i) => {
        const day = i + 1;
        const ds = isoDate(year, jsMonth, day);
        const dayEvents = byDay.get(ds) ?? [];
        const tones = Array.from(new Set(dayEvents.map((e) => eventTone(e.tipo)))).slice(0, 3);
        const isToday = ds === todayStr;
        return (
          <span
            key={day}
            className={[
              "cal-year-mini__cell",
              dayEvents.length ? "cal-year-mini__cell--busy" : "",
              isToday ? "cal-year-mini__cell--today" : "",
            ].filter(Boolean).join(" ")}
            title={dayEvents.length
              ? dayEvents.map((e) => e.titulo).join(" · ")
              : undefined}
          >
            <span className="cal-year-mini__num">{day}</span>
            {tones.length > 0 && (
              <span className="cal-year-mini__dots">
                {tones.map((tone) => (
                  <span key={tone} className={`cal-year-mini__dot cal-year-mini__dot--${tone}`} />
                ))}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function YearCalendarGrid({
  year,
  eventsByMonth,
  formatEUR,
  onSelectMonth,
  currentMonth = new Date().getMonth() + 1,
}: Props) {
  const months = useMemo(() => (
    Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const events = eventsByMonth[m] ?? [];
      return { m, events, totals: monthTotals(events) };
    })
  ), [eventsByMonth]);

  const yearTotals = useMemo(() => {
    return months.reduce(
      (acc, row) => ({
        inflow: acc.inflow + row.totals.inflow,
        outflow: acc.outflow + row.totals.outflow,
        count: acc.count + row.totals.count,
      }),
      { inflow: 0, outflow: 0, count: 0 },
    );
  }, [months]);

  return (
    <div className="cal-year">
      <div className="cal-year-summary" aria-label={`Resumen ${year}`}>
        <div>
          <span className="muted">Eventos</span>
          <strong>{yearTotals.count}</strong>
        </div>
        <div>
          <span className="muted">Ingresos</span>
          <strong className="sensitive positive">{formatEUR(yearTotals.inflow)}</strong>
        </div>
        <div>
          <span className="muted">Salidas</span>
          <strong className="sensitive negative">{formatEUR(yearTotals.outflow)}</strong>
        </div>
        <div>
          <span className="muted">Neto</span>
          <strong className={`sensitive ${yearTotals.inflow - yearTotals.outflow >= 0 ? "positive" : "negative"}`}>
            {formatEUR(yearTotals.inflow - yearTotals.outflow)}
          </strong>
        </div>
      </div>

      <div className="cal-year-grid">
        {months.map(({ m, events, totals }) => (
          <button
            key={m}
            type="button"
            className={`cal-year-month${m === currentMonth ? " cal-year-month--current" : ""}`}
            onClick={() => onSelectMonth(m)}
            title={`Ver ${MONTH_LABELS[m - 1]} ${year} en detalle`}
            aria-label={`${MONTH_LABELS[m - 1]} ${year}: ${totals.count} eventos, salidas ${formatEUR(totals.outflow)}, neto ${formatEUR(totals.net)}`}
          >
            <header className="cal-year-month__head">
              <span className="cal-year-month__name">{MONTH_LABELS[m - 1]}</span>
              <span className="cal-year-month__figures">
                {totals.count > 0 && totals.outflow > 0 && (
                  <span className="cal-year-month__outflow sensitive negative">
                    {formatEUR(-totals.outflow)}
                  </span>
                )}
                <span className={`cal-year-month__net sensitive ${totals.net >= 0 ? "positive" : "negative"}`}>
                  {totals.count === 0 ? "—" : formatEUR(totals.net)}
                </span>
              </span>
            </header>

            <MiniMonthHeatmap month={m} year={year} events={events} />
          </button>
        ))}
      </div>
    </div>
  );
}
