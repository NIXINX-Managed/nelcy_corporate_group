"use client";

import { useMemo, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { firebaseServices, organizationId } from "@/lib/firebase";
import type { Category, Customer, Entity, Movement, MovementKind } from "@/lib/finance";
import { centsToMoney, movementLabels } from "@/lib/finance";
import { ALL_KINDS, downloadLayout, MAX_IMPORT_ROWS, parseBulkFile, type PreviewLine } from "@/lib/bulk-excel";

type Props = { entities: Entity[]; categories: Category[]; customers: Customer[]; movements: Movement[]; uid: string; selectedEntity: string };
type ImportResult = { saved: number; skipped: number; failed: number };
const errorLabel = (error: unknown) => error instanceof Error ? error.message : "Error desconocido";

export function BulkImport({ entities, categories, customers, movements, uid, selectedEntity }: Props) {
  const [kind, setKind] = useState<MovementKind>("income");
  const [layoutCompanyId, setLayoutCompanyId] = useState(entities.some((e)=>e.id === selectedEntity && e.type === "company") ? selectedEntity : "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewLine[]>([]);
  const [previewKind, setPreviewKind] = useState<MovementKind | null>(null);
  const [status, setStatus] = useState("");
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [allowSimilar, setAllowSimilar] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  const counts = useMemo(() => ({
    total: preview.length,
    invalid: preview.filter((x)=>x.errors.length > 0).length,
    warnings: preview.filter((x)=>x.warnings.length > 0 && x.errors.length === 0).length,
    ready: preview.filter((x)=>x.data && x.errors.length === 0 && (allowSimilar || x.warnings.length === 0)).length,
  }), [preview, allowSimilar]);
  const validRows = useMemo(() => preview.filter((x) => x.data && !x.errors.length && (allowSimilar || !x.warnings.length)), [preview, allowSimilar]);

  function clearSelection(next: File | null) {
    setFile(next); setPreview([]); setPreviewKind(null); setResult(null); setStatus(""); setIssues([]);
    setAllowSimilar(false); setProgress({ done: 0, total: 0 });
  }
  async function download() {
    setStatus("");
    setParsing(true);
    try { await downloadLayout(kind, entities, categories, customers, movements, layoutCompanyId); }
    catch (err) { setStatus(`No se pudo generar el layout: ${errorLabel(err)}`); }
    finally { setParsing(false); }
  }
  async function validateFile() {
    if (!file) return;
    setParsing(true); setResult(null); setIssues([]); setStatus(""); setPreview([]);
    try {
      const parsed = await parseBulkFile(file, entities, categories, customers, movements, organizationId);
      setPreview(parsed.rows); setPreviewKind(parsed.kind);
      setStatus(`Se revisaron ${parsed.rows.length} filas de ${movementLabels[parsed.kind]}. Comprueba el resultado antes de importar.`);
    } catch (err) { setStatus(`No se pudo validar: ${errorLabel(err)}`); }
    finally { setParsing(false); }
  }
  async function upload() {
    if (!validRows.length || !previewKind || uploading) return;
    setUploading(true); setIssues([]); setResult(null);
    const stats: ImportResult = { saved: 0, skipped: 0, failed: 0 };
    const errors: string[] = [];
    const batchId = crypto.randomUUID();
    setProgress({ done: 0, total: validRows.length });
    try {
      const db = firebaseServices().db;
      for (let i = 0; i < validRows.length; i++) {
        const item = validRows[i];
        if (!item.data) continue;
        const ref = doc(db, "organizations", organizationId, "movements", item.docId);
        try {
          // Repetir el mismo Excel no debe producir registros adicionales.
          const already = await getDoc(ref);
          if (already.exists()) { stats.skipped++; }
          else {
            // Solo al confirmar la importación asignamos la referencia interna.
            // El ID determinista permite reintentar el mismo archivo sin duplicar datos.
            const externalRef = `IMP-${item.docId.slice(4, 24).toUpperCase()}`;
            await setDoc(ref, { ...item.data, externalRef, importBatchId: batchId, importRow: item.row,
              createdBy: uid, createdAt: serverTimestamp() });
            stats.saved++;
          }
        } catch (err) {
          stats.failed++;
          if (errors.length < 12) errors.push(`Fila ${item.row}: ${errorLabel(err)}`);
          // No continuar si se pierden permisos o la red falla repetidamente.
          if (stats.failed >= 3) {
            setStatus("Se detuvo la importación tras tres errores. Puedes reintentar: las referencias ya guardadas no se duplicarán.");
            setProgress({ done: i + 1, total: validRows.length });
            break;
          }
        }
        setProgress({ done: i + 1, total: validRows.length });
      }
      setResult(stats); setIssues(errors);
      if (!stats.failed) setStatus(`Importación finalizada: ${stats.saved} nuevos, ${stats.skipped} ya existentes.`);
    } finally { setUploading(false); }
  }

  return <div className="bulk-stack">
    <section className="panel"><div className="panel-title"><h2>1. Descargar layout de Excel</h2><span>Compatible con Microsoft Excel (.xlsx)</span></div>
      <p>Para ingresos, costos y gastos, selecciona una empresa: el Excel tendrá valor antes de impuestos y total. La aplicación calcula los impuestos automáticamente. En ingresos podrás elegir clientes de esa empresa. Descarga un layout nuevo v5.</p>
      <div className="bulk-toolbar">
        <label className="bulk-label">Tipo de operación
          <select value={kind} disabled={parsing || uploading} onChange={(e)=>setKind(e.target.value as MovementKind)}>
            {ALL_KINDS.map((id)=><option key={id} value={id}>{movementLabels[id]}</option>)}
          </select>
        </label>
        {(["income", "cost", "expense"] as MovementKind[]).includes(kind) && <label className="bulk-label">Empresa del layout
          <select value={layoutCompanyId} onChange={(e)=>setLayoutCompanyId(e.target.value)}>
            <option value="">Seleccionar empresa</option>
            {entities.filter((e)=>e.type === "company" && e.active).sort((a,b)=>a.name.localeCompare(b.name)).map((e)=><option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>}
        <button type="button" className="button-primary" disabled={parsing || uploading || (["income","cost","expense"] as MovementKind[]).includes(kind) && !layoutCompanyId} onClick={download}>
          {parsing ? "Preparando…" : "Descargar plantilla .xlsx"}
        </button>
      </div>
      <p className="small-note">Las listas del Excel se generan con los datos actuales de Firestore. No se genera ninguna transacción al descargarla. Límite: {MAX_IMPORT_ROWS} filas por archivo.</p>
    </section>
    <section className="panel"><div className="panel-title"><h2>2. Cargar y validar el archivo</h2></div>
      <p>Completa únicamente la hoja <strong>Movimientos</strong>. Conserva los encabezados y la pestaña <strong>Instrucciones</strong>. Las filas vacías se ignoran.</p>
      <div className="bulk-toolbar">
        <label className="bulk-label">Archivo Excel
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={uploading} onChange={(e)=>clearSelection(e.target.files?.[0] ?? null)} />
        </label>
        <button type="button" className="button-secondary" disabled={!file || parsing || uploading} onClick={validateFile}>
          {parsing ? "Validando…" : "Validar archivo"}
        </button>
      </div>
      {status && <p className="bulk-feedback" role="status">{status}</p>}
    </section>
    {preview.length > 0 && <section className="panel"><div className="panel-title"><h2>3. Vista previa</h2><span>{movementLabels[previewKind ?? kind]}</span></div>
      <div className="bulk-metrics">
        <div><strong>{counts.total}</strong><span>Filas revisadas</span></div>
        <div><strong>{counts.ready}</strong><span>Listas para importar</span></div>
        <div><strong>{counts.invalid}</strong><span>Con errores</span></div>
        <div><strong>{counts.warnings}</strong><span>Posibles duplicados</span></div>
      </div>
      <p className="small-note">Los errores no se guardan. Los posibles duplicados requieren confirmación. Revisa las operaciones idénticas: el sistema las diferencia por su posición entre las ocurrencias del mismo archivo.</p>
      {counts.warnings > 0 && <label className="bulk-confirm"><input type="checkbox" checked={allowSimilar} disabled={uploading}
        onChange={(e)=>setAllowSimilar(e.target.checked)}/> Confirmo que las filas marcadas como posibles duplicados corresponden a operaciones distintas y deseo incluirlas.</label>}
      <div className="table-wrap"><table className="bulk-table"><thead><tr>
        <th>Fila</th><th>Folio usuario</th><th>Fecha</th><th>Empresa / entidad</th><th>Cliente</th><th>Valor antes de impuestos</th><th>Impuestos calculados</th><th>Total</th><th>Resultado</th>
      </tr></thead><tbody>{preview.slice(0, 250).map((r)=><tr key={r.row}>
        <td>{r.row}</td><td>{r.userFolio || "—"}</td><td>{r.date || "—"}</td><td>{r.entityText || "—"}</td><td>{r.customerText || "—"}</td>
        <td>{Number.isSafeInteger(r.netCents) && r.netCents > 0 ? centsToMoney(r.netCents) : "—"}</td>
        <td>{Number.isSafeInteger(r.taxCents) && r.taxCents >= 0 ? centsToMoney(r.taxCents) : "—"}</td>
        <td>{Number.isSafeInteger(r.amountCents) ? centsToMoney(r.amountCents) : "—"}</td>
        <td>{r.errors.length ? <span className="bulk-error">{r.errors.join(" · ")}</span> :
          r.warnings.length ? <span className="bulk-warn">{r.warnings.join(" · ")}</span> :
          <span className="bulk-ok">Correcto</span>}</td>
      </tr>)}</tbody></table></div>
      {preview.length > 250 && <p className="small-note">Se muestran las primeras 250 filas. Se valida la totalidad del archivo.</p>}
      <div className="bulk-actions">
        <div><strong>{counts.ready}</strong> registros por confirmar.
          <p className="small-note">El proceso guarda registros individualmente; si se interrumpe, puedes volver a cargar el mismo archivo sin duplicar sus filas identificadas.</p>
        </div>
        <button type="button" className="button-primary" disabled={uploading || parsing || counts.ready === 0} onClick={upload}>
          {uploading ? `Guardando ${progress.done}/${progress.total}…` : `Confirmar importación (${counts.ready})`}
        </button>
      </div>
      {uploading && <progress className="bulk-progress" max={progress.total || 1} value={progress.done}/>}
      {result && <div className="bulk-result" role="status">
        <strong>Resultado del lote</strong>: {result.saved} guardados · {result.skipped} omitidos por referencia existente · {result.failed} fallidos.
        {issues.map((m,i)=><p key={i} className="small-note">{m}</p>)}
      </div>}
    </section>}
  </div>;
}
