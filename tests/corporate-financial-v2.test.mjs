import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import ExcelJS from "exceljs";
const require=createRequire(import.meta.url);
function compile(relative,aliases={}){
  const source=readFileSync(new URL("../"+relative,import.meta.url),"utf8");
  const output=ts.transpileModule(source,{fileName:relative,compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX
  }}).outputText;
  const local={exports:{}};
  new Function("module","exports","require",output)(local,local.exports,(name)=>aliases[name]??require(name));
  return local.exports;
}
const fin=compile("src/lib/finance.ts");
const bulk=compile("src/lib/bulk-excel.ts",{"@/lib/finance":fin});
const entities=[{id:"cat",name:"CAT",type:"company",active:true},{id:"personal",name:"Nelcy",type:"personal",active:true}];
const categories=[{id:"payroll",name:"Payroll",kind:"cost",active:true}];
const accounts=[{id:"rbc",companyId:"cat",name:"RBC",active:true},{id:"cash",companyId:"cat",name:"Cash",active:true}];
const methods=[{id:"etransfer",name:"E-Transfer",active:true}];
const types=[{id:"cash-transfer",name:"Retiros",kind:"account_transfer",active:true}];
function workbook(version,kind,scoped){
  const wb=new ExcelJS.Workbook();
  const info=wb.addWorksheet("Instrucciones");
  info.getCell("B1").value=version;
  info.getCell("B2").value=kind;
  if(scoped)info.getCell("B3").value="cat";
  const sheet=wb.addWorksheet("Movimientos");
  return {wb,sheet};
}
async function parse(wb){
  const raw=await wb.xlsx.writeBuffer();
  const file={name:"nelcy-test.xlsx",size:raw.byteLength,arrayBuffer:async()=>raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)};
  return bulk.parseBulkFile(file,entities,categories,[],[], "nelcy-group",accounts,methods,types);
}
const scopedCost=["Fecha (AAAA-MM-DD)","Concepto","Costo antes de impuestos (CAD)","Total pagado (CAD)","Contraparte / proveedor","Observaciones"];
test("existing v5 cost layout and net-before-tax amounts remain compatible",async()=>{
  const {wb,sheet}=workbook("NELCY-LAYOUT-5","cost",true);
  sheet.addRow(scopedCost);
  sheet.addRow(["2026-07-01","Payroll",1305,1500,"Vendor","Original"]);
  const result=await parse(wb);
  assert.equal(result.rows.length,1);
  assert.deepEqual(result.rows[0].errors,[]);
  assert.equal(result.rows[0].data.amountCents,150000);
  assert.equal(result.rows[0].data.taxCents,19500);
});
test("total without receipt uses HST zero, subtotal equal to total",async()=>{
  const {wb,sheet}=workbook("NELCY-LAYOUT-5","cost",true);
  sheet.addRow(scopedCost);
  sheet.addRow(["2026-07-02","Payroll",null,1500,"Vendor","No receipt"]);
  const result=await parse(wb);
  assert.deepEqual(result.rows[0].errors,[]);
  assert.equal(result.rows[0].netCents,150000);
  assert.equal(result.rows[0].taxCents,0);
});
test("optional trailing HST/account/payment fields are imported per transaction",async()=>{
  const {wb,sheet}=workbook("NELCY-LAYOUT-5","cost",true);
  sheet.addRow([...scopedCost,"HST incluido (CAD) (opcional)","Cuenta origen (opcional)","Cuenta destino (opcional)","Forma de pago (opcional)","Clasificación (opcional)"]);
  sheet.addRow(["2026-07-03","Payroll",null,1500,"Vendor","With receipt",195,"RBC [rbc]","","E-Transfer [etransfer]",""]);
  const result=await parse(wb);
  assert.deepEqual(result.rows[0].errors,[]);
  assert.equal(result.rows[0].netCents,130500);
  assert.equal(result.rows[0].taxCents,19500);
  assert.equal(result.rows[0].data.fromAccountId,"rbc");
  assert.equal(result.rows[0].data.paymentMethodId,"etransfer");
});
test("own-company withdrawal from RBC to petty cash is not an operating expense",async()=>{
  const {wb,sheet}=workbook("NELCY-LAYOUT-3","account_transfer",false);
  sheet.addRow([
    "Folio del usuario (opcional)","Fecha (AAAA-MM-DD)","Entidad origen","Entidad destino",
    "Concepto","Importe total (CAD)","Impuestos incluidos (CAD)",
    "Cliente (solo ingresos; opcional)","Contraparte / proveedor","Observaciones","ID préstamo original",
    "Cuenta origen (opcional)","Cuenta destino (opcional)","Forma de pago (opcional)","Clasificación (opcional)"
  ]);
  sheet.addRow(["","2026-07-30","CAT","CAT","",3000,0,"","ATM","Petty cash","","RBC [rbc]","Cash [cash]","", "Retiros [cash-transfer]"]);
  const result=await parse(wb);
  assert.deepEqual(result.rows[0].errors,[]);
  assert.equal(result.rows[0].data.fromEntityId,"cat");
  assert.equal(result.rows[0].data.toEntityId,"cat");
  assert.equal(result.rows[0].data.fromAccountId,"rbc");
  assert.equal(result.rows[0].data.toAccountId,"cash");
  assert.equal(result.rows[0].data.movementTypeId,"cash-transfer");
  assert.equal(fin.profitability([{...result.rows[0].data,id:"test",createdBy:"user"}],new Set(["cat"])).operating,0);
});
test("Control lease remains mandatory in production and preview security rules",()=>{
  for(const filename of ["firestore.production.rules","firestore.preview.rules"]){
    const txt=readFileSync(new URL("../"+filename,import.meta.url),"utf8");
    assert.ok(txt.includes("hasActiveControlLease(orgId)"));
    assert.ok(txt.includes("validAccountForEntity(orgId, accountId, entityId)"));
    assert.ok(txt.includes("validMovementTypeRef(orgId"));
    assert.ok(txt.includes("d.fromAccountId != d.toAccountId"));
  }
});
