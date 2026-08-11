import { useMemo } from "react";
import type { AlertItem, CalendarEvent, Goal, Account } from "../../types";
import type { NextDebtPayment } from "../../utils/debtInstallments";
import { EmptyState } from "../../components/EmptyState";
import { healthLightColor } from "../../utils/statusColors";
import type { EmergencyFundSnapshot, FinancialTrafficLight } from "../../utils/emergencyFund";
import { isCurrentCalendarMonth, monthElapsedPercent, trafficLightCriteriaText } from "../../utils/emergencyFund";
import { buildNetWorthProjections, type BudgetScheduleInput } from "../../utils/budgetTotals";
import type { MenuKey } from "../../config/ui";
import type { TotalsSnapshot, ActiveSalary } from "../../components/inicio/inicioTypes";
import { InicioStatusHeader } from "../../components/inicio/InicioStatusHeader";
import { InicioKpisSection } from "../../components/inicio/InicioKpisSection";
import { InicioAlertsPanel } from "../../components/inicio/InicioAlertsPanel";
import { InicioUpcomingPanel } from "../../components/inicio/InicioUpcomingPanel";
import { InicioProjectionsPanel } from "../../components/inicio/InicioProjectionsPanel";
import { InicioWealthPanels } from "../../components/inicio/InicioWealthPanels";
import { InicioPatrimonioChart } from "../../components/inicio/InicioPatrimonioChart";
import { InicioShortcuts } from "../../components/inicio/InicioShortcuts";
import { PayrollHintsBanner } from "../../components/data/PayrollHintsBanner";

export type InicioViewProps = {
  month: number;
  year: number;
  targetSavingsPct: number;
  projectionReturnPct?: number;
  totals: TotalsSnapshot;
  liquidity: number;
  light: FinancialTrafficLight;
  alerts: AlertItem[];
  investmentPnl: number;
  totalInvested: number;
  activeSalary: ActiveSalary;
  privacyMode: boolean;
  formatEUR: (v: number) => string;
  onNavigate: (key: MenuKey) => void;
  calendarEvents: CalendarEvent[];
  goals: Goal[];
  accounts: Account[];
  monthSpent: number;
  patrimonioEvolution: Array<{ fecha: string; acumulado: number }>;
  transactionCount: number;
  uiDensity: "minimal" | "detailed";
  nextDebtPayment?: NextDebtPayment | null;
  dtiPct?: number;
  emergencyFund: EmergencyFundSnapshot;
  saveSetting: (key: string, val: string, notify?: boolean) => Promise<void>;
  projectionBudget: BudgetScheduleInput;
  transactions?: import("../../types").Transaction[];
  loadAll?: (opts?: { silent?: boolean }) => Promise<void>;
  addToast?: (msg: string, type: "success" | "error" | "info") => void;
};

