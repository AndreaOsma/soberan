import { useMemo, useState } from "react";

/** Selected month (1-12) / year for the whole app, plus its own navigation helpers. */
export function useCalendarPeriod() {
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());

  const currentCalendarYear = new Date().getFullYear();
  const yearSelectOptions = useMemo(
    () => Array.from({ length: 41 }, (_, i) => currentCalendarYear - 20 + i),
    [currentCalendarYear],
  );

  function adjustMonth(offset: number) {
    const base = new Date(year, month - 1, 1);
    base.setMonth(base.getMonth() + offset);
    setMonth(base.getMonth() + 1);
    setYear(base.getFullYear());
  }

  function adjustYear(offset: number) {
    const min = currentCalendarYear - 20;
    const max = currentCalendarYear + 20;
    setYear((y) => Math.min(max, Math.max(min, y + offset)));
  }

  return { month, setMonth, year, setYear, adjustMonth, adjustYear, yearSelectOptions };
}
