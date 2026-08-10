import type { MenuKey } from "../config/ui";

export type CategoryDeviation = {
  cat: string;
  spent: number;
  planned: number;
  delta: number;
};

export type NarrativeDecision = {
  text: string;
  ctaLabel: string;
  /** Menu to navigate, or "copy_budget" for the existing copy action */
  action: MenuKey | "copy_budget";
};

export type MonthlyCloseNarrative = {
  wins: string[];
  misses: string[];
  decisions: NarrativeDecision[];
};

export type MonthlyCloseNarrativeInput = {
  realIncome: number;
  realExpense: number;
  realSavings: number;
  savingsRate: number | null;
  targetSavingsPct: number;
  uncategorized: number;
  deviations: CategoryDeviation[];
  prevNetWorth: number | null;
  netWorth: number;
  recurringMatched: number;
  recurringTotal: number;
  formatEUR: (v: number) => string;
};

function pushUnique(list: string[], item: string, max: number) {
  if (list.length >= max) return;
  if (!list.includes(item)) list.push(item);
}

/**
 * Builds a 3/3/3 executive narrative for monthly close from already-computed KPIs.
 */
export function buildMonthlyCloseNarrative(input: MonthlyCloseNarrativeInput): MonthlyCloseNarrative {
  const {
    realIncome,
    realSavings,
    savingsRate,
    targetSavingsPct,
    uncategorized,
    deviations,
    prevNetWorth,
    netWorth,
    recurringMatched,
    recurringTotal,
    formatEUR,
  } = input;

  const wins: string[] = [];
  const misses: string[] = [];
  const decisions: NarrativeDecision[] = [];

  const underPlan = deviations.filter((d) => d.planned > 0 && d.delta <= 0);
  const overPlan = deviations
    .filter((d) => d.planned > 0 && d.delta > 0)
    .sort((a, b) => b.delta - a.delta);
  const worst = overPlan[0] ?? null;

  // --- Wins ---
  if (savingsRate !== null && savingsRate >= targetSavingsPct) {
    pushUnique(wins, `Tasa de ahorro ${savingsRate.toFixed(1)}% ≥ objetivo ${targetSavingsPct}%`, 3);
  }
  if (uncategorized === 0) {
    pushUnique(wins, "Todos los movimientos del mes están categorizados", 3);
  }
  if (underPlan.length > 0) {
    const names = underPlan.slice(0, 2).map((d) => d.cat).join(", ");
    pushUnique(
      wins,
      underPlan.length === 1
        ? `Categoría bajo plan: ${names}`
        : `${underPlan.length} categorías bajo o en plan (${names}${underPlan.length > 2 ? "…" : ""})`,
      3
    );
  }
  if (prevNetWorth !== null && netWorth > prevNetWorth) {
    pushUnique(wins, `Patrimonio neto subió ${formatEUR(netWorth - prevNetWorth)} vs mes anterior`, 3);
  }
  if (recurringTotal > 0 && recurringMatched === recurringTotal) {
    pushUnique(wins, `Todos los gastos recurrentes encontrados (${recurringMatched}/${recurringTotal})`, 3);
  } else if (recurringTotal > 0 && recurringMatched > 0 && recurringMatched / recurringTotal >= 0.7) {
    pushUnique(wins, `Mayoría de recurrentes localizados (${recurringMatched}/${recurringTotal})`, 3);
  }
  if (realSavings > 0 && wins.length < 3) {
    pushUnique(wins, `Ahorro real positivo: ${formatEUR(realSavings)}`, 3);
  }
  if (realIncome > 0 && wins.length < 3) {
    pushUnique(wins, `Ingresos reales del mes: ${formatEUR(realIncome)}`, 3);
  }
  for (const filler of [
    "Mes registrado: revisa el checklist para consolidar el cierre",
    "Sin más aciertos detectados automáticamente",
    "Mantén el hábito de cierre mensual",
  ]) {
    if (wins.length >= 3) break;
    pushUnique(wins, filler, 3);
  }

  // --- Misses (mix: top overspend + structural issues) ---
  if (overPlan[0]) {
    const d = overPlan[0];
    pushUnique(
      misses,
      `${d.cat}: +${formatEUR(d.delta)} sobre plan (${formatEUR(d.spent)} vs ${formatEUR(d.planned)})`,
      3
    );
  }
  if (savingsRate !== null && savingsRate < targetSavingsPct) {
    pushUnique(
      misses,
      `Tasa de ahorro ${savingsRate.toFixed(1)}% por debajo del objetivo ${targetSavingsPct}%`,
      3
    );
  }
  if (uncategorized > 0) {
    pushUnique(misses, `${uncategorized} movimiento${uncategorized !== 1 ? "s" : ""} sin categorizar`, 3);
  }
  if (overPlan[1]) {
    const d = overPlan[1];
    pushUnique(
      misses,
      `${d.cat}: +${formatEUR(d.delta)} sobre plan (${formatEUR(d.spent)} vs ${formatEUR(d.planned)})`,
      3
    );
  }
  if (recurringTotal > 0 && recurringMatched < recurringTotal) {
    const missing = recurringTotal - recurringMatched;
    pushUnique(
      misses,
      `${missing} gasto${missing !== 1 ? "s" : ""} recurrente${missing !== 1 ? "s" : ""} sin movimiento coincidente`,
      3
    );
  }
  if (prevNetWorth !== null && netWorth < prevNetWorth) {
    pushUnique(misses, `Patrimonio neto bajó ${formatEUR(prevNetWorth - netWorth)} vs mes anterior`, 3);
  }
  if (realSavings < 0) {
    pushUnique(misses, `Ahorro real negativo: ${formatEUR(realSavings)}`, 3);
  }
  for (const filler of [
    "Sin desviación crítica adicional detectada",
    "Mantén el ritmo: no hay más fallos automáticos",
    "Sin más desviaciones relevantes este mes",
  ]) {
    if (misses.length >= 3) break;
    pushUnique(misses, filler, 3);
  }

  // --- Decisions (max 3) ---
  if (worst) {
    decisions.push({
      text: `Recortar o reasignar en «${worst.cat}» (${formatEUR(worst.delta)} de exceso)`,
      ctaLabel: "Ajustar presupuesto",
      action: "Presupuesto",
    });
  }
  if (uncategorized > 0) {
    decisions.push({
      text: `Categorizar ${uncategorized} movimiento${uncategorized !== 1 ? "s" : ""} pendientes`,
      ctaLabel: "Ir a transacciones",
      action: "Transacciones",
    });
  }
  if (savingsRate !== null && savingsRate < targetSavingsPct) {
    decisions.push({
      text: `Subir el ahorro hacia el objetivo ≥ ${targetSavingsPct}%`,
      ctaLabel: "Revisar ahorro",
      action: "Presupuesto",
    });
  }
  if (realSavings < 0) {
    decisions.push({
      text: "Ahorro negativo: revisar cuotas y pasivos del mes siguiente",
      ctaLabel: "Ver pasivos",
      action: "Pasivos",
    });
  }
  if (decisions.length < 3) {
    decisions.push({
      text: "Copiar el presupuesto al mes siguiente como base de partida",
      ctaLabel: "Copiar presupuesto",
      action: "copy_budget",
    });
  }
  if (decisions.length < 3 && !worst) {
    decisions.push({
      text: "Revisar el presupuesto del próximo mes antes de gastar",
      ctaLabel: "Abrir presupuesto",
      action: "Presupuesto",
    });
  }
  if (decisions.length < 3) {
    decisions.push({
      text: "Repasar el calendario de pagos de las próximas semanas",
      ctaLabel: "Ver calendario",
      action: "Calendario de Pagos",
    });
  }

  return {
    wins: wins.slice(0, 3),
    misses: misses.slice(0, 3),
    decisions: decisions.slice(0, 3),
  };
}
