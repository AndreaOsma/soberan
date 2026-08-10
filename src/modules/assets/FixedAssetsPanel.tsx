import { useState } from "react";
import { api } from "../../services/api";
import { GlassModal } from "../../components/GlassModal";
import { PropertyModal } from "../../components/modals/PropertyModal";
import type { Property } from "../../types";
import { parseNum } from "../../utils/format";
import { useAsyncSubmit } from "../../hooks/useAsyncSubmit";
import { ModalFormError } from "../../components/ModalFormError";

export type FixedAssetsPanelProps = {
  properties: Property[];
  formatEUR: (v: number) => string;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadAll: (opts?: { silent?: boolean }) => Promise<void>;
  deleteWithUndo: (label: string, onCommit: () => Promise<void>) => void;
};

export function FixedAssetsPanel({
  properties, formatEUR, addToast, loadAll, deleteWithUndo,
}: FixedAssetsPanelProps) {
  const [isPropertyFormOpen, setIsPropertyFormOpen] = useState(false);
  const [propertyForm, setPropertyForm] = useState<{
    nombre: string; valor_estimado: number; tipo: string;
    marca: string; modelo: string; anio: string; matricula: string;
    bastidor: string; color: string; km: string; estado_notas: string;
  }>({ nombre: "", valor_estimado: 0, tipo: "inmueble", marca: "", modelo: "", anio: "", matricula: "", bastidor: "", color: "", km: "", estado_notas: "" });
  const [editPropertyModal, setEditPropertyModal] = useState<Property | null>(null);
  const [valuatingId, setValuatingId] = useState<number | null>(null);
  const [valuationMetaById, setValuationMetaById] = useState<Record<number, {
    min: number;
    max: number;
    muestras: number;
    fuente: string;
    confianza: string;
    asking_p10?: number;
    asking_p25?: number;
    asking_p50?: number;
    asking_ref?: number;
    haircut?: number;
    valor_mercado_realizable?: number;
    valor_estimado?: number;
    nota?: string;
    clamped?: boolean;
  }>>({});
  const createSubmit = useAsyncSubmit();

  const parseValuationSnapshot = (raw?: string | null) => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as {
        min: number;
        max: number;
        muestras: number;
        fuente: string;
        confianza: string;
        asking_p10?: number;
        asking_p25?: number;
        asking_p50?: number;
        asking_ref?: number;
        haircut?: number;
        valor_mercado_realizable?: number;
        valor_estimado?: number;
        nota?: string;
        clamped?: boolean;
      };
    } catch {
      return null;
    }
  };

  return (
    <>
      <section className="grid one-col">
        <article className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2>Activos fijos</h2>
            <button onClick={() => setIsPropertyFormOpen(true)}>+ Nuevo activo</button>
          </div>
          {properties.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🏠</div>
              <h3>Sin activos fijos</h3>
              <p>Añade inmuebles o vehículos para incluirlos en tu cálculo de patrimonio neto.</p>
              <button onClick={() => setIsPropertyFormOpen(true)}>+ Añadir activo</button>
            </div>
          ) : (
            <ul className="list">
              {properties.map((item) => (
                <li key={item.id} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.35rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                    <span>
                      {item.tipo === "vehiculo" ? "🚗 " : item.tipo === "inmueble" ? "🏠 " : ""}
                      {item.nombre}
                      {item.matricula && <span className="muted" style={{ fontSize: '0.75rem', marginLeft: '0.5rem' }}>{item.matricula}</span>}
                    </span>
                    <div className="inline-actions">
                      <strong className="sensitive">{formatEUR(item.valor_estimado)}</strong>
                      {item.tipo === "vehiculo" && (
                        <button
                          type="button"
                          className="button-secondary"
                          disabled={valuatingId === item.id}
                          onClick={() => {
                            void (async () => {
                              setValuatingId(item.id);
                              try {
                                const result = await api.vehicleValuation(item.id);
                                setValuationMetaById((prev) => ({
                                  ...prev,
                                  [item.id]: {
                                    min: result.min,
                                    max: result.max,
                                    muestras: result.muestras,
                                    fuente: result.fuente,
                                    confianza: result.confianza,
                                    asking_p10: result.asking_p10,
                                    asking_p25: result.asking_p25,
                                    asking_p50: result.asking_p50,
                                    asking_ref: result.asking_ref,
                                    haircut: result.haircut,
                                    valor_mercado_realizable: result.valor_mercado_realizable,
                                    valor_estimado: result.valor_estimado,
                                    nota: result.nota,
                                    clamped: result.clamped,
                                  },
                                }));
                                addToast(
                                  `Valor realizable ~${formatEUR(result.valor_estimado)} (${result.muestras} anuncios, confianza ${result.confianza})`,
                                  "success",
                                );
                                await loadAll({ silent: true });
                              } catch (err) {
                                addToast(
                                  err instanceof Error ? err.message : "No se pudo obtener valoración.",
                                  "error",
                                );
                              } finally {
                                setValuatingId(null);
                              }
                            })();
                          }}
                        >
                          {valuatingId === item.id ? "Valorando…" : "Valorar"}
                        </button>
                      )}
                      <button type="button" className="button-secondary" style={{ padding: "0.25rem 0.5rem" }}
                        aria-label={`Editar activo ${item.nombre}`} title="Editar"
                        onClick={() => setEditPropertyModal(item)}>✎</button>
                      <button type="button" className="danger"
                        aria-label={`Eliminar activo ${item.nombre}`} title="Eliminar"
                        onClick={() => deleteWithUndo("Activo", () => api.deleteProperty(item.id).then(() => loadAll()))}>
                        🗑
                      </button>
                    </div>
                  </div>
                  {item.tipo === "vehiculo" && (item.marca || item.modelo || item.km) && (
                    <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
                      {[item.marca, item.modelo, item.anio, item.km ? `${item.km.toLocaleString()} km` : null, item.color].filter(Boolean).join(' · ')}
                      {item.valor_actualizado_en && <span> · Valorado {new Date(item.valor_actualizado_en).toLocaleDateString('es-ES')}</span>}
                    </p>
                  )}
                  {(() => {
                    if (item.tipo !== "vehiculo") return null;
                    const meta = valuationMetaById[item.id] ?? parseValuationSnapshot(item.valoracion_json);
                    if (!meta) return null;
                    const haircutPct = meta.haircut != null ? Math.round(meta.haircut * 100) : null;
                    return (
                      <div
                        className="muted"
                        style={{
                          fontSize: "0.75rem",
                          margin: 0,
                          padding: "0.5rem 0.65rem",
                          borderRadius: "0.5rem",
                          background: "color-mix(in srgb, var(--text-muted, #888) 12%, transparent)",
                          width: "100%",
                          boxSizing: "border-box",
                        }}
                      >
                        <p style={{ margin: "0 0 0.25rem" }}>
                          <strong>Realizable:</strong>{" "}
                          {formatEUR(meta.valor_estimado ?? item.valor_estimado)}
                        </p>
                        {(meta.asking_p10 != null || meta.asking_p50 != null) && (
                          <p style={{ margin: "0 0 0.25rem" }}>
                            Asking P10–P50:{" "}
                            {formatEUR(meta.asking_p10 ?? meta.min)}–{formatEUR(meta.asking_p50 ?? meta.max)}
                            {meta.asking_ref != null && <> · ref {formatEUR(meta.asking_ref)}</>}
                            {haircutPct != null && <> · haircut −{haircutPct}%</>}
                          </p>
                        )}
                        <p style={{ margin: "0 0 0.25rem" }}>
                          {meta.muestras} anuncios · {meta.fuente} · confianza {meta.confianza}
                          {meta.clamped ? " · techo aplicado" : ""}
                        </p>
                        <p style={{ margin: 0, opacity: 0.9 }}>
                          {meta.nota
                            || "Basado en anuncios; el precio de venta suele ser inferior al de publicación."}
                        </p>
                      </div>
                    );
                  })()}
                  {item.estado_notas && <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>{item.estado_notas}</p>}
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      {editPropertyModal && <PropertyModal item={editPropertyModal} onClose={() => setEditPropertyModal(null)} onSaved={loadAll} />}

      <GlassModal isOpen={isPropertyFormOpen} onClose={() => setIsPropertyFormOpen(false)} title="Nuevo activo">
        <ModalFormError error={createSubmit.error} />
        {(() => {
          const isVehicle = propertyForm.tipo === "vehiculo";
          const resetPropertyForm = () => setPropertyForm({ nombre: "", valor_estimado: 0, tipo: "inmueble", marca: "", modelo: "", anio: "", matricula: "", bastidor: "", color: "", km: "", estado_notas: "" });
          return (
            <form onSubmit={(e) => {
              e.preventDefault();
              const payload = {
                nombre: propertyForm.nombre || (isVehicle ? `${propertyForm.marca} ${propertyForm.modelo}` : ""),
                valor_estimado: propertyForm.valor_estimado, tipo: propertyForm.tipo,
                marca: isVehicle ? propertyForm.marca : null, modelo: isVehicle ? propertyForm.modelo : null,
                anio: isVehicle && propertyForm.anio ? parseInt(propertyForm.anio) : null,
                matricula: isVehicle ? propertyForm.matricula : null, bastidor: isVehicle ? propertyForm.bastidor : null,
                color: isVehicle ? propertyForm.color : null, km: isVehicle && propertyForm.km ? parseInt(propertyForm.km) : null,
                estado_notas: isVehicle ? propertyForm.estado_notas : null, valor_actualizado_en: null,
              };
              void createSubmit.run(async () => {
                await api.createProperty(payload);
                resetPropertyForm();
                setIsPropertyFormOpen(false);
                addToast("Activo creado.", "success");
                await loadAll({ silent: true });
              });
            }}>
              <label>Tipo<select value={propertyForm.tipo} onChange={e => setPropertyForm(p => ({ ...p, tipo: e.target.value }))}><option value="inmueble">Inmueble</option><option value="vehiculo">Vehículo</option><option value="otro">Otro</option></select></label>
              {!isVehicle && <label style={{ marginTop: "0.75rem" }}>Nombre<input value={propertyForm.nombre} onChange={e => setPropertyForm(p => ({ ...p, nombre: e.target.value }))} required autoFocus /></label>}
              {isVehicle && <div className="grid two-col" style={{ gap: "0.75rem", marginTop: "0.75rem" }}>
                <label>Marca<input value={propertyForm.marca} onChange={e => setPropertyForm(p => ({ ...p, marca: e.target.value }))} placeholder="Toyota" required /></label>
                <label>Modelo<input value={propertyForm.modelo} onChange={e => setPropertyForm(p => ({ ...p, modelo: e.target.value }))} placeholder="Yaris" required /></label>
                <label>Año<input type="number" value={propertyForm.anio} onChange={e => setPropertyForm(p => ({ ...p, anio: e.target.value }))} placeholder="2019" /></label>
                <label>Color<input value={propertyForm.color} onChange={e => setPropertyForm(p => ({ ...p, color: e.target.value }))} placeholder="Blanco" /></label>
                <label>Matrícula<input value={propertyForm.matricula} onChange={e => setPropertyForm(p => ({ ...p, matricula: e.target.value }))} /></label>
                <label>Km<input type="number" value={propertyForm.km} onChange={e => setPropertyForm(p => ({ ...p, km: e.target.value }))} /></label>
                <label style={{ gridColumn: "1/-1" }}>Nº Bastidor<input value={propertyForm.bastidor} onChange={e => setPropertyForm(p => ({ ...p, bastidor: e.target.value }))} placeholder="VIN" /></label>
                <label style={{ gridColumn: "1/-1" }}>Estado<textarea rows={2} value={propertyForm.estado_notas} onChange={e => setPropertyForm(p => ({ ...p, estado_notas: e.target.value }))} /></label>
              </div>}
              <label style={{ marginTop: "0.75rem" }}>Valor estimado (€)<input type="number" step="0.01" value={propertyForm.valor_estimado || ""} onChange={e => setPropertyForm(p => ({ ...p, valor_estimado: parseNum(e.target.value) }))} /></label>
              <div className="modal-actions" style={{ marginTop: "1rem" }}>
                <button type="button" className="button-secondary" onClick={() => { resetPropertyForm(); setIsPropertyFormOpen(false); }}>Cancelar</button>
                <button type="submit" disabled={createSubmit.saving}>{createSubmit.saving ? "Guardando…" : "Guardar"}</button>
              </div>
            </form>
          );
        })()}
      </GlassModal>

      </>
    );
}
