"use client";

import { useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { firebaseServices, organizationId } from "@/lib/firebase";
import type { Category, Entity } from "@/lib/finance";

const TEMPLATE_ID = "NELCY-CATALOG-1";
type CatalogType = "entities" | "categories";
type CatalogEntry = { row: number; name: string; type: string; errors: string[] };
type Props = { catalogType: CatalogType; entities: Entity[]; categories: Category[]; uid: string };
const label = (catalogType: CatalogType) => catalogType === "entities" ? "Empresas y personal" : "Conceptos financieros";
const allowedValues = (catalogType: CatalogType) => catalogType === "entities" ? ["Empresa", "Personal"] : ["Ingreso", "Costo", "Gasto"];
const catalogHeader = (catalogType: CatalogType) => catalogType === "entities" ? "Tipo (Empresa/Personal)" : "Clasificación (Ingreso/Costo/Gasto)";
function catalogCode(catalogType: CatalogType, value: string) {
  const clean = normalize(value);
  const values: Record<string,string> = catalogType === "entities" ?
    { empresa: "company", company: "company", personal: "personal" } :
    { ingreso: "income", ingresos: "income", income: "income", costo: "cost", costos: "cost", cost: "cost", gasto: "expense", gastos: "expense", expense: "expense" };
  return values[clean] ?? "";
}
const normalize = (v: string) => v.normalize("NFKC").trim().toLocaleLowerCase("es");
async function stableCatalogId(orgId: string, catalogType: CatalogType, name: string, type: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${orgId}|${catalogType}|${normalize(name)}|${type}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `cat_${Array.from(hash).map((x)=>x.toString(16).padStart(2,"0")).join("").slice(0,40)}`;
}
const asText = (v: unknown): string => typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
async function getExcelJS() { return (await import("exceljs")).default; }
async function download(catalogType: CatalogType) {
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  const info = wb.addWorksheet("Instrucciones");
  info.columns = [{ width: 28 }, { width: 85 }];
  info.addRow(["Formato", TEMPLATE_ID]);
  info.addRow(["Catálogo", catalogType]);
  info.addRow(["Uso", "Copia tus registros de Excel a la hoja Catalogo. Usa las opciones de la lista desplegable para el tipo."]);
  info.addRow(["Precaución", "El mismo nombre dentro de una clasificación solo se importa una vez. No cambies los encabezados."]);
  const ws = wb.addWorksheet("Catalogo", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [{ header: "Nombre", width: 58 }, { header: catalogHeader(catalogType), width: 45 }];
  ws.getRow(1).height = 30;
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D365A" } };
  ws.autoFilter = { from: "A1", to: "B1" };
  for (let row = 2; row <= 501; row++) {
    ws.getCell(row, 2).dataValidation = {
      type: "list", allowBlank: true,
      formulae: [`\"${allowedValues(catalogType).join(",")}\"`],
      showErrorMessage: true, errorTitle: "Tipo no permitido", error: "Selecciona una opción de la lista",
    };
  }
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `nelcy_catalogo_${catalogType}.xlsx`;
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
async function parse(file: File, catalogType: CatalogType, entities: Entity[], categories: Category[]): Promise<CatalogEntry[]> {
  if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 5 * 1024 * 1024) throw new Error("Selecciona un .xlsx de máximo 5 MB.");
  const ExcelJS = await getExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await file.arrayBuffer()) as Parameters<typeof wb.xlsx.load>[0]);
  const info = wb.getWorksheet("Instrucciones");
  const ws = wb.getWorksheet("Catalogo");
  if (asText(info?.getCell("B1").value) !== TEMPLATE_ID || asText(info?.getCell("B2").value) !== catalogType || !ws) throw new Error("Este archivo no corresponde al layout del catálogo seleccionado.");
  const headers = ["Nombre", catalogHeader(catalogType)];
  if (headers.some((value, index) => asText(ws.getCell(1, index+1).value) !== value)) throw new Error("Encabezados modificados: descarga nuevamente la plantilla.");
  if (ws.rowCount > 1001) throw new Error("Máximo 1000 registros por archivo.");
  const existing = new Set((catalogType === "entities" ? entities.map((x)=>`${normalize(x.name)}|${x.type}`) : categories.map((x)=>`${normalize(x.name)}|${x.kind}`)));
  const seen = new Set<string>();
  const rows: CatalogEntry[] = [];
  for (let row = 2; row <= ws.rowCount; row++) {
    const a = ws.getCell(row, 1).value;
    const b = ws.getCell(row, 2).value;
    if (a == null && b == null) continue;
    const name = asText(a); const type = catalogCode(catalogType, asText(b));
    const errors: string[] = [];
    if ((typeof a === "object" && a !== null) || (typeof b === "object" && b !== null)) errors.push("No se admiten fórmulas; pega texto.");
    if (!name || name.length > 100) errors.push("Nombre requerido (máximo 100 caracteres).");
    if (!type) errors.push("Tipo/clasificación no válido.");
    const key = `${normalize(name)}|${type}`;
    if (existing.has(key)) errors.push("Ya existe en Firestore con esa clasificación.");
    if (seen.has(key)) errors.push("Duplicado dentro del archivo.");
    seen.add(key);
    rows.push({ row, name, type, errors });
  }
  if (!rows.length) throw new Error("El archivo no contiene registros.");
  return rows;
}

