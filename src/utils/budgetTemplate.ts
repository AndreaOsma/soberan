export type Budget503020Split = {
  necesidades: number;
  deseos: number;
  ahorro: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Reparte ingreso neto según regla 50/30/20 (necesidades / deseos / ahorro). */
export function split503020(netIncome: number): Budget503020Split {
  const base = Math.max(0, netIncome);
  return {
    necesidades: round2(base * 0.5),
    deseos: round2(base * 0.3),
    ahorro: round2(base * 0.2),
  };
}
