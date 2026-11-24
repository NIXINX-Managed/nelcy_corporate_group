"use client";

import {useState} from "react";
import {doc,getDoc,serverTimestamp,setDoc} from "firebase/firestore";
import {firebaseServices,organizationId} from "@/lib/firebase";
import {movementLabels,type Entity,type MovementKind,type PaymentAccount,type PaymentMethod,type MovementType} from "@/lib/finance";

const TEMPLATE="NELCY-FINANCIAL-CATALOG-1";
type Catalog="paymentAccounts"|"paymentMethods"|"movementTypes";
type Row={row:number;name:string;companyId?:string;kind?:MovementKind;errors:string[]};
type Props={entities:Entity[];accounts:PaymentAccount[];methods:PaymentMethod[];types:MovementType[];uid:string};
const headers:Record<Catalog,string[]> = {
  paymentAccounts:["Empresa","Cuenta / fuente"],
  paymentMethods:["Forma de pago"],
  movementTypes:["Clasificación","Naturaleza técnica"],
};
const norm=(s:string)=>s.normalize("NFKC").trim().toLocaleLowerCase("es");
const token=(id:string,name:string)=>name+" ["+id+"]";
const text=(x:unknown)=>typeof x==="string"||typeof x==="number"?String(x).trim():"";
function resolve<T extends {id:string;name:string}>(v:string,items:T[]):T|null{
  const exact=items.filter(x=>x.id===v||token(x.id,x.name)===v);
  if(exact.length===1)return exact[0];
  const named=items.filter(x=>norm(x.name)===norm(v));
  return named.length===1?named[0]:null;
}
async function getExcel(){return (await import("exceljs")).default;}
async function idFor(catalog:Catalog,row:Row){
  const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode([
    organizationId,catalog,row.companyId??"",row.kind??"",norm(row.name)
  ].join("|")));
  return "bulk_"+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("").slice(0,40);
}
export function FinancialCatalogImport({entities,accounts,methods,types,uid}:Props){
  const [catalog,setCatalog]=useState<Catalog>("paymentAccounts");
  const [file,setFile]=useState<File|null>(null);
  const [rows,setRows]=useState<Row[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const companies=entities.filter(e=>e.type==="company"&&e.active);
  const ready=rows.filter(r=>r.errors.length===0);
  function clear(){setRows([]);setFile(null);setMessage("");}
  async function download(){
    setBusy(true);setMessage("");
    try{
      const ExcelJS=await getExcel();
      const wb=new ExcelJS.Workbook();
      const info=wb.addWorksheet("Instrucciones");
      info.columns=[{width:31},{width:85}];
      info.addRow(["Formato",TEMPLATE]);
      info.addRow(["Catálogo",catalog]);
      info.addRow(["Uso","Completa la hoja Catalogo. No cambies los encabezados. Los registros existentes no se sobrescriben."]);
      const sheet=wb.addWorksheet("Catalogo",{views:[{state:"frozen",ySplit:1}]});
      sheet.columns=headers[catalog].map(h=>({header:h,width:55}));
      sheet.getRow(1).height=28;sheet.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};
      sheet.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF1D365A"}};
      sheet.autoFilter={from:"A1",to:catalog==="paymentMethods"?"A1":"B1"};
      if(catalog==="paymentAccounts"){
        const list=wb.addWorksheet("Empresas");
        list.columns=[{header:"Empresas activas",width:70}];
        companies.forEach(e=>list.addRow([token(e.id,e.name)]));
        if(companies.length){
          wb.definedNames.add("Empresas!$A$2:$A$"+(companies.length+1),"ListaEmpresas");
          for(let i=2;i<=501;i++)sheet.getCell(i,1).dataValidation={type:"list",allowBlank:true,formulae:["ListaEmpresas"]};
        }
      }
      if(catalog==="movementTypes"){
        const list=wb.addWorksheet("Naturalezas");
        list.columns=[{header:"Naturaleza técnica",width:70}];
        Object.entries(movementLabels).forEach(([key,name])=>list.addRow([name+" ["+key+"]"]));
        wb.definedNames.add("Naturalezas!$A$2:$A$"+(Object.keys(movementLabels).length+1),"ListaNaturalezas");
        for(let i=2;i<=501;i++)sheet.getCell(i,2).dataValidation={type:"list",allowBlank:true,formulae:["ListaNaturalezas"]};
      }
      const buffer=new Uint8Array(await wb.xlsx.writeBuffer());
      const url=URL.createObjectURL(new Blob([buffer.slice().buffer as ArrayBuffer],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
      const link=document.createElement("a");link.href=url;link.download="nelcy_catalogo_"+catalog+"_v1.xlsx";
      document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);
    }catch(e){setMessage(e instanceof Error?e.message:"Error al descargar layout.");}
    finally{setBusy(false);}
  }
  async function validate(){
    if(!file)return;
    setBusy(true);setRows([]);setMessage("");
    try{
      if(!file.name.toLowerCase().endsWith(".xlsx")||file.size>5*1024*1024)throw Error("Archivo .xlsx máximo 5 MB.");
      const ExcelJS=await getExcel(),wb=new ExcelJS.Workbook();
      await wb.xlsx.load((await file.arrayBuffer()) as Parameters<typeof wb.xlsx.load>[0]);
      const info=wb.getWorksheet("Instrucciones"),sheet=wb.getWorksheet("Catalogo");
      if(!info||!sheet||text(info.getCell("B1").value)!==TEMPLATE||text(info.getCell("B2").value)!==catalog)
        throw Error("El archivo no corresponde al catálogo seleccionado.");
      const head=headers[catalog];
      for(let i=0;i<head.length;i++)if(text(sheet.getCell(1,i+1).value)!==head[i])throw Error("Encabezados alterados, descarga la plantilla.");
      if(sheet.rowCount>1001)throw Error("Máximo 1000 registros.");
      const exists=new Set((catalog==="paymentAccounts"?accounts:catalog==="paymentMethods"?methods:types).map(x=>
        catalog==="paymentAccounts"?"companyId" in x ? [x.companyId,norm(x.name)].join("|"):"":
        catalog==="movementTypes"?"kind" in x ? [x.kind,norm(x.name)].join("|"):"":norm(x.name)
      ));
      const seen=new Set<string>(),parsed:Row[]=[];
      for(let n=2;n<=sheet.rowCount;n++){
        const raw=head.map((_,i)=>sheet.getCell(n,i+1).value);
        if(raw.every(x=>x==null||String(x).trim()===""))continue;
        const errors:string[]=[];
        if(raw.some(x=>x!==null&&typeof x==="object"))errors.push("No se admiten fórmulas ni celdas especiales.");
        const a=text(raw[0]),b=text(raw[1]);
        const company=catalog==="paymentAccounts"?resolve(a,companies):null;
        const name=catalog==="paymentAccounts"?b:a;
        const kind=catalog==="movementTypes"?Object.entries(movementLabels).find(([id,label])=>b===id||b===label+" ["+id+"]"||b===label)?.[0] as MovementKind|undefined:undefined;
        if(!name||name.length>100)errors.push("Nombre requerido, máximo 100 caracteres.");
        if(catalog==="paymentAccounts"&&!company)errors.push("Empresa inválida o ambigua.");
        if(catalog==="movementTypes"&&!kind)errors.push("Naturaleza técnica no válida.");
        const key=catalog==="paymentAccounts"?[company?.id??"",norm(name)].join("|"):
          catalog==="movementTypes"?[kind??"",norm(name)].join("|"):norm(name);
        if(exists.has(key))errors.push("Ya existe en Firestore.");
        if(seen.has(key))errors.push("Duplicado en el archivo.");
        seen.add(key);parsed.push({row:n,name,companyId:company?.id,kind,errors});
      }
      if(!parsed.length)throw Error("No hay registros.");
      setRows(parsed);setMessage("Validados "+parsed.length+" registros.");
    }catch(e){setMessage(e instanceof Error?e.message:"Error de validación.");}
    finally{setBusy(false);}
  }
  async function save(){
    if(busy||!uid||!ready.length)return;
    setBusy(true);setMessage("");
    let created=0,skipped=0,failed=0;
    const db=firebaseServices().db;
    for(const row of ready){
      try{
        const ref=doc(db,"organizations",organizationId,catalog,await idFor(catalog,row));
        if((await getDoc(ref)).exists()){skipped++;continue;}
        await setDoc(ref,{name:row.name,active:true,
          ...(row.companyId?{companyId:row.companyId}:{}),
          ...(row.kind?{kind:row.kind}:{}),
          createdBy:uid,createdAt:serverTimestamp()});
        created++;
      }catch(e){failed++;setMessage("Fila "+row.row+": "+(e instanceof Error?e.message:"error al guardar"));if(failed>=3)break;}
    }
    setMessage(x=>x+" Creados: "+created+". Ya existentes: "+skipped+". Fallidos: "+failed+".");
    setRows([]);setFile(null);setBusy(false);
  }
  return <section className="panel">
    <div className="panel-title"><h2>Importación masiva de nuevos catálogos</h2><span>Layouts independientes · máximo 1000 filas</span></div>
    <p>Sin modificar los Excel históricos de empresas, conceptos, ingresos o gastos. No sobrescribe registros existentes.</p>
    <div className="bulk-toolbar">
      <label className="bulk-label">Catálogo
        <select value={catalog} disabled={busy} onChange={e=>{setCatalog(e.target.value as Catalog);clear();}}>
          <option value="paymentAccounts">Cuentas y fuentes</option><option value="paymentMethods">Medios de pago</option><option value="movementTypes">Clasificaciones de operación</option>
        </select></label>
      <button type="button" className="button-secondary" disabled={busy} onClick={download}>Descargar layout .xlsx</button>
      <label className="bulk-label">Archivo Excel
        <input type="file" accept=".xlsx" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setRows([]);setMessage("");}}/></label>
      <button type="button" className="button-secondary" disabled={busy||!file} onClick={validate}>Validar</button>
    </div>
    {message&&<p className="bulk-feedback" role="status">{message}</p>}
    {rows.length>0&&<><p>{rows.length} revisados · {ready.length} válidos · {rows.length-ready.length} con errores</p>
      <div className="table-wrap"><table><thead><tr><th>Fila</th><th>Registro</th><th>Validación</th></tr></thead><tbody>
        {rows.slice(0,100).map(r=><tr key={r.row}><td>{r.row}</td><td>{r.name}</td><td>{r.errors.join(" · ")||"Correcto"}</td></tr>)}
      </tbody></table></div>
      <button type="button" className="button-primary" disabled={busy||!ready.length} onClick={save}>Confirmar importación ({ready.length})</button>
    </>}
  </section>;
}
