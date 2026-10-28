import type { Category, Customer, Entity, Movement, MovementKind } from "@/lib/finance";
import { dollarsToCents, movementLabels } from "@/lib/finance";

export const BULK_VERSION = "NELCY-LAYOUT-3";
const OLD_BULK_VERSION = "NELCY-LAYOUT-2";
export const BULK_HEADERS = [
  "Folio del usuario (opcional)", "Fecha (AAAA-MM-DD)", "Entidad origen", "Entidad destino",
  "Concepto", "Importe total (CAD)", "Impuestos incluidos (CAD)",
  "Cliente (solo ingresos; opcional)", "Contraparte / proveedor", "Observaciones", "ID préstamo original",
] as const;
const OLD_BULK_HEADERS = [
  "Folio del usuario (opcional)", "Fecha (AAAA-MM-DD)", "Entidad origen", "Entidad destino",
  "Concepto", "Importe total (CAD)", "Impuestos incluidos (CAD)",
  "Contraparte / proveedor", "Observaciones", "ID préstamo original",
] as const;
export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const ordinaryKinds = ["income", "cost", "expense"];
export const ALL_KINDS = Object.keys(movementLabels) as MovementKind[];

export type ImportableMovement = {
  date: string;
  kind: MovementKind;
  fromEntityId: string | null;
  toEntityId: string | null;
  categoryId: string | null;
  loanId: string | null;
  counterparty: string;
  description: string;
  amountCents: number;
  taxCents: number;
  userFolio?: string;
  customerId?: string;
};
export type PreviewLine = {
  row: number;
  userFolio: string;
  date: string;
  entityText: string;
  customerText: string;
  amountCents: number;
  docId: string;
  data: ImportableMovement | null;
  errors: string[];
  warnings: string[];
};

