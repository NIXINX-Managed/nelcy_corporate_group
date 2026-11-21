"use client";

import { useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { firebaseServices, organizationId } from "@/lib/firebase";
import type { Customer, Entity } from "@/lib/finance";

const TEMPLATE = "NELCY-CUSTOMERS-1";
const MAX_ROWS = 1000;
const HEADERS = ["Cliente", "Código", "Contacto", "Dirección", "Identificación fiscal", "Correo", "Teléfono", "Notas"] as const;
type CustomerRow = { row: number; name: string; code: string; contactName: string; address: string; taxId: string; email: string; phone: string; notes: string; errors: string[] };
type Props = { entities: Entity[]; customers: Customer[]; uid: string };
const normalized = (s: string) => s.normalize("NFKC").trim().toLocaleLowerCase("es");
const asText = (v: unknown) => typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
const errText = (e: unknown) => e instanceof Error ? e.message : "Error inesperado de importación.";

async function excel() { return (await import("exceljs")).default; }
async function stableId(companyId: string, name: string) {
  const key = new TextEncoder().encode(`${organizationId}|customers|${companyId}|${normalized(name)}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", key));
  return "cust_" + Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
function validate(row: CustomerRow) {
  const limits: [keyof CustomerRow, number][] = [
    ["name", 160], ["code", 50], ["contactName", 160], ["address", 300],
    ["taxId", 50], ["email", 160], ["phone", 40], ["notes", 400],
  ];
  if (!row.name) row.errors.push("Nombre del cliente requerido.");
  for (const [field, max] of limits) {
    if (String(row[field]).length > max) row.errors.push(`${field}: máximo ${max} caracteres.`);
  }
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) row.errors.push("Correo inválido.");
}

export function CustomerImport({ entities, customers, uid }: Props) {
  const companies = entities.filter((e) => e.type === "company" && e.active)
    .sort((a, b) => a.name.localeCompare(b.name));
  const [companyId, setCompanyId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileCompanyId, setFileCompanyId] = useState("");
  const [preview, setPreview] = useState<CustomerRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState("");
  const ready = preview.filter((r) => r.errors.length === 0);

  async function download() {
    const company = companies.find((c) => c.id === companyId);
    if (!company) { setMessage("Primero selecciona una empresa activa."); return; }
    setBusy(true); setMessage("");
    try {
      const ExcelJS = await excel();
      const workbook = new ExcelJS.Workbook();
      const info = workbook.addWorksheet("Instrucciones");
      info.columns = [{ width: 26 }, { width: 85 }];
      info.addRows([
        ["Formato", TEMPLATE], ["Organización", organizationId],
        ["Empresa ID", company.id], ["Empresa", company.name],
        ["Uso", "Completa la hoja Clientes. No cambies los encabezados ni el ID de empresa."],
        ["Regla", "Las filas repetidas por nombre dentro de la misma empresa se omiten."],
      ]);
      const sheet = workbook.addWorksheet("Clientes", { views: [{ state: "frozen", ySplit: 1 }] });
      sheet.columns = HEADERS.map((header) => ({ header, width: header === "Cliente" ? 40 : 28 }));
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).height = 30;
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D365A" } };
      sheet.autoFilter = { from: "A1", to: "H1" };
      const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }));
      const a = document.createElement("a");
      a.href = url; a.download = "nelcy_clientes_" + company.name.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-") + "_v1.xlsx";
      document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setMessage(errText(e)); }
    finally { setBusy(false); }
  }

  async function validateFile() {
    if (!file) return;
    setBusy(true); setMessage(""); setPreview([]); setFileCompanyId("");
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 5 * 1024 * 1024) {
        throw new Error("Selecciona un archivo .xlsx de máximo 5 MB.");
      }
      const ExcelJS = await excel();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load((await file.arrayBuffer()) as Parameters<typeof workbook.xlsx.load>[0]);
      const info = workbook.getWorksheet("Instrucciones");
      const sheet = workbook.getWorksheet("Clientes");
      if (!info || !sheet || asText(info.getCell("B1").value) !== TEMPLATE ||
        asText(info.getCell("B2").value) !== organizationId) {
        throw new Error("Plantilla no reconocida o correspondiente a otra organización.");
      }
      const scoped = asText(info.getCell("B3").value);
      const company = companies.find((e) => e.id === scoped);
      if (!company) throw new Error("La empresa del archivo ya no está activa o no existe.");
      if (HEADERS.some((h, i) => asText(sheet.getCell(1, i + 1).value) !== h)) {
        throw new Error("Los encabezados fueron modificados. Descarga la plantilla nuevamente.");
      }
      if (sheet.rowCount > MAX_ROWS + 1) throw new Error("Máximo 1000 clientes por archivo.");
      const existing = new Set(customers.filter((c) => c.companyId === scoped).map((c) => normalized(c.name)));
      const seen = new Set<string>();
      const rows: CustomerRow[] = [];
      for (let i = 2; i <= sheet.rowCount; i++) {
        const values = HEADERS.map((_, col) => sheet.getCell(i, col + 1).value);
        if (values.every((v) => v == null || String(v).trim() === "")) continue;
        const fields = values.map(asText);
        const row: CustomerRow = {
          row: i, name: fields[0], code: fields[1], contactName: fields[2], address: fields[3],
          taxId: fields[4], email: fields[5], phone: fields[6], notes: fields[7], errors: [],
        };
        if (values.some((v) => v !== null && typeof v === "object")) row.errors.push("No se admiten fórmulas; pega texto.");
        validate(row);
        const key = normalized(row.name);
        if (existing.has(key)) row.errors.push("Ya existe un cliente con ese nombre en la empresa.");
        if (seen.has(key)) row.errors.push("Duplicado dentro de la plantilla.");
        seen.add(key);
        rows.push(row);
      }
      if (!rows.length) throw new Error("La hoja Clientes no contiene registros.");
      setPreview(rows); setFileCompanyId(scoped);
      setMessage(`Revisados ${rows.length} clientes de ${company.name}. Confirma solo los válidos.`);
    } catch (e) { setMessage(errText(e)); }
    finally { setBusy(false); }
  }

  async function save() {
    if (busy || !ready.length || !uid || !companies.some((c) => c.id === fileCompanyId)) return;
    setBusy(true); setMessage(""); setProgress("");
    const db = firebaseServices().db;
    let saved = 0, skipped = 0, failed = 0;
    for (const r of ready) {
      try {
        const id = await stableId(fileCompanyId, r.name);
        const reference = doc(db, "organizations", organizationId, "customers", id);
        if ((await getDoc(reference)).exists()) { skipped++; }
        else {
          await setDoc(reference, {
            companyId: fileCompanyId, name: r.name, code: r.code, contactName: r.contactName,
            address: r.address, taxId: r.taxId, email: r.email, phone: r.phone, notes: r.notes,
            active: true, createdBy: uid, createdAt: serverTimestamp(),
          });
          saved++;
        }
      } catch (e) {
        failed++;
        setMessage(`Fila ${r.row}: ${errText(e)}`);
        if (failed >= 3) break;
      }
      setProgress(`${saved + skipped + failed}/${ready.length}`);
    }
    setMessage((v) => `${v} Resultado: ${saved} creados, ${skipped} existentes, ${failed} fallidos.`);
    setPreview([]); setFile(null); setFileCompanyId(""); setBusy(false);
  }

  return <section className="panel">
    <div className="panel-title"><h2>Importación masiva de clientes</h2><span>Plantilla independiente · v1</span></div>
    <p>Los layouts actuales de ingresos y de otros catálogos no cambian. Importa únicamente clientes nuevos, separados por empresa.</p>
    <div className="bulk-toolbar">
      <label className="bulk-label">Empresa
        <select value={companyId} disabled={busy} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">Seleccionar empresa</option>
          {companies.map((e) => <option value={e.id} key={e.id}>{e.name}</option>)}
        </select>
      </label>
      <button type="button" className="button-secondary" disabled={busy || !companyId} onClick={download}>Descargar layout de clientes .xlsx</button>
    </div>
    <div className="bulk-toolbar">
      <label className="bulk-label">Archivo de clientes
        <input type="file" accept=".xlsx" disabled={busy} onChange={(e) => {
          setFile(e.target.files?.[0] ?? null); setPreview([]); setFileCompanyId(""); setMessage("");
        }}/>
      </label>
      <button type="button" className="button-secondary" disabled={busy || !file} onClick={validateFile}>Validar clientes</button>
    </div>
    {message && <p role="status" className="bulk-feedback">{message}</p>}
    {preview.length > 0 && <>
      <p>{preview.length} revisados · {ready.length} válidos · {preview.length - ready.length} con errores.</p>
      <div className="table-wrap"><table className="bulk-table"><thead><tr><th>Fila</th><th>Cliente</th><th>Resultado</th></tr></thead><tbody>
        {preview.slice(0, 100).map((r) => <tr key={r.row}><td>{r.row}</td><td>{r.name}</td>
          <td>{r.errors.length ? <span className="bulk-error">{r.errors.join(" · ")}</span> : "Correcto"}</td></tr>)}
      </tbody></table></div>
      <button type="button" className="button-primary" disabled={busy || !ready.length} onClick={save}>
        {busy ? `Importando ${progress}` : `Confirmar importación (${ready.length})`}
      </button>
    </>}
  </section>;
}
