import { useMemo, useState, type ReactNode } from "react";
import type { AnnualBudgetLineGroup, AnnualBudgetLineItem, AnnualBudgetSummary, AnnualNameTotal } from "../../utils/annualBudget";
import { ANNUAL_BUDGET_LINE_GROUP_LABELS, sumAnnualLinesByName } from "../../utils/annualBudget";

type Props = {
  year: number;
  yearOptions: number[];
  summary: AnnualBudgetSummary;
  formatEUR: (v: number) => string;
  onSelectMonth: (month: number) => void;
  onYearChange: (year: number) => void;
  onAdjustYear: (delta: number) => void;
};

const LINE_GROUP_ORDER: AnnualBudgetLineGroup[] = ["income", "fondos", "puntual", "subs", "debt", "ahorro"];

type TotalsTone = "income" | "fondos" | "puntual" | "subs" | "debt" | "ahorro" | "gastos";

type TotalsSubRow = {
  label: string;
  amount: number;
  items: AnnualNameTotal[];
  tone: TotalsTone;
};

function groupAmountClass(group: AnnualBudgetLineGroup): string {
  return `budget-annual-table__tone--${group}`;
}

function NameBreakdownList({
  items,
  formatEUR,
}: {
  items: AnnualNameTotal[];
  formatEUR: (v: number) => string;
}) {
  if (items.length === 0) {
    return <p className="muted budget-annual__tip-empty">Sin partidas</p>;
  }
  return (
    <ul className="budget-annual__tip-list">
      {items.map((item) => (
        <li key={item.label}>
          <span>{item.label}</span>
          <strong className="sensitive">{formatEUR(item.amount)}</strong>
        </li>
      ))}
    </ul>
  );
}

function HoverTotal({
  label,
  amount,
  items,
  formatEUR,
  tone,
}: {
  label: string;
  amount: number;
  items: AnnualNameTotal[];
  formatEUR: (v: number) => string;
  tone?: TotalsTone;
}) {
  return (
    <div className={`budget-annual__hover-total${tone ? ` budget-annual__tone--${tone}` : ""}`} tabIndex={0}>
      <span className="muted">{label}</span>
      <strong className="sensitive">{formatEUR(amount)}</strong>
      <div className="budget-annual__tip" role="tooltip">
        <p className="budget-annual__tip-title">{label}</p>
        <NameBreakdownList items={items} formatEUR={formatEUR} />
      </div>
    </div>
  );
}

