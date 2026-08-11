import { useMemo, useState } from "react";
import { api } from "../../services/api";
import { useNotify } from "../../hooks/useNotify";
import { SettingTextField } from "../../components/SettingFields";
import {
  CSV_TABLES,
  csvBundleFilename,
  csvExportFilename,
  csvTableById,
  triggerBlobDownload,
  type CsvTableId,
} from "../../utils/csvExport";

type Props = {
  settings: Record<string, string>;
  tableCounts: Partial<Record<CsvTableId, number>>;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  saveSetting: (key: string, val: string, notify?: boolean) => Promise<void>;
};

export function DataToolsView({ settings, tableCounts, addToast, loadAll, saveSetting }: Props) {
  const exportable = useMemo(() => CSV_TABLES.filter((t) => t.exportable), []);
  const [selectedExport, setSelectedExport] = useState<Set<CsvTableId>>(
    () => new Set(exportable.map((t) => t.id)),
  );
  const [selectedImportTable, setSelectedImportTable] = useState<CsvTableId>("transactions");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [restoreText, setRestoreText] = useState("");
  const { busy, notifyAfter } = useNotify({ addToast, loadAll });

  const importable = CSV_TABLES.filter((t) => t.importable);
  const selectedList = exportable.filter((t) => selectedExport.has(t.id));
  const totalRows = selectedList.reduce((s, t) => s + (tableCounts[t.id] ?? 0), 0);

  function toggleExport(id: CsvTableId) {
    setSelectedExport((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="grid two-col">
      <article className="card card-wide">
        <h2>Backup y restauración</h2>
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
          Copia de seguridad de tu configuración (ajustes, reglas, preferencias).
        </p>
        <SettingTextField
          label="Passphrase de backup (opcional)"
          settingKey="backup_passphrase"
          value={settings.backup_passphrase || ""}
          type="password"
          onSave={(key, val) => saveSetting(key, val, false)}
        />
        <div className="inline-actions" style={{ marginTop: "0.75rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              const payload = { generated_at: new Date().toISOString(), settings };
              const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
              triggerBlobDownload(blob, `backup_soberan_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
            }}
          >
            Descargar backup
          </button>
        </div>
        <label style={{ marginTop: "1rem" }}>
          Restaurar desde JSON
          <textarea
            rows={6}
            value={restoreText}
            onChange={(e) => setRestoreText(e.target.value)}
            placeholder="Pega aquí el JSON exportado."
          />
        </label>
        <button
          type="button"
          disabled={busy || !restoreText.trim()}
          onClick={() => void notifyAfter(async () => {
            const parsed = JSON.parse(restoreText) as { settings?: Record<string, string> };
            const settingsPayload = parsed.settings || {};
            for (const [key, value] of Object.entries(settingsPayload)) {
              await api.setSetting(key, String(value));
            }
            await loadAll({ silent: true });
          }, "Configuración restaurada.", "No se pudo restaurar.")}
        >
          Restaurar
        </button>
      </article>

      <article className="card card-wide">
        <h2>Exportar / importar CSV</h2>
        <div style={{ marginTop: "0.75rem" }}>
            <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.75rem" }}>
              Copia de tablas para migración. UTF-8 con BOM (compatible Excel). Extractos bancarios: Cuentas · MyInvestor: Inversiones.
            </p>

            <div className="csv-export-toolbar">
              <button
                type="button"
                disabled={busy}
                onClick={() => void notifyAfter(async () => {
                  const blob = await api.exportCsvBundle();
                  triggerBlobDownload(blob, csvBundleFilename());
                }, "ZIP descargado.", "No se pudo exportar el paquete.")}
              >
                Descargar todo (ZIP)
              </button>
              <button
                type="button"
                className="button-secondary"
                disabled={busy || selectedList.length === 0}
                onClick={() => void notifyAfter(async () => {
                  for (const table of selectedList) {
                    const blob = await api.exportCsv(table.id);
                    triggerBlobDownload(blob, csvExportFilename(table.slug));
                  }
                }, `${selectedList.length} CSV descargados.`, "Error al exportar.")}
              >
                Exportar selección ({selectedList.length})
              </button>
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                {totalRows.toLocaleString("es")} filas en selección
              </span>
            </div>

            <div className="csv-export-grid">
              {exportable.map((table) => {
                const count = tableCounts[table.id];
                const checked = selectedExport.has(table.id);
                return (
                  <div key={table.id} className={`csv-export-item${checked ? " is-selected" : ""}`}>
                    <label className="csv-export-item__check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleExport(table.id)}
                      />
                      <span>{table.label}</span>
                    </label>
                    <span className="csv-export-item__meta muted">
                      {count != null ? `${count.toLocaleString("es")} filas` : "—"}
                    </span>
                    <button
                      type="button"
                      className="button-secondary csv-export-item__btn"
                      disabled={busy}
                      onClick={() => void notifyAfter(async () => {
                        const blob = await api.exportCsv(table.id);
                        triggerBlobDownload(blob, csvExportFilename(table.slug));
                      }, `${table.label} exportado.`, `No se pudo exportar ${table.label}.`)}
                    >
                      CSV
                    </button>
                  </div>
                );
              })}
            </div>

            <hr style={{ margin: "1.25rem 0", border: "none", borderTop: "1px solid var(--border-soft)" }} />

            <h3 style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>Importar CSV</h3>
            <p className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.75rem" }}>
              Solo CSVs exportados desde Soberan (misma estructura de columnas).
            </p>
            <div className="grid two-col" style={{ gap: "0.75rem", alignItems: "end" }}>
              <label>
                Tabla destino
                <select value={selectedImportTable} onChange={(e) => setSelectedImportTable(e.target.value as CsvTableId)}>
                  {importable.map((table) => (
                    <option key={table.id} value={table.id}>{table.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Archivo
                <input type="file" accept=".csv" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <button
              type="button"
              style={{ marginTop: "0.75rem" }}
              disabled={busy || !importFile}
              onClick={() => void notifyAfter(async () => {
                if (!importFile) throw new Error("Selecciona un CSV primero.");
                await api.importCsv(selectedImportTable, importFile);
                setImportFile(null);
              }, `${csvTableById(selectedImportTable)?.label ?? selectedImportTable} importado.`, "No se pudo importar CSV.")}
            >
              Importar
            </button>
        </div>
      </article>
    </section>
  );
}
