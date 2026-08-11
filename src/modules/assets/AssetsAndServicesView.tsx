import type { Account, Card, Investment, MoneyOwed, Property } from "../../types";
import { InvestmentsPanel } from "./InvestmentsPanel";
import { FixedAssetsPanel } from "./FixedAssetsPanel";
import { MoneyOwedPanel } from "./MoneyOwedPanel";
import { CardsPanel } from "./CardsPanel";

type KrakenBalance = { asset: string; amount: number; eur_value: number | null; eur_price: number | null; type: string };

export type AssetsAndServicesViewProps = {
  currentMenu: string;
  accounts: Account[];
  investments: Investment[];
  properties: Property[];
  moneyOwed: MoneyOwed[];
  cards: Card[];
  krakenBalances: KrakenBalance[];
  settings: Record<string, string>;
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  deleteWithUndo: (label: string, onCommit: () => Promise<void>) => void;
  saveSetting: (key: string, val: string, notify?: boolean) => Promise<void>;
};

export function AssetsAndServicesView({
  currentMenu, accounts, investments, properties, moneyOwed, cards, krakenBalances,
  settings, formatEUR, addToast, loadAll, deleteWithUndo, saveSetting,
}: AssetsAndServicesViewProps) {
  if (currentMenu === "Inversiones") {
    return (
      <InvestmentsPanel
        accounts={accounts}
        investments={investments}
        settings={settings}
        krakenBalances={krakenBalances}
        formatEUR={formatEUR}
        addToast={addToast}
        loadAll={loadAll}
        deleteWithUndo={deleteWithUndo}
        saveSetting={saveSetting}
      />
    );
  }

  if (currentMenu === "Activos Fijos") {
    return (
      <FixedAssetsPanel
        properties={properties}
        formatEUR={formatEUR}
        addToast={addToast}
        loadAll={loadAll}
        deleteWithUndo={deleteWithUndo}
      />
    );
  }

  if (currentMenu === "Cuentas a Cobrar") {
    return (
      <MoneyOwedPanel
        moneyOwed={moneyOwed}
        formatEUR={formatEUR}
        addToast={addToast}
        loadAll={loadAll}
        deleteWithUndo={deleteWithUndo}
      />
    );
  }

  if (currentMenu === "Tarjetas") {
    return (
      <CardsPanel
        cards={cards}
        formatEUR={formatEUR}
        addToast={addToast}
        loadAll={loadAll}
        deleteWithUndo={deleteWithUndo}
      />
    );
  }

  return null;
}