export function CatalogImport({ catalogType, entities, categories, uid }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<CatalogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState("");
  const good = rows.filter((r)=>r.errors.length === 0);
  async function prepare() {
    setBusy(true); setMessage("");
    try { await download(catalogType); }
    catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo descargar el layout."); }
    finally { setBusy(false); }
  }
  async function validate() {
    if (!file) return;
    setBusy(true); setRows([]); setMessage("");
    try { const result = await parse(file, catalogType, entities, categories); setRows(result); setMessage(`Revisados ${result.length} registros.`); }
    catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo leer el Excel."); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!good.length || busy) return;
    setBusy(true); setMessage("");
    let saved = 0; let failed = 0; let skipped = 0;
    const db = firebaseServices().db;
    for (const r of good) {
      try {
        const documentId = await stableCatalogId(organizationId, catalogType, r.name, r.type);
        const ref = doc(db, "organizations", organizationId, catalogType, documentId);
        const present = await getDoc(ref);
        if (present.exists()) { skipped++; setProgress(`${saved + failed + skipped}/${good.length}`); continue; }
        await setDoc(ref, catalogType === "entities" ? {
          name: r.name, type: r.type, active: true, createdBy: uid, createdAt: serverTimestamp(),
        } : { name: r.name, kind: r.type, active: true, createdBy: uid, createdAt: serverTimestamp() });
        saved++;
      } catch { failed++; }
      setProgress(`${saved + failed + skipped}/${good.length}`);
      if (failed >= 3) { setMessage("Se detuvo el proceso tras tres errores. Comprueba los registros creados antes de reintentar."); break; }
    }
    setMessage((v)=>`${v} Resultado: ${saved} guardados, ${skipped} omitidos y ${failed} fallidos.`);
    setBusy(false);
    setRows([]); setFile(null);
  }
  return <section className="panel bulk-catalog-panel">
    <div className="panel-title"><h2>Importación masiva de {label(catalogType).toLowerCase()}</h2><span>Formato Excel (.xlsx)</span></div>
    <p>Descarga el layout, copia tus datos históricos y valida los nombres antes de guardarlos. Los duplicados detectados no se importan.</p>
    <div className="bulk-toolbar">
      <button type="button" className="button-secondary" disabled={busy} onClick={prepare}>Descargar layout de catálogo</button>
      <label className="bulk-label">Seleccionar Excel
        <input type="file" accept=".xlsx" disabled={busy} onChange={(e)=>{setFile(e.target.files?.[0] ?? null);setRows([]);setMessage("");}} />
      </label>
      <button type="button" className="button-secondary" disabled={busy || !file} onClick={validate}>Validar catálogo</button>
    </div>
    {message && <p className="bulk-feedback" role="status">{message}</p>}
    {rows.length > 0 && <>
      <div className="bulk-metrics"><div><strong>{rows.length}</strong><span>Registros</span></div>
        <div><strong>{good.length}</strong><span>Válidos</span></div><div><strong>{rows.length - good.length}</strong><span>Con errores / duplicados</span></div></div>
      <div className="table-wrap"><table className="bulk-table"><thead><tr><th>Fila</th><th>Nombre</th><th>Tipo</th><th>Validación</th></tr></thead>
        <tbody>{rows.slice(0, 150).map((r)=><tr key={r.row}><td>{r.row}</td><td>{r.name}</td><td>{r.type}</td>
          <td>{r.errors.length ? <span className="bulk-error">{r.errors.join(" · ")}</span> : <span className="bulk-ok">Correcto</span>}</td></tr>)}</tbody></table></div>
      {rows.length > 150 && <p className="small-note">Vista previa limitada a 150 filas; se validó el archivo completo.</p>}
      <div className="bulk-actions"><span>{busy ? `Procesando ${progress}` : `${good.length} registros listos`}</span>
        <button type="button" className="button-primary" disabled={busy || !good.length} onClick={save}>Confirmar creación de catálogos</button></div>
    </>}
  </section>;
}
