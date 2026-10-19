import { InicioDonutChart } from "./InicioDonutChart";
import type { TotalsSnapshot } from "./inicioTypes";

export type InicioSimpleSnapshotProps = {
  totals: TotalsSnapshot;
  privacyMode: boolean;
  formatEUR: (v: number) => string;
  showMesWidget: boolean;
  mesStatus: "ok" | "warn" | "over" | null;
  budgetSpentPct: number | null;
  monthSpent: number;
  monthlyExpense: number;
  monthElapsedPct: number;
};

const ASSET_COLORS = {
  cash: "var(--status-cyan)",
  investments: "var(--primary)",
  assets: "var(--status-info)",
} as const;

const MES_COLORS = {
  spentOk: "var(--status-ok)",
  spentWarn: "var(--status-warn)",
  spentOver: "var(--status-crit)",
  rest: "color-mix(in srgb, var(--border-soft) 70%, var(--surface))",
} as const;

export function InicioSimpleSnapshot({
  totals,
  privacyMode,
  formatEUR,
  showMesWidget,
  mesStatus,
  budgetSpentPct,
  monthSpent,
  monthlyExpense,
  monthElapsedPct,
}: InicioSimpleSnapshotProps) {
  if (privacyMode) return null;

  const assetSlices = [
    { label: "Liquidez", value: Math.max(0, totals.totalCash), color: ASSET_COLORS.cash },
    { label: "Inversiones", value: Math.max(0, totals.totalInvestments), color: ASSET_COLORS.investments },
    { label: "Propiedades", value: Math.max(0, totals.totalAssets), color: ASSET_COLORS.assets },
  ];
  const assetTotal = assetSlices.reduce((s, x) => s + x.value, 0);

  const spentPct = budgetSpentPct ?? 0;
  const remaining = Math.max(0, monthlyExpense - monthSpent);
  const spentColor =
    mesStatus === "over" ? MES_COLORS.spentOver :
    mesStatus === "warn" ? MES_COLORS.spentWarn :
    MES_COLORS.spentOk;
  const mesSlices = [
    { label: "Gastado", value: Math.max(0, monthSpent), color: spentColor },
    { label: "Queda", value: remaining, color: MES_COLORS.rest },
  ];

  return (
    <div className="inicio-simple">
      <section className="inicio-simple__card inicio-panel">
        <div className="inicio-panel__head">
          <h3>Tu dinero</h3>
          {totals.totalDebt > 0 && (
            <span className="inicio-simple__debt muted">
              Pasivos <strong className="sensitive negative">−{formatEUR(totals.totalDebt)}</strong>
            </span>
          )}
        </div>
        <div className="inicio-panel__body">
          <InicioDonutChart
            slices={assetSlices}
            centerLabel="Activos"
            centerValue={assetTotal > 0 ? formatEUR(assetTotal) : "—"}
            formatValue={formatEUR}
            emptyText="Añade cuentas o activos"
          />
        </div>
      </section>

      {showMesWidget && monthlyExpense > 0 && (
        <section className="inicio-simple__card inicio-panel">
          <div className="inicio-panel__head">
            <h3>Este mes</h3>
            {mesStatus === "over" && <span className="badge negative">pasado</span>}
            {mesStatus === "warn" && <span className="badge badge-warn">vigilar</span>}
            {mesStatus === "ok" && <span className="badge positive">en ritmo</span>}
          </div>
          <div className="inicio-panel__body">
            <InicioDonutChart
              slices={mesSlices}
              centerLabel="Gastado"
              centerValue={`${Math.min(999, spentPct)}%`}
              formatValue={formatEUR}
            />
            <p className="inicio-simple__hint muted">
              Llevas un {monthElapsedPct}% del mes · presupuesto {formatEUR(monthlyExpense)}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
