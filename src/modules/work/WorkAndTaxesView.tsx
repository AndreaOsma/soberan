import type { MenuKey } from "../../config/ui";
import type { Account, RecurringEntry, WorkHistory } from "../../types";
import { WorkHistoryPanel } from "./WorkHistoryPanel";
import { TaxesIrpfPanel } from "./TaxesIrpfPanel";

type ActiveSalary = {
  empresa: string; bruto: number; irpf: number; ss: number;
  neto: number; irpf_pct: number; ss_pct: number;
} | null;

export type WorkAndTaxesViewProps = {
  currentMenu: string;
  year: number;
  workHistory: WorkHistory[];
  recurringEntries: RecurringEntry[];
  accounts: Account[];
  settings: Record<string, string>;
  activeSalary: ActiveSalary;
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  deleteWithUndo: (label: string, onCommit: () => Promise<void>) => void;
  saveSetting: (key: string, val: string) => Promise<void>;
  onNavigateToHistorialLaboral: () => void;
  onNavigate?: (key: MenuKey) => void;
};

export function WorkAndTaxesView({
  currentMenu, year, workHistory, recurringEntries, accounts, settings,
  activeSalary, formatEUR, addToast, loadAll, deleteWithUndo, saveSetting,
  onNavigateToHistorialLaboral, onNavigate,
}: WorkAndTaxesViewProps) {
  if (currentMenu === "Historial Laboral") {
    return (
      <WorkHistoryPanel
        workHistory={workHistory}
        recurringEntries={recurringEntries}
        accounts={accounts}
        settings={settings}
        activeSalary={activeSalary}
        formatEUR={formatEUR}
        addToast={addToast}
        loadAll={loadAll}
        deleteWithUndo={deleteWithUndo}
        saveSetting={saveSetting}
        onNavigate={onNavigate}
      />
    );
  }

  if (currentMenu === "Impuestos") {
    return (
      <TaxesIrpfPanel
        year={year}
        workHistory={workHistory}
        accounts={accounts}
        settings={settings}
        activeSalary={activeSalary}
        formatEUR={formatEUR}
        addToast={addToast}
        loadAll={loadAll}
        saveSetting={saveSetting}
        onNavigateToHistorialLaboral={onNavigateToHistorialLaboral}
      />
    );
  }

  return null;
}