export function InicioView({
  month,
  year,
  targetSavingsPct,
  projectionReturnPct = 0,
  totals,
  liquidity,
  light,
  alerts,
  investmentPnl,
  totalInvested,
  activeSalary,
  privacyMode,
  formatEUR,
  onNavigate,
  calendarEvents,
  goals,
  accounts,
  monthSpent,
  patrimonioEvolution,
  transactionCount,
  uiDensity,
  nextDebtPayment = null,
  dtiPct = 0,
  emergencyFund,
  saveSetting,
  projectionBudget,
  transactions = [],
  loadAll,
  addToast,
}: InicioViewProps) {
  const savingsTargetRate = targetSavingsPct / 100;

  const projections = useMemo(
    () => buildNetWorthProjections({
      netWorthNow: totals.netWorth,
      cashNow: totals.totalCash,
      month,
      year,
      budgetSchedule: projectionBudget,
      options: {
        annualReturnPct: projectionReturnPct,
        investmentsNow: totals.totalInvestments,
      },
    }),
    [
      totals.netWorth,
      totals.totalCash,
      totals.totalInvestments,
      month,
      year,
      projectionBudget,
      projectionReturnPct,
    ],
  );

  const proj90Row = projections.find((p) => p.months === 3);
  const proj90 = proj90Row?.netWorth ?? totals.netWorth;
  const proj90Cash = proj90Row?.cash ?? totals.totalCash;
  const showLiquidityColumn =
    (totals.monthlyAhorroToCartera ?? 0) > 0
    || totals.totalInvestments > 0
    || projections.some((p) => Math.abs(p.cash - p.netWorth) > 0.01);

  const lightColor = healthLightColor(light);
  const highAlerts = alerts.filter((a) => a.severidad === "alta");
  const pnlPct = totalInvested > 0 ? (investmentPnl / totalInvested) * 100 : null;

  const savingsRate = totals.monthlyIncome > 0 ? totals.monthlySavings / totals.monthlyIncome : null;
  const { efMonths, targetMonths, warnMonths, profileLabel, avgNecesidades, currentDebt, essentialBurn, monthsWithNecesidadesData } = emergencyFund;

  const efValueText = efMonths !== null
    ? `${efMonths.toFixed(1)} meses (objetivo ${targetMonths} · perfil ${profileLabel})`
    : essentialBurn <= 0.01
      ? "Sin datos de gasto esencial"
      : "Sin datos de gastos";

  const efDetailText = essentialBurn > 0.01
    ? `Necesidades media 6m: ${formatEUR(avgNecesidades)}${monthsWithNecesidadesData > 0 ? ` (${monthsWithNecesidadesData} meses)` : ""} + deudas: ${formatEUR(currentDebt)}`
    : undefined;

  const statusReasons = [
    {
      label: "Fondo de emergencia",
      value: efValueText,
      detail: efDetailText,
      ok: efMonths === null || efMonths >= warnMonths,
    },
    {
      label: "Tasa de ahorro",
      value: savingsRate !== null ? `${(savingsRate * 100).toFixed(1)}% (objetivo ≥ ${targetSavingsPct}%)` : "Sin datos de ingresos",
      ok: savingsRate === null || savingsRate >= savingsTargetRate,
    },
    {
      label: "Proyección 90 días",
      value: `${formatEUR(proj90)} patrimonio`,
      detail: proj90Cash !== proj90 ? `Liquidez en cuentas: ${formatEUR(proj90Cash)}` : undefined,
      ok: proj90 >= totals.netWorth || totals.monthlySavings >= 0,
    },
    {
      label: "Deuda vs liquidez",
      value: totals.totalDebt > 0 && liquidity < 0 ? "Saldo en cuenta negativo" : "OK",
      ok: !(totals.totalDebt > 0 && liquidity < 0),
    },
  ];

  const statusCriteria = trafficLightCriteriaText(emergencyFund.profile, targetSavingsPct);

  const isCurrentMonth = isCurrentCalendarMonth(month, year);
  const monthElapsedPct = monthElapsedPercent(month, year);
  const budgetSpentPct = totals.monthlyExpense > 0 ? Math.round((monthSpent / totals.monthlyExpense) * 100) : null;
  const mesStatus: "ok" | "warn" | "over" | null =
    !isCurrentMonth || budgetSpentPct === null ? null :
    budgetSpentPct > monthElapsedPct + 10 ? "over" :
    budgetSpentPct > monthElapsedPct ? "warn" : "ok";
  const showMesWidget = isCurrentMonth && !privacyMode && budgetSpentPct !== null;

  const today = new Date();
  const in14 = new Date(today.getTime() + 14 * 86_400_000);
  const upcoming = calendarEvents
    .filter((ev) => {
      const d = new Date(ev.fecha);
      return d >= today && d <= in14;
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .slice(0, 6);

  const activeGoals = goals.filter((g) => {
    const linkedAccount = g.account_id ? accounts.find((a) => a.id === g.account_id) : null;
    const current = linkedAccount ? Number(linkedAccount.balance_actual) : g.monto_actual;
    return current < g.monto_objetivo;
  });
  const goalsWithProgress = activeGoals.map((g) => {
    const linkedAccount = g.account_id ? accounts.find((a) => a.id === g.account_id) : null;
    const current = linkedAccount ? Number(linkedAccount.balance_actual) : g.monto_actual;
    const pct = g.monto_objetivo > 0 ? (current / g.monto_objetivo) * 100 : 0;
    const remaining = g.monto_objetivo - current;
    const monthsLeft = totals.monthlySavings > 0 ? Math.ceil(remaining / totals.monthlySavings) : null;
    const daysUntilDeadline = g.fecha_limite
      ? Math.ceil((new Date(g.fecha_limite).getTime() - today.getTime()) / 86_400_000)
      : null;
    return { ...g, current, pct, remaining, monthsLeft, daysUntilDeadline };
  }).slice(0, 4);

  const alertsPanel = (
    <InicioAlertsPanel alerts={alerts} highAlerts={highAlerts} onNavigate={onNavigate} />
  );
  const upcomingPanel = (
    <InicioUpcomingPanel upcoming={upcoming} today={today} formatEUR={formatEUR} onNavigate={onNavigate} />
  );

  return (
    <div className="inicio-root">
      {accounts.length === 0 && transactionCount === 0 ? (
        <EmptyState
          icon="📊"
          title="Tu panel financiero está vacío"
          description="Añade una cuenta o importa movimientos para ver tu resumen ejecutivo."
          actionLabel="+ Ir a Cuentas"
          onAction={() => onNavigate("Cuentas")}
        />
      ) : null}

      {loadAll && addToast && transactions.length > 0 && (
        <PayrollHintsBanner transactions={transactions} formatEUR={formatEUR} addToast={addToast} loadAll={loadAll} />
      )}

      <InicioStatusHeader
        light={light}
        lightColor={lightColor}
        statusReasons={statusReasons}
        statusCriteria={statusCriteria}
      />

      <InicioKpisSection
        totals={totals}
        liquidity={liquidity}
        privacyMode={privacyMode}
        uiDensity={uiDensity}
        highAlertsCount={highAlerts.length}
        investmentPnl={investmentPnl}
        pnlPct={pnlPct}
        dtiPct={dtiPct}
        nextDebtPayment={nextDebtPayment}
        projectionReturnPct={projectionReturnPct}
        formatEUR={formatEUR}
        onNavigate={onNavigate}
        saveSetting={saveSetting}
      />

      {uiDensity === "minimal" && (
        <div className="inicio-panels inicio-panels--minimal">
          {alertsPanel}
          {upcomingPanel}
        </div>
      )}

      {uiDensity === "detailed" && (
      <>
      <div className="inicio-panels">
        {alertsPanel}

        {!privacyMode && (
          <InicioProjectionsPanel
            projections={projections}
            totals={totals}
            showLiquidityColumn={showLiquidityColumn}
            projectionReturnPct={projectionReturnPct}
            formatEUR={formatEUR}
            saveSetting={saveSetting}
          />
        )}

        <InicioWealthPanels
          showMesWidget={showMesWidget}
          mesStatus={mesStatus}
          monthElapsedPct={monthElapsedPct}
          budgetSpentPct={budgetSpentPct}
          monthSpent={monthSpent}
          monthlyExpense={totals.monthlyExpense}
          goalsWithProgress={goalsWithProgress}
          privacyMode={privacyMode}
          activeSalary={activeSalary}
          formatEUR={formatEUR}
          onNavigate={onNavigate}
          upcomingSlot={upcomingPanel}
        />
      </div>

      <InicioPatrimonioChart
        privacyMode={privacyMode}
        patrimonioEvolution={patrimonioEvolution}
        formatEUR={formatEUR}
      />
      </>
      )}

      <InicioShortcuts onNavigate={onNavigate} />
    </div>
  );
}