function AnnualTotalsBreakdown({
  label,
  amount,
  items,
  formatEUR,
  tone,
  formatAmount,
  subRows,
  borderTone,
}: {
  label: string;
  amount: number;
  items: AnnualNameTotal[];
  formatEUR: (v: number) => string;
  tone: TotalsTone;
  formatAmount?: (v: number) => string;
  subRows?: TotalsSubRow[];
  /** Left border accent; defaults to `tone`. */
  borderTone?: TotalsTone;
}) {
  const [open, setOpen] = useState(false);
  const displayAmount = formatAmount ?? formatEUR;
  const accent = borderTone ?? tone;
  const visibleSubs = (subRows ?? []).filter((row) => row.amount > 0);

  return (
    <div
      className={`budget-annual__totals-breakdown budget-annual__totals-breakdown--${accent}${open ? " budget-annual__totals-breakdown--open" : ""}`}
    >
      <button
        type="button"
        className={`budget-annual__breakdown-toggle budget-annual__tone--${tone}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="budget-annual__breakdown-toggle-label">
          <span className="budget-annual__breakdown-chevron" aria-hidden>{open ? "▾" : "▸"}</span>
          <span className="muted">{label}</span>
        </span>
        <strong className="sensitive">{displayAmount(amount)}</strong>
      </button>
      {open && (
        <div className="budget-annual__breakdown-panel">
          {visibleSubs.length > 0 && (
            <div className={`budget-annual__totals-sub budget-annual__totals-sub--${accent}`}>
              {visibleSubs.map((row) => (
                <HoverTotal
                  key={row.label}
                  label={row.label}
                  amount={row.amount}
                  items={row.items}
                  formatEUR={formatEUR}
                  tone={row.tone}
                />
              ))}
            </div>
          )}
          <div className="budget-annual__breakdown-by-name">
            <p className="budget-annual__tip-title">Por partida (año)</p>
            <NameBreakdownList items={items} formatEUR={formatEUR} />
          </div>
        </div>
      )}
    </div>
  );
}

function groupLines(lines: AnnualBudgetLineItem[]): { group: AnnualBudgetLineGroup; items: AnnualBudgetLineItem[] }[] {
  const grouped = new Map<AnnualBudgetLineGroup, AnnualBudgetLineItem[]>();
  for (const line of lines) {
    const bucket = grouped.get(line.group) ?? [];
    bucket.push(line);
    grouped.set(line.group, bucket);
  }
  return LINE_GROUP_ORDER
    .filter((group) => (grouped.get(group)?.length ?? 0) > 0)
    .map((group) => ({ group, items: grouped.get(group)! }));
}

function MonthDetail({ lines, formatEUR }: { lines: AnnualBudgetLineItem[]; formatEUR: (v: number) => string }) {
  const groups = groupLines(lines);
  if (groups.length === 0) {
    return <p className="muted budget-annual-table__detail-empty">Sin partidas este mes.</p>;
  }

  return (
    <div className="budget-annual-table__detail">
      {groups.map(({ group, items }) => {
        const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
        return (
          <div
            key={group}
            className={`budget-annual-table__detail-group budget-annual-table__detail-group--${group}`}
          >
            <div className="budget-annual-table__detail-group-head">
              <span className="budget-annual-table__detail-group-label">
                {ANNUAL_BUDGET_LINE_GROUP_LABELS[group]}
              </span>
              <strong className={`sensitive budget-annual-table__detail-group-total ${groupAmountClass(group)}`}>
                {formatEUR(subtotal)}
              </strong>
            </div>
            <ul className="budget-annual-table__detail-list">
              {items.map((item) => (
                <li key={item.key} className="budget-annual-table__detail-item">
                  <span className="budget-annual-table__detail-item-label">{item.label}</span>
                  <span className="budget-annual-table__detail-item-dots" aria-hidden />
                  <strong className={`sensitive budget-annual-table__detail-item-amount ${groupAmountClass(group)}`}>
                    {formatEUR(item.amount)}
                  </strong>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function AmountCell({
  value,
  className = "",
  formatEUR,
  empty = "—",
}: {
  value: number;
  className?: string;
  formatEUR: (v: number) => string;
  empty?: string;
}) {
  return (
    <span className={`budget-annual-table__col budget-annual-table__col--num budget-annual-table__amount sensitive${className ? ` ${className}` : ""}`} role="cell">
      {value > 0 ? formatEUR(value) : empty}
    </span>
  );
}

function ColHead({
  children,
  tone,
  title,
}: {
  children: ReactNode;
  tone: "income" | "fondos" | "puntual" | "subs" | "debt" | "ahorro";
  title?: string;
}) {
  return (
    <span
      className={`budget-annual-table__col budget-annual-table__col--num budget-annual-table__tone--${tone}`}
      role="columnheader"
      title={title}
    >
      {children}
    </span>
  );
}

export function BudgetAnnualGrid({
  year,
  yearOptions,
  summary,
  formatEUR,
  onSelectMonth,
  onYearChange,
  onAdjustYear,
}: Props) {
  const maxBar = Math.max(...summary.months.map((m) => m.income), 1);
  const { totals } = summary;
  const [expandedMonths, setExpandedMonths] = useState<Set<number>>(() => new Set());
  const currentYear = new Date().getFullYear();

  const incomeItems = useMemo(
    () => sumAnnualLinesByName(summary.months, ["income"]),
    [summary.months],
  );
  const fondosItems = useMemo(
    () => sumAnnualLinesByName(summary.months, ["fondos"]),
    [summary.months],
  );
  const puntualItems = useMemo(
    () => sumAnnualLinesByName(summary.months, ["puntual"]),
    [summary.months],
  );
  const subsItems = useMemo(
    () => sumAnnualLinesByName(summary.months, ["subs"]),
    [summary.months],
  );
  const totalGastosItems = useMemo(
    () => sumAnnualLinesByName(summary.months, ["fondos", "puntual", "subs"]),
    [summary.months],
  );
  const debtItems = useMemo(
    () => sumAnnualLinesByName(summary.months, ["debt"]),
    [summary.months],
  );
  const ahorroItems = useMemo(
    () => sumAnnualLinesByName(summary.months, ["ahorro"]),
    [summary.months],
  );

  const allExpanded = expandedMonths.size === summary.months.length;

  const toggleMonth = (month: number) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  };

  const toggleAllMonths = () => {
    setExpandedMonths(allExpanded ? new Set() : new Set(summary.months.map((m) => m.month)));
  };

  const toggleAllLabel = allExpanded ? "Ocultar todos los meses" : "Desplegar todos los meses";

  return (
    <article className="card budget-annual">
      <div className="budget-annual__head">
        <div className="budget-annual__head-row">
          <h2 style={{ margin: 0 }}>Presupuesto {year}</h2>
          <div className="budget-annual__period" role="group" aria-label="Seleccionar año">
            <button
              type="button"
              className="button-secondary budget-annual__period-nav"
              onClick={() => onAdjustYear(-1)}
              aria-label="Año anterior"
              disabled={year <= yearOptions[0]}
            >
              ‹
            </button>
            <select
              className="period-select budget-annual__year-select"
              value={year}
              onChange={(e) => onYearChange(Number(e.target.value))}
              aria-label="Seleccionar año"
              size={1}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {year !== currentYear && (
              <button
                type="button"
                className="button-secondary"
                style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
                onClick={() => onYearChange(currentYear)}
                aria-label="Volver al año actual"
              >
                Hoy
              </button>
            )}
            <button
              type="button"
              className="button-secondary budget-annual__period-nav"
              onClick={() => onAdjustYear(1)}
              aria-label="Año siguiente"
              disabled={year >= yearOptions[yearOptions.length - 1]}
            >
              ›
            </button>
          </div>
        </div>
      </div>

      <div className="budget-annual__totals">
        <AnnualTotalsBreakdown
          label="Ingresos"
          amount={totals.income}
          items={incomeItems}
          formatEUR={formatEUR}
          tone="income"
        />
        <AnnualTotalsBreakdown
          label="Gastos asignados"
          amount={totals.consumption}
          items={totalGastosItems}
          formatEUR={formatEUR}
          tone="gastos"
          subRows={[
            { label: "Fondos", amount: totals.fondos, items: fondosItems, tone: "fondos" },
            { label: "Gastos planificados", amount: totals.puntual, items: puntualItems, tone: "puntual" },
            { label: "Suscripciones y facturas", amount: totals.subs, items: subsItems, tone: "subs" },
          ]}
        />
        <AnnualTotalsBreakdown
          label="Deudas"
          amount={totals.debt}
          items={debtItems}
          formatEUR={formatEUR}
          tone="debt"
        />
        <AnnualTotalsBreakdown
          label="Ahorro e inversión"
          amount={totals.savings}
          items={ahorroItems}
          formatEUR={formatEUR}
          tone="ahorro"
          formatAmount={(v) => `${v >= 0 ? "+" : ""}${formatEUR(v)}`}
        />
      </div>

      <div className="budget-annual-table" role="table" aria-label={`Presupuesto anual ${year}`}>
        <div className="budget-annual-table__toolbar">
          <button
            type="button"
            className="button-secondary budget-annual-table__toggle-all"
            onClick={toggleAllMonths}
            aria-expanded={allExpanded}
          >
            {toggleAllLabel}
          </button>
        </div>
        <div className="budget-annual-table__scroll">
        <div className="budget-annual-table__head" role="row">
          <span className="budget-annual-table__col budget-annual-table__col--mes" role="columnheader">Mes</span>
          <ColHead tone="income">Ingresos</ColHead>
          <ColHead tone="fondos">Fondos</ColHead>
          <ColHead tone="puntual" title="Gastos planificados">Planificados</ColHead>
          <ColHead tone="subs" title="Suscripciones y facturas">Suscripciones</ColHead>
          <ColHead tone="debt">Deudas</ColHead>
          <ColHead tone="ahorro">Ahorro</ColHead>
        </div>
        {summary.months.map((row) => {
          const open = expandedMonths.has(row.month);
          return (
            <div
              key={row.month}
              className={`budget-annual-table__block${row.isCurrent ? " budget-annual-table__block--current" : ""}${open ? " budget-annual-table__block--open" : ""}`}
            >
              <div
                className="budget-annual-table__row"
                role="row"
              >
                <span className="budget-annual-table__col budget-annual-table__col--mes" role="cell">
                  <span className="budget-annual-table__month">
                  <button
                    type="button"
                    className="budget-annual-table__chevron"
                    onClick={() => toggleMonth(row.month)}
                    aria-expanded={open}
                    aria-label={`${open ? "Ocultar" : "Desplegar"} partidas de ${row.label}`}
                  >
                    {open ? "▾" : "▸"}
                  </button>
                  <button
                    type="button"
                    className="budget-annual-table__month-btn"
                    onClick={() => toggleMonth(row.month)}
                    aria-expanded={open}
                  >
                    {row.label}
                  </button>
                  <span
                    className="budget-annual-table__bar"
                    style={{ width: `${Math.max(4, (row.income / maxBar) * 100)}%` }}
                    aria-hidden
                  />
                  <button
                    type="button"
                    className="budget-annual-table__edit"
                    onClick={() => onSelectMonth(row.month)}
                    aria-label={`Editar presupuesto de ${row.label} ${year}`}
                    title={`Editar presupuesto de ${row.label} ${year}`}
                  >
                    ✎
                  </button>
                  </span>
                </span>
                <AmountCell value={row.income} className="budget-annual-table__tone--income" formatEUR={formatEUR} />
                <AmountCell value={row.fondos} className="budget-annual-table__tone--fondos" formatEUR={formatEUR} />
                <AmountCell value={row.puntual} className="budget-annual-table__tone--puntual" formatEUR={formatEUR} />
                <AmountCell value={row.subs} className="budget-annual-table__tone--subs" formatEUR={formatEUR} />
                <AmountCell value={row.debt} className="budget-annual-table__tone--debt" formatEUR={formatEUR} />
                <span
                  className={`budget-annual-table__col budget-annual-table__col--num budget-annual-table__amount sensitive budget-annual-table__tone--ahorro`}
                  role="cell"
                >
                  {row.savings >= 0 ? "+" : ""}{formatEUR(row.savings)}
                </span>
              </div>
              {open && <MonthDetail lines={row.lines} formatEUR={formatEUR} />}
            </div>
          );
        })}
        </div>
      </div>
    </article>
  );
}