function trimValue(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string" || typeof raw === "number") return String(raw).trim();
  if (raw instanceof Date) {
    const year = raw.getFullYear();
    return `${year}-${String(raw.getMonth() + 1).padStart(2, "0")}-${String(raw.getDate()).padStart(2, "0")}`;
  }
  if (typeof raw === "object" && "text" in raw && typeof raw.text === "string") return raw.text.trim();
  return "";
}
function isFormula(raw: unknown) {
  return typeof raw === "object" && raw !== null && ("formula" in raw || "sharedFormula" in raw);
}
function moneyValue(raw: unknown): number {
  if (isFormula(raw)) return NaN;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || Math.abs(raw * 100 - Math.round(raw * 100)) > 0.000001) return NaN;
    return Math.round(raw * 100);
  }
  const text = trimValue(raw);
  return dollarsToCents(text.replace(/,/g, ""));
}
function dateValue(raw: unknown): string {
  if (isFormula(raw)) return "";
  if (raw instanceof Date) return trimValue(raw);
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 1 || raw > 2958465) return "";
    return new Date(Math.round((raw - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const v = trimValue(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "";
  const parsed = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== v ? "" : v;
}
function token(id: string, name: string) { return `${name} [${id}]`; }
function pickByName<T extends { id: string; name: string }>(v: string, items: T[]): T | null {
  if (!v) return null;
  const matches = items.filter((x) => x.id === v || token(x.id, x.name) === v);
  if (matches.length === 1) return matches[0];
  const names = items.filter((x) => x.name.normalize("NFKC").trim().toLocaleLowerCase("es") === v.normalize("NFKC").trim().toLocaleLowerCase("es"));
  return names.length === 1 ? names[0] : null;
}
function customerToken(c: Customer, entities: Entity[]) {
  const owner = entities.find((e) => e.id === c.companyId)?.name ?? "Empresa desconocida";
  const code = c.code ? ` · ${c.code}` : "";
  return `${c.name}${code} — ${owner} [${c.id}]`;
}
function customerFromText(text: string, companyId: string, customers: Customer[], entities: Entity[]): Customer | null {
  if (!text || !companyId) return null;
  const normalized = (v: string) => v.normalize("NFKC").trim().toLocaleLowerCase("es");
  const available = customers.filter((c) => c.active && c.companyId === companyId);
  const exact = available.filter((c) => c.id === text || customerToken(c, entities) === text);
  if (exact.length === 1) return exact[0];
  // También se admite el código o nombre si son inequívocos dentro de la empresa.
  const byCode = available.filter((c) => c.code && normalized(c.code) === normalized(text));
  if (byCode.length === 1) return byCode[0];
  const byName = available.filter((c) => normalized(c.name) === normalized(text));
  return byName.length === 1 ? byName[0] : null;
}
function loanToken(m: Movement) { return `${m.date}: ${m.counterparty || m.description || "Préstamo"} [${m.id}]`; }
function loanFromText(text: string, movements: Movement[]): Movement | null {
  const loans = movements.filter((m) => m.kind === "loan");
  return loans.find((m) => m.id === text || loanToken(m) === text) ?? null;
}
async function excelJs() {
  const mod = await import("exceljs");
  return mod.default;
}
function filenameDownload(data: BlobPart, filename: string) {
  const file = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadLayout(kind: MovementKind, entities: Entity[], categories: Category[], customers: Customer[], movements: Movement[]) {
  const ExcelJS = await excelJs();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Nelcy Corporate Group";
  const info = wb.addWorksheet("Instrucciones");
  info.columns = [{ width: 35 }, { width: 95 }];
  info.addRow(["Formato de importación", BULK_VERSION]);
  info.addRow(["Tipo de operación", kind]);
  info.addRow(["Nombre", movementLabels[kind]]);
  info.addRow(["Uso", "Una hoja por tipo de operación. No renombrar 'Movimientos' ni cambiar los encabezados."]);
  info.addRow(["Folio del usuario", "Opcional. Puedes escribir tu factura/folio. La referencia interna se genera únicamente al confirmar la importación, nunca en el layout ni en la vista previa."]);
  info.addRow(["Fecha", "AAAA-MM-DD. También puedes usar una fecha real de Excel."]);
  info.addRow(["Impuestos", "Incluidos en el total. No se agregan al importe. Cero para préstamos, retiros y transferencias."]);
  info.addRow(["Catálogos", "Usa los valores de las listas de Excel o los IDs exactos mostrados en la pestaña Catálogos."]);
  info.addRow(["Clientes", "En INGRESOS puedes seleccionar un cliente de la pestaña Catalogos. Debe pertenecer a la Entidad destino (compañía). Para ventas generales, déjalo vacío."]);
  info.addRow(["Préstamos", "Para abonos, indica un préstamo existente y usa origen/destino invertidos."]);
  info.addRow(["Seguridad", "El archivo se valida en el navegador. Se guardan los movimientos confirmados, no el Excel."]);
  info.addRow(["Reimportación", "Con folio: se impide repetir el mismo folio por tipo y entidades. Sin folio: se detecta por contenido y ocurrencia; si dos movimientos son iguales usa folios diferentes."]);
  info.getRow(1).font = { bold: true, size: 13, color: { argb: "FF12365B" } };
  for (let i = 1; i <= 12; i++) { info.getCell(i, 1).font = { bold: true }; info.getRow(i).height = 26; }
  const catalog = wb.addWorksheet("Catalogos");
  const active = entities.filter((e) => e.active).sort((a,b) => a.name.localeCompare(b.name));
  const relevant = categories.filter((c) => c.active && c.kind === kind).sort((a,b) => a.name.localeCompare(b.name));
  const loans = movements.filter((m) => m.kind === "loan").sort((a,b)=> b.date.localeCompare(a.date));
  const activeCompanies = new Set(active.filter((e) => e.type === "company").map((e) => e.id));
  const activeCustomers = kind === "income" ? customers.filter((c) => c.active && activeCompanies.has(c.companyId)).sort((a,b) => a.companyId.localeCompare(b.companyId) || a.name.localeCompare(b.name)) : [];
  catalog.columns = [
    { header: "Entidades", width: 54 }, { header: "Conceptos", width: 54 },
    { header: "Préstamos existentes", width: 74 }, { header: "Clientes activos (empresa indicada)", width: 92 },
  ];
  for (let i = 0; i < Math.max(active.length, relevant.length, loans.length, activeCustomers.length); i++) {
    catalog.addRow([
      active[i] ? token(active[i].id, active[i].name) : "",
      relevant[i] ? token(relevant[i].id, relevant[i].name) : "",
      loans[i] ? loanToken(loans[i]) : "",
      activeCustomers[i] ? customerToken(activeCustomers[i], entities) : "",
    ]);
  }
  catalog.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  catalog.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF244C7D" } };
  const ws = wb.addWorksheet("Movimientos", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = BULK_HEADERS.map((header, i) => ({ header, width: [30, 22, 52, 52, 52, 23, 27, 80, 35, 55, 70][i] }));
  ws.getRow(1).height = 33;
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D365A" } };
  ws.autoFilter = { from: "A1", to: "K1" };
  if (active.length) wb.definedNames.add(`Catalogos!$A$2:$A$${active.length + 1}`, "ListaEntidades");
  if (relevant.length) wb.definedNames.add(`Catalogos!$B$2:$B$${relevant.length + 1}`, "ListaConceptos");
  if (loans.length) wb.definedNames.add(`Catalogos!$C$2:$C$${loans.length + 1}`, "ListaPrestamos");
  if (activeCustomers.length) wb.definedNames.add(`Catalogos!$D$2:$D$${activeCustomers.length + 1}`, "ListaClientes");
  for (let row = 2; row <= 501; row++) {
    ws.getCell(row, 2).numFmt = "yyyy-mm-dd";
    ws.getCell(row, 6).numFmt = "#,##0.00";
    ws.getCell(row, 7).numFmt = "#,##0.00";
    if (active.length) for (const col of [3,4]) ws.getCell(row,col).dataValidation = { type: "list", allowBlank: true, formulae: ["ListaEntidades"], showErrorMessage: true, errorTitle: "Entidad inválida", error: "Selecciona una entidad de Catalogos" };
    if (relevant.length) ws.getCell(row,5).dataValidation = { type: "list", allowBlank: true, formulae: ["ListaConceptos"], showErrorMessage: true, errorTitle: "Concepto inválido", error: "Selecciona un concepto de Catalogos" };
    if (loans.length && kind === "loan_repayment") ws.getCell(row,11).dataValidation = { type: "list", allowBlank: true, formulae: ["ListaPrestamos"] };
    if (kind === "income" && activeCustomers.length) ws.getCell(row,8).dataValidation = {
      type: "list", allowBlank: true, formulae: ["ListaClientes"],
      showErrorMessage: true, errorTitle: "Cliente no registrado", error: "Selecciona un cliente del catálogo. Debe pertenecer a la entidad destino.",
    };
  }
  const bytes = await wb.xlsx.writeBuffer();
  // ExcelJS returns a Uint8Array/Buffer; copy into a standard ArrayBuffer for Blob compatibility.
  const u8 = new Uint8Array(bytes);
  filenameDownload(u8.slice().buffer, `nelcy_${kind}_layout_v3.xlsx`);
}

async function stableId(fields: string[]): Promise<string> {
  const contents = new TextEncoder().encode(fields.join("\u001f"));
  const hash = await crypto.subtle.digest("SHA-256", contents);
  return `imp_${Array.from(new Uint8Array(hash)).map((x)=>x.toString(16).padStart(2,"0")).join("").slice(0,40)}`;
}
const signature = (m: ImportableMovement | Movement) => {
  const fields = [
    m.date, m.kind, m.fromEntityId ?? "", m.toEntityId ?? "", m.categoryId ?? "",
    m.loanId ?? "", m.amountCents, m.taxCents, m.counterparty.toLocaleLowerCase("es"), m.description.toLocaleLowerCase("es"),
  ];
  // Mantener exactamente la firma anterior cuando no hay cliente para no duplicar
  // movimientos sin folio ya importados con layouts v2.
  if (m.customerId) fields.push(m.customerId);
  return fields.join("\u001f");
};

export async function parseBulkFile(file: File, entities: Entity[], categories: Category[], customers: Customer[], existing: Movement[], orgId: string) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error("El archivo supera los 5 MB. Divide la carga en varios Excel.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Selecciona un archivo .xlsx generado con esta aplicación.");
  const ExcelJS = await excelJs();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await file.arrayBuffer()) as Parameters<typeof wb.xlsx.load>[0]);
  const info = wb.getWorksheet("Instrucciones");
  const ws = wb.getWorksheet("Movimientos");
  const layoutVersion = info ? trimValue(info.getCell("B1").value) : "";
  if (!ws || !info || ![BULK_VERSION, OLD_BULK_VERSION].includes(layoutVersion)) {
    throw new Error("Formato no reconocido. Descarga el layout de Nelcy y coloca allí tus registros.");
  }
  const kind = trimValue(info.getCell("B2").value) as MovementKind;
  if (!ALL_KINDS.includes(kind)) throw new Error("El tipo de movimiento del layout no es válido.");
  const headers = layoutVersion === OLD_BULK_VERSION ? OLD_BULK_HEADERS : BULK_HEADERS;
  for (let i = 0; i < headers.length; i++) {
    if (trimValue(ws.getCell(1, i+1).value) !== headers[i]) throw new Error(`Encabezado incorrecto en columna ${i+1}. Usa un layout sin modificar.`);
  }
  if (ws.rowCount > MAX_IMPORT_ROWS + 1) throw new Error(`Máximo ${MAX_IMPORT_ROWS} filas por archivo. Divide la carga.`);
  const activeEntities = entities.filter((e)=>e.active);
  const categoriesOfKind = categories.filter((c)=>c.active && c.kind === kind);
  const existingIds = new Set(existing.map((m)=>m.id));
  const existingById = new Map<string, Movement>(existing.map((m): [string, Movement] => [m.id, m]));
  const existingSignatures = new Set(existing.map(signature));
  const seenIds = new Set<string>();
  const seenSignatures = new Set<string>();
  const occurrenceCount = new Map<string, number>();
  const rows: PreviewLine[] = [];
  let totalCents = 0;
  const reservedPayments = new Map<string,number>();
  for (let row = 2; row <= ws.rowCount; row++) {
    const values = Array.from({ length: headers.length }, (_, col) => ws.getCell(row, col+1).value);
    // El layout no contiene identificadores precargados. Ignorar filas totalmente vacías.
    if (values.every((v) => v === null || v === undefined || String(v).trim() === "")) continue;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (values.some(isFormula)) errors.push("No se admiten fórmulas en los campos de captura; pega valores.");
    const userFolio = trimValue(values[0]);
    if (userFolio.length > 100) errors.push("El folio del usuario supera 100 caracteres.");
    const date = dateValue(values[1]);
    if (!date) errors.push("Fecha inválida: usa AAAA-MM-DD o una fecha de Excel.");
    const fromText = trimValue(values[2]);
    const toText = trimValue(values[3]);
    const from = pickByName(fromText, activeEntities);
    const to = pickByName(toText, activeEntities);
    const categoryText = trimValue(values[4]);
    const category = pickByName(categoryText, categoriesOfKind);
    const amountCents = moneyValue(values[5]);
    const taxCents = trimValue(values[6]) === "" ? 0 : moneyValue(values[6]);
    const oldLayout = layoutVersion === OLD_BULK_VERSION;
    const customerText = oldLayout ? "" : trimValue(values[7]);
    const inputCounterparty = trimValue(values[oldLayout ? 7 : 8]);
    const description = trimValue(values[oldLayout ? 8 : 9]);
    const loanText = trimValue(values[oldLayout ? 9 : 10]);
    const selectedCustomer = kind === "income" && to
      ? customerFromText(customerText, to.id, customers, entities) : null;
    const counterparty = selectedCustomer ? selectedCustomer.name : inputCounterparty;
    if (customerText && kind !== "income") errors.push("El campo Cliente solo se utiliza para ingresos.");
    if (kind === "income" && customerText && !selectedCustomer) errors.push("Cliente inexistente, inactivo o de otra compañía. Revisa la Entidad destino y la pestaña Catalogos.");
    if (selectedCustomer && inputCounterparty && inputCounterparty.normalize("NFKC").trim().toLocaleLowerCase("es") !== selectedCustomer.name.normalize("NFKC").trim().toLocaleLowerCase("es")) {
      errors.push("La contraparte no coincide con el cliente elegido. Déjala vacía o escribe el nombre del cliente.");
    }
    const loan = loanFromText(loanText, existing);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 100000000000) errors.push("Importe inválido: utiliza un número positivo con máximo dos decimales.");
    if (!Number.isSafeInteger(taxCents) || taxCents < 0 || taxCents > amountCents) errors.push("Impuesto inválido: no puede superar el importe.");
    if (counterparty.length > 160 || description.length > 500) errors.push("Contraparte u observaciones exceden el límite permitido.");
    const ordinary = ordinaryKinds.includes(kind);
    const requiresFrom = kind !== "income";
    const requiresTo = kind !== "cost" && kind !== "expense";
    if (requiresFrom && !from) errors.push("Origen no válido o ambiguo. Selecciona uno del catálogo.");
    if (requiresTo && !to) errors.push("Destino no válido o ambiguo. Selecciona uno del catálogo.");
    if (!requiresFrom && fromText) errors.push("Un ingreso no lleva entidad de origen.");
    if (!requiresTo && toText) errors.push("Este tipo de movimiento no lleva entidad de destino.");
    if (ordinary && !category) errors.push("Concepto inexistente, inactivo o de otra clasificación.");
    if (!ordinary && categoryText) errors.push("Este tipo no debe llevar concepto de ingreso/costo/gasto.");
    if (!ordinary && taxCents !== 0) errors.push("Impuestos incluidos deben ser 0 para transferencias, préstamos y retiros.");
    if (from && to && from.id === to.id) errors.push("Origen y destino deben ser distintos.");
    if (kind === "personal_draw" && (from?.type !== "company" || to?.type !== "personal")) errors.push("Retiro personal: origen empresa y destino personal.");
    if (kind === "loan_repayment") {
      if (!loan) errors.push("Selecciona un préstamo original existente.");
      else {
        if (from?.id !== loan.toEntityId || to?.id !== loan.fromEntityId) errors.push("El abono debe invertir origen y destino del préstamo.");
        const paid = existing.filter((m)=>m.kind === "loan_repayment" && m.loanId === loan.id).reduce((s,m)=>s+m.amountCents,0);
        const reserved = reservedPayments.get(loan.id) ?? 0;
        if (Number.isSafeInteger(amountCents) && amountCents > loan.amountCents - paid - reserved) errors.push("Abono supera el saldo nominal pendiente del préstamo.");
      }
    } else if (loanText) errors.push("El ID de préstamo solo aplica a abonos.");
    const movement: ImportableMovement = {
      date, kind, fromEntityId: requiresFrom ? from?.id ?? null : null,
      toEntityId: requiresTo ? to?.id ?? null : null,
      categoryId: ordinary ? category?.id ?? null : null,
      loanId: kind === "loan_repayment" ? loan?.id ?? null : null,
      amountCents, taxCents, counterparty, description,
      ...(selectedCustomer ? { customerId: selectedCustomer.id } : {}),
      ...(userFolio ? { userFolio } : {}),
    };
    const rowSignature = signature(movement);
    const occurrence = (occurrenceCount.get(rowSignature) ?? 0) + 1;
    occurrenceCount.set(rowSignature, occurrence);
    // Con folio la identidad es el folio por tipo y entidades; sin folio se basa en
    // el contenido normalizado y la ocurrencia (idempotente al reimportar el mismo archivo).
    const docId = userFolio
      ? await stableId([orgId, "folio", kind, movement.fromEntityId ?? "", movement.toEntityId ?? "", userFolio.normalize("NFKC").trim().toLocaleLowerCase("es")])
      : await stableId([orgId, "sin-folio", rowSignature, String(occurrence)]);
    if (seenIds.has(docId)) errors.push("Folio duplicado dentro del archivo para este tipo y entidades.");
    seenIds.add(docId);
    if (existingIds.has(docId)) {
      const previous = existingById.get(docId);
      errors.push(previous && signature(previous) !== rowSignature
        ? "Este folio ya existe con datos distintos. No se modificará: revísalo manualmente."
        : "Movimiento ya importado; no se volverá a guardar.");
    }
    if (existingSignatures.has(rowSignature) && !existingIds.has(docId)) warnings.push("Coincide con un movimiento existente: posible duplicado.");
    if (seenSignatures.has(rowSignature) && !existingIds.has(docId)) warnings.push("Coincide con otra fila del mismo Excel: revísala.");
    seenSignatures.add(rowSignature);
    if (errors.length === 0) {
      totalCents += amountCents;
      if (kind === "loan_repayment" && loan) reservedPayments.set(loan.id, (reservedPayments.get(loan.id) ?? 0) + amountCents);
    }
    rows.push({ row, userFolio, date, entityText: fromText || toText, customerText: selectedCustomer?.name ?? customerText, amountCents, docId,
      data: errors.length ? null : movement, errors, warnings });
  }
  if (!rows.length) throw new Error("No hay movimientos para importar. Completa al menos una fila del Excel.");
  return { kind, rows, totalCents };
}
