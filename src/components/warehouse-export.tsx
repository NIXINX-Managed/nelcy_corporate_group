"use client";

import { useState } from "react";
import {
  collection, documentId, getDocs, limit, orderBy, query, startAfter,
  type DocumentData, type QueryDocumentSnapshot,
} from "firebase/firestore";
import { firebaseServices, organizationId } from "@/lib/firebase";

type FieldType = "STRING" | "DATE" | "TIMESTAMP" | "INTEGER" | "BOOLEAN";
type Field = { name: string; type: FieldType; mode: "NULLABLE" };
type Dataset = "entities" | "categories" | "customers" | "movements";
type RowValue = string | number | boolean | null;
type DataRow = Record<string, RowValue>;
const FIELDS: Record<Dataset, [string, FieldType][]> = {
  entities: [
    ["entity_id","STRING"], ["name","STRING"], ["entity_type","STRING"], ["active","BOOLEAN"],
    ["created_at_utc","TIMESTAMP"], ["created_by","STRING"],
  ],
  categories: [
    ["category_id","STRING"], ["name","STRING"], ["category_kind","STRING"], ["active","BOOLEAN"],
    ["created_at_utc","TIMESTAMP"], ["created_by","STRING"],
  ],
  customers: [
    ["customer_id","STRING"], ["company_id","STRING"], ["name","STRING"], ["code","STRING"],
    ["contact_name","STRING"], ["address","STRING"], ["tax_id","STRING"],
    ["email","STRING"], ["phone","STRING"], ["notes","STRING"], ["active","BOOLEAN"],
    ["created_at_utc","TIMESTAMP"], ["created_by","STRING"], ["updated_at_utc","TIMESTAMP"], ["updated_by","STRING"],
  ],
  movements: [
    ["movement_id","STRING"], ["transaction_date","DATE"], ["movement_kind","STRING"],
    ["from_entity_id","STRING"], ["to_entity_id","STRING"], ["category_id","STRING"],
    ["loan_id","STRING"], ["customer_id","STRING"], ["counterparty","STRING"], ["description","STRING"],
    ["amount_cents","INTEGER"], ["tax_cents","INTEGER"], ["net_amount_cents","INTEGER"],
    ["currency_code","STRING"], ["created_at_utc","TIMESTAMP"], ["created_by","STRING"],
    ["updated_at_utc","TIMESTAMP"], ["updated_by","STRING"], ["revision","INTEGER"],
    ["voided","BOOLEAN"], ["void_reason","STRING"], ["external_ref","STRING"], ["user_folio","STRING"],
    ["import_batch_id","STRING"], ["import_row","INTEGER"],
  ],
};
const META_FIELDS: [string,FieldType][] = [
  ["schema_version","STRING"], ["organization_id","STRING"], ["extracted_at_utc","TIMESTAMP"],
];
const TABLE: Record<Dataset,string> = {
  entities:"dim_entity", categories:"dim_category", customers:"dim_customer", movements:"fact_movement",
};
function schema(dataset: Dataset): Field[] {
  return [...META_FIELDS,...FIELDS[dataset]].map(([name,type])=>({name,type,mode:"NULLABLE"}));
}
function str(value: unknown): string | null { return typeof value === "string" ? value : null; }
function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}
function bool(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }
function date(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
function utc(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("toDate" in value)) return null;
  const converter = value as { toDate?: () => Date };
  if (typeof converter.toDate !== "function") return null;
  const parsed = converter.toDate();
  return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
}
function makeRow(dataset: Dataset, snap: QueryDocumentSnapshot<DocumentData>, now: string): DataRow {
  const d = snap.data();
  const base: DataRow = { schema_version:"1", organization_id:organizationId, extracted_at_utc:now };
  switch (dataset) {
    case "entities": return { ...base, entity_id:snap.id, name:str(d.name),
      entity_type:str(d.type), active:bool(d.active), created_at_utc:utc(d.createdAt), created_by:str(d.createdBy) };
    case "categories": return { ...base, category_id:snap.id, name:str(d.name),
      category_kind:str(d.kind), active:bool(d.active), created_at_utc:utc(d.createdAt), created_by:str(d.createdBy) };
    case "customers": return { ...base, customer_id:snap.id, company_id:str(d.companyId),
      name:str(d.name), code:str(d.code), contact_name:str(d.contactName), address:str(d.address),
      tax_id:str(d.taxId), email:str(d.email), phone:str(d.phone), notes:str(d.notes),
      active:bool(d.active), created_at_utc:utc(d.createdAt), created_by:str(d.createdBy),
      updated_at_utc:utc(d.updatedAt), updated_by:str(d.updatedBy) };
    case "movements": {
      const gross = integer(d.amountCents), tax = integer(d.taxCents);
      return { ...base, movement_id:snap.id, transaction_date:date(d.date),
        movement_kind:str(d.kind), from_entity_id:str(d.fromEntityId), to_entity_id:str(d.toEntityId),
        category_id:str(d.categoryId), loan_id:str(d.loanId), customer_id:str(d.customerId),
        counterparty:str(d.counterparty), description:str(d.description),
        amount_cents:gross, tax_cents:tax, net_amount_cents:gross !== null && tax !== null ? gross - tax : null,
        currency_code:"CAD", created_at_utc:utc(d.createdAt), created_by:str(d.createdBy),
        updated_at_utc:utc(d.updatedAt), updated_by:str(d.updatedBy),
        revision:integer(d.revision) ?? 0, voided:bool(d.voided) ?? false,
        void_reason:str(d.voidReason), external_ref:str(d.externalRef), user_folio:str(d.userFolio),
        import_batch_id:str(d.importBatchId), import_row:integer(d.importRow) };
    }
  }
}
function downloadFile(text: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], {type:mime}));
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  // Revocar después de que el navegador haya iniciado la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const PAGE_SIZE = 400;
const MAX_ROWS = 100000;
async function loadAll(dataset: Dataset, onProgress: (n:number)=>void) {
  const db = firebaseServices().db;
  const coll = collection(db,"organizations",organizationId,dataset);
  let previous: QueryDocumentSnapshot<DocumentData> | undefined;
  const result: QueryDocumentSnapshot<DocumentData>[] = [];
  while (true) {
    const q = previous
      ? query(coll,orderBy(documentId()),startAfter(previous),limit(PAGE_SIZE))
      : query(coll,orderBy(documentId()),limit(PAGE_SIZE));
    const page = await getDocs(q);
    if (result.length + page.size > MAX_ROWS) {
      throw new Error("La exportación supera 100,000 registros; requiere un proceso servidor para volúmenes mayores.");
    }
    result.push(...page.docs);
    onProgress(result.length);
    if (page.size < PAGE_SIZE) break;
    previous = page.docs[page.docs.length-1];
  }
  return result;
}
export function WarehouseExport() {
  const [dataset,setDataset] = useState<Dataset>("movements");
  const [busy,setBusy] = useState(false);
  const [progress,setProgress] = useState(0);
  const [notice,setNotice] = useState("");
  async function run() {
    setBusy(true); setProgress(0); setNotice("");
    try {
      const extractedAt = new Date().toISOString();
      const docs = await loadAll(dataset, setProgress);
      const orderedFields = schema(dataset).map((f)=>f.name);
      const lines = docs.map((snap)=>{
        const row = makeRow(dataset,snap,extractedAt);
        return JSON.stringify(Object.fromEntries(orderedFields.map((key)=>[key,row[key] ?? null])));
      });
      const suffix = extractedAt.replace(/[-:]/g,"").replace(/\.\d{3}/,"").replace("T","_");
      downloadFile(lines.join("\n") + (lines.length ? "\n" : ""),
        `nelcy_${TABLE[dataset]}_v1_${suffix}.ndjson`, "application/x-ndjson;charset=utf-8");
      setNotice(`Exportados ${docs.length} registros de ${TABLE[dataset]}. Incluye registros anulados e identificadores originales.`);
    } catch (e) { setNotice(e instanceof Error ? e.message : "No se pudo exportar."); }
    finally { setBusy(false); }
  }
  function downloadSchema() {
    downloadFile(JSON.stringify(schema(dataset),null,2)+"\n", `bq_schema_${TABLE[dataset]}_v1.json`, "application/json;charset=utf-8");
  }
  return <section className="panel">
    <div className="panel-title"><h2>Exportación para Data Warehouse</h2><span>BigQuery · NDJSON · esquema v1</span></div>
    <p>Exporta datos reales de Firestore, sin modificar ni duplicar movimientos. Un archivo por tabla y un esquema compatible con BigQuery. Los importadores Excel existentes permanecen intactos.</p>
    <div className="bulk-toolbar">
      <label className="bulk-label">Tabla
        <select value={dataset} disabled={busy} onChange={(e)=>{setDataset(e.target.value as Dataset);setNotice("");}}>
          <option value="movements">Movimientos (fact_movement)</option>
          <option value="entities">Empresas y personal (dim_entity)</option>
          <option value="categories">Conceptos (dim_category)</option>
          <option value="customers">Clientes (dim_customer)</option>
        </select>
      </label>
      <button type="button" className="button-primary" disabled={busy} onClick={run}>{busy ? `Leyendo ${progress} registros…` : "Exportar datos .ndjson"}</button>
      <button type="button" className="button-secondary" disabled={busy} onClick={downloadSchema}>Descargar esquema BigQuery .json</button>
    </div>
    <p className="small-note">Incluye todas las empresas, todos los ejercicios y movimientos anulados, marcados como tales. Los importes se exportan en centavos enteros (CAD), las fechas en AAAA-MM-DD y los timestamps en UTC. Cada movimiento aparece una sola vez, incluso entre compañías.</p>
    <p className="small-note">Esta descarga manual no es una sincronización automática ni una instantánea transaccional: pueden producirse cambios durante la lectura. El archivo de clientes puede contener datos personales; almacénalo en un destino seguro.</p>
    {notice && <p role="status" className="bulk-feedback">{notice}</p>}
  </section>;
}
