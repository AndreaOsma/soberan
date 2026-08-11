import type { Account } from "../types";

export type BankImportRow = {
  accountId: number | null;
  alias: string;
  oldBalance: number;
  newBalance: number;
  source: string;
  isNew: boolean;
  toCreate?: { alias_real: string; alias_anonimo: string; tipo: string; banco: string };
  archivedCount?: number;
};

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === "," && !inQ) { result.push(cur.trim()); cur = ""; }
    else { cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

function parseEurValue(s: string): number {
  const paren = s.match(/\(([\d.]+),([\d]+)€\)/);
  if (paren) return parseFloat(`${paren[1].replace(/\./g, "")}.${paren[2]}`);
  const direct = s.match(/([\d.]+),([\d]+)€/);
  if (direct) return parseFloat(`${direct[1].replace(/\./g, "")}.${direct[2]}`);
  return 0;
}

export function parseRevolutCSV(text: string) {
  const KNOWN_LABELS = new Set([
    "Datos de cuenta actuales", "Información sobre la institución financiera",
    "Valor del depósito", "Ingresos generados (incluidas invitaciones y recompensas)",
    "Other information", "Transacciones", "Fecha",
    "Número de cuenta (IBAN)", "Número de cuenta (ES IBAN)", "Número de cuenta GB", "Número de cuenta",
    "Modalidades de participaciones", "Finalidad de la cuenta", "Tipo de cuenta",
    "Nombre de la institución financiera", "Dirección y país",
    "Ingresos por intereses", "Ingresos por dividendos",
    "Ganancias de capital (conversión de divisas)", "Ganancias por invitaciones",
    "Ganancias por recompensas", "Ganancias de cashback",
    "Domicilio del fondo paraguas", "Tipo de fondo",
  ]);
  const sections: Array<{ name: string; balance: number; type: "main" | "pocket" | "savings" | "foreign" | "other" }> = [];
  let currentName: string | null = null;
  let inTx = false;

  for (const raw of text.split("\n")) {
    const row = parseCsvLine(raw);
    if (!row.length || row.every((c) => !c)) continue;
    const col0 = row[0] ?? "";
    const col2 = row[2] ?? "";
    const col3 = row[3] ?? "";
    if (col0.startsWith("---")) { inTx = false; continue; }
    if (col0 === "Fecha" && row[1] === "Descripción") { inTx = true; continue; }
    if (inTx) continue;
    if (col0 && !row[1] && !KNOWN_LABELS.has(col0) && col0.length < 100) {
      currentName = col0;
    }
    if (col2 === "Saldo de cierre" && currentName) {
      const balance = parseEurValue(col3);
      let type: "main" | "pocket" | "savings" | "foreign" | "other" = "pocket";
      if (currentName === "Cuenta personal (EUR)") type = "main";
      else if (currentName.startsWith("Cuenta personal (")) type = "foreign";
      else if (currentName.startsWith("Datos de la cuenta de ahorro")) type = "savings";
      else if (currentName === "Información del fondo") type = "other";
      sections.push({ name: currentName, balance, type });
      currentName = null;
    }
  }
  return sections;
}

export function buildRevolutImportPreview(text: string, accounts: Account[]): { preview: BankImportRow[]; error?: string } {
  if (!text.includes("Revolut Bank UAB")) {
    return { preview: [], error: "Formato no reconocido. Por ahora solo se soporta el extracto consolidado de Revolut." };
  }

  const sections = parseRevolutCSV(text);
  const mainEur = sections.find((s) => s.type === "main");
  const activePockets = sections.filter((s) => (s.type === "pocket" || s.type === "savings") && s.balance > 0);
  const archivedCount = sections.filter((s) => (s.type === "pocket" || s.type === "savings") && s.balance === 0).length;

  const preview: BankImportRow[] = [];
  const mainAcc = accounts.find((a) => a.alias_anonimo === "ACC_REV_MAIN");
  if (mainEur && mainAcc) {
    preview.push({
      accountId: mainAcc.id, alias: mainAcc.alias_real, oldBalance: mainAcc.balance_actual,
      newBalance: mainEur.balance, source: "Cuenta personal (EUR)", isNew: false,
    });
  }

  const pockAcc = accounts.find((a) => a.alias_anonimo === "ACC_REV_POCK");
  if (pockAcc && pockAcc.balance_actual !== 0) {
    preview.push({
      accountId: pockAcc.id, alias: pockAcc.alias_real, oldBalance: pockAcc.balance_actual,
      newBalance: 0, source: "Reemplazado por pockets individuales", isNew: false, archivedCount,
    });
  }

  for (const pocket of activePockets) {
    const cleanName = pocket.name.replace(/\s*\(EUR\)\s*$/, "").trim();
    const accountName = `Revolut · ${cleanName}`;
    const existing = accounts.find((a) => a.alias_real === accountName);
    const slug = cleanName.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase().slice(0, 20);
    preview.push({
      accountId: existing?.id ?? null,
      alias: accountName,
      oldBalance: existing?.balance_actual ?? 0,
      newBalance: pocket.balance,
      source: pocket.name,
      isNew: !existing,
      toCreate: existing ? undefined : { alias_real: accountName, alias_anonimo: `REV_POCK_${slug}`, tipo: "ahorro", banco: "Revolut" },
    });
  }

  if (preview.length === 0) {
    return { preview: [], error: "No se encontraron cuentas Revolut en Soberan." };
  }
  return { preview };
}
