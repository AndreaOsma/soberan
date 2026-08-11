import { calendarEventClass } from "../../utils/statusColors";

export type CalendarGridEvent = {
  fecha: string;
  titulo: string;
  monto: number;
  tipo: string;
  seccion?: string | null;
  key?: string;
  chipClass?: string;
  muted?: boolean;
};

type Props = {
  month: number;
  year: number;
  events: CalendarGridEvent[];
  formatEUR: (v: number) => string;
  onDayClick?: (dateStr: string, dayEvents: CalendarGridEvent[]) => void;
  selectedDay?: string | null;
  compact?: boolean;
};

function isoDate(y: number, jsMonth: number, d: number) {
  return `${y}-${String(jsMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function MonthCalendarGrid({
  month,
  year,
  events,
  formatEUR,
  onDayClick,
  selectedDay = null,
  compact = false,
}: Props) {
  const today = new Date();
  const jsMonth = month - 1;
  const firstDow = new Date(year, jsMonth, 1).getDay();
  const offset = firstDow === 0 ? 6 : firstDow - 1;
  const daysInMonth = new Date(year, jsMonth + 1, 0).getDate();
  const todayStr = isoDate(today.getFullYear(), today.getMonth(), today.getDate());
  const weekdays = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];

  const byDay = new Map<string, CalendarGridEvent[]>();
  for (const ev of events) {
    const ds = ev.fecha.slice(0, 10);
    if (!byDay.has(ds)) byDay.set(ds, []);
    byDay.get(ds)!.push(ev);
  }

  return (
    <div className={`cal-grid-scroll${compact ? " cal-grid-scroll--compact" : ""}`}>
      <div className={`cal-grid${compact ? " cal-grid--compact" : ""}`}>
        {weekdays.map((d) => (
          <div key={d} className="cal-weekday">{d}</div>
        ))}
        {Array(offset).fill(0).map((_, i) => (
          <div key={`e${i}`} className="cal-day cal-day--empty" />
        ))}
        {Array(daysInMonth).fill(0).map((_, i) => {
          const day = i + 1;
          const ds = isoDate(year, jsMonth, day);
          const dow = new Date(year, jsMonth, day).getDay(); // 0=Sun..6=Sat
          const isWeekend = dow === 0 || dow === 6;
          const devents = byDay.get(ds) ?? [];
          const isToday = ds === todayStr;
          const isSelected = selectedDay === ds;
          const maxVisible = compact ? 1 : 3;
          const visible = devents.slice(0, maxVisible);
          const hidden = devents.length - visible.length;
          const clickable = Boolean(onDayClick);
          return (
            <div
              key={day}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              className={`cal-day${compact ? " cal-day--compact" : ""}${isToday ? " cal-day--today" : ""}${isWeekend ? " cal-day--weekend" : ""}${devents.length ? " cal-day--has-events" : ""}${isSelected ? " cal-day--selected" : ""}${clickable ? " cal-day--clickable" : ""}`}
              onClick={clickable ? () => onDayClick!(ds, devents) : undefined}
              onKeyDown={clickable ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onDayClick!(ds, devents);
                }
              } : undefined}
              aria-label={clickable ? `${day} de ${month}/${year}${devents.length ? `, ${devents.length} cuotas` : ""}` : undefined}
            >
              <div className="cal-day-num">{day}</div>
              <div className="cal-day-events">
                {visible.map((ev, j) => (
                  <div
                    key={ev.key ?? `${ds}-${j}`}
                    className={`cal-event-chip ${ev.chipClass ?? calendarEventClass(ev.tipo)}${ev.muted ? " cal-event-chip--muted" : ""}`}
                    title={`${ev.seccion ? `[${ev.seccion}] ` : ""}${ev.titulo} · ${formatEUR(Number(ev.monto || 0))}`}
                  >
                    {ev.seccion && (
                      <span style={{ fontSize: "0.62rem", fontWeight: 600, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.03em", lineHeight: 1 }}>
                        {ev.seccion}
                      </span>
                    )}
                    <span className="cal-event-chip__title">{ev.titulo}</span>
                    <span className="cal-event-chip__amount sensitive">{formatEUR(Number(ev.monto || 0))}</span>
                  </div>
                ))}
                {hidden > 0 && (
                  <button
                    type="button"
                    className="cal-day-more"
                    title="Ver todas las cuotas"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDayClick!(ds, devents);
                    }}
                  >
                    +{hidden}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
