/** Tablas exportables/importables vía CSV (alineado con backend). */
export const CSV_TABLES = [
  { id: "accounts", label: "Cuentas", slug: "cuentas", exportable: true, importable: true },
  { id: "transactions", label: "Transacciones", slug: "transacciones", exportable: true, importable: true },
  { id: "recurring-entries", label: "Partidas recurrentes", slug: "partidas-recurrentes", exportable: true, importable: true },
  { id: "goals", label: "Objetivos", slug: "objetivos", exportable: true, importable: true },
  { id: "debts", label: "Deudas", slug: "deudas", exportable: true, importable: true },
  { id: "investments", label: "Inversiones", slug: "inversiones", exportable: true, importable: true },
  { id: "properties", label: "Activos fijos", slug: "activos-fijos", exportable: true, importable: true },
  { id: "work-history", label: "Historial laboral", slug: "historial-laboral", exportable: true, importable: true },
  { id: "salary-breakdown", label: "Desglose nómina", slug: "desglose-nomina", exportable: true, importable: true },
] as const;

export type CsvTableId = (typeof CSV_TABLES)[number]["id"];

export function csvTableById(id: string) {
  return CSV_TABLES.find((t) => t.id === id);
}

export function csvExportFilename(slug: string, date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  return `soberan-${slug}-${stamp}.csv`;
}

export function csvBundleFilename(date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  return `soberan-export-${stamp}.zip`;
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}
