"use client";

import { useMemo, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { firebaseServices, organizationId } from "@/lib/firebase";
import {
  categoriesLabels, movementLabels,
  type Category, type Entity, type MovementKind, type PaymentAccount,
  type PaymentMethod, type MovementType, type CategoryKind,
} from "@/lib/finance";

type CatalogKey = "categories" | "paymentAccounts" | "paymentMethods" | "movementTypes";
type Entry = { id: string; name: string; active: boolean; kind?: string; companyId?: string };
type Props = {
  categories: Category[]; entities: Entity[];
  paymentAccounts: PaymentAccount[]; paymentMethods: PaymentMethod[];
  movementTypes: MovementType[];
  uid: string; canWrite: boolean;
};
const labels: Record<CatalogKey,string> = {
  categories: "Conceptos financieros",
  paymentAccounts: "Cuentas / fuentes (RBC, TD, caja)",
  paymentMethods: "Formas de pago (efectivo, cheque, E-Transfer)",
  movementTypes: "Clasificaciones de operación (Assets, Liabilities, retiros)",
};
const clean = (s: string) => s.normalize("NFKC").trim().toLocaleLowerCase("es");

export function FinancialCatalogs({categories,entities,paymentAccounts,paymentMethods,movementTypes,uid,canWrite}:Props){
  const [catalog,setCatalog] = useState<CatalogKey>("categories");
  const [name,setName] = useState("");
  const [kind,setKind] = useState<MovementKind>("income");
  const [categoryKind,setCategoryKind] = useState<CategoryKind>("income");
  const [companyId,setCompanyId] = useState("");
  const [editing,setEditing] = useState<string|null>(null);
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState("");
  const companies = useMemo(()=>entities.filter(e=>e.active && e.type==="company").sort((a,b)=>a.name.localeCompare(b.name)),[entities]);
  const rows: Entry[] = useMemo(()=>{
    const source = catalog === "categories" ? categories :
      catalog === "paymentAccounts" ? paymentAccounts :
      catalog === "paymentMethods" ? paymentMethods : movementTypes;
    return source.map(item=>({
      id:item.id,name:item.name,active:item.active,
      kind:"kind" in item ? item.kind : undefined,
      companyId:"companyId" in item ? item.companyId : undefined,
    })).sort((a,b)=>a.name.localeCompare(b.name));
  },[catalog,categories,paymentAccounts,paymentMethods,movementTypes]);

  function switchCatalog(value:CatalogKey){setCatalog(value);setName("");setEditing(null);setNotice("");setCompanyId("");setKind("income");setCategoryKind("income");}
  function edit(row:Entry){
    setEditing(row.id);setName(row.name);setKind((row.kind ?? "income") as MovementKind);
    setCategoryKind((row.kind ?? "income") as CategoryKind);
    setCompanyId(row.companyId ?? "");setNotice("");
  }
  function reset(){setEditing(null);setName("");setNotice("");setCompanyId("");}
  async function save(){
    if(!canWrite||busy||!uid)return;
    const value=name.trim();
    if(!value||value.length>100){setNotice("Nombre requerido, máximo 100 caracteres.");return;}
    if(catalog==="paymentAccounts"&&!companies.some(e=>e.id===companyId)){setNotice("Selecciona una empresa activa.");return;}
    const classification=catalog==="categories"?categoryKind:kind;
    if(rows.some(r=>r.id!==editing && clean(r.name)===clean(value) &&
      (catalog!=="paymentAccounts"||r.companyId===companyId) &&
      (catalog!=="categories" && catalog!=="movementTypes" || r.kind===classification))){
      setNotice("Ya existe un registro con el mismo nombre y clasificación.");return;
    }
    const payload:Record<string,unknown>={name:value};
    if(!editing){
      payload.active=true;payload.createdBy=uid;payload.createdAt=serverTimestamp();
      if(catalog==="categories"||catalog==="movementTypes")payload.kind=classification;
      if(catalog==="paymentAccounts")payload.companyId=companyId;
    }else{payload.updatedBy=uid;payload.updatedAt=serverTimestamp();}
    setBusy(true);setNotice("");
    try{
      const db=firebaseServices().db;
      const base=collection(db,"organizations",organizationId,catalog);
      if(editing){
        // La clasificación financiera y la empresa asociada son inmutables; solo el nombre y estado son editables.
        await updateDoc(doc(base,editing),payload);
        setNotice("Nombre actualizado. Los movimientos históricos conservan el ID.");
      }else{
        await addDoc(base,payload);
        setNotice("Registro creado.");
      }
      setEditing(null);setName("");if(!editing)setCompanyId("");
    }catch(e){setNotice(e instanceof Error?e.message:"No fue posible guardar en Firestore.");}
    finally{setBusy(false);}
  }
  async function toggle(row:Entry){
    if(!canWrite||busy)return;
    setBusy(true);setNotice("");
    try{
      await updateDoc(doc(firebaseServices().db,"organizations",organizationId,catalog,row.id),
        {active:!row.active,updatedBy:uid,updatedAt:serverTimestamp()});
      setNotice(row.active?"Desactivado sin eliminar movimientos históricos.":"Reactivado.");
    }catch(e){setNotice(e instanceof Error?e.message:"No fue posible cambiar el estado.");}
    finally{setBusy(false);}
  }
  const kindName=(x?:string)=>catalog==="categories"?categoriesLabels[x as CategoryKind]??x:
    catalog==="movementTypes"?movementLabels[x as MovementKind]??x:"";
  return <section className="panel">
    <div className="panel-title"><h2>Administración de catálogos</h2><span>Alta · consulta · edición · desactivación</span></div>
    <p>Las operaciones existentes no se eliminan. Desactivar una opción impide seleccionarla en capturas nuevas, pero conserva las referencias históricas.</p>
    <div className="form-grid">
      <label>Catálogo<select value={catalog} onChange={e=>switchCatalog(e.target.value as CatalogKey)}>
        {(Object.entries(labels) as [CatalogKey,string][]).map(([key,label])=><option value={key} key={key}>{label}</option>)}
      </select></label>
      {catalog==="paymentAccounts"&&<label>Empresa propietaria
        <select value={companyId} disabled={Boolean(editing)} onChange={e=>setCompanyId(e.target.value)}>
          <option value="">Seleccionar compañía</option>
          {companies.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
        </select></label>}
      <label>{editing?"Modificar nombre":"Nuevo nombre"}
        <input value={name} maxLength={100} placeholder={catalog==="paymentAccounts"?"RBC, TD, Caja...":catalog==="paymentMethods"?"Cash, Cheque, E-Transfer...":catalog==="movementTypes"?"Government Liabilities, Asset...":"Concepto"} onChange={e=>setName(e.target.value)} disabled={!canWrite||busy}/>
      </label>
      {(catalog==="categories"||catalog==="movementTypes")&&<label>{catalog==="categories"?"Clasificación financiera":"Naturaleza técnica de la operación"}
        <select disabled={Boolean(editing)||busy} value={catalog==="categories"?categoryKind:kind} onChange={e=>catalog==="categories"?setCategoryKind(e.target.value as CategoryKind):setKind(e.target.value as MovementKind)}>
          {catalog==="categories"
          ?(Object.entries(categoriesLabels) as [CategoryKind,string][]).map(([value,label])=><option key={value} value={value}>{label}</option>)
          :(Object.entries(movementLabels) as [MovementKind,string][]).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select>
        {catalog==="movementTypes"&&<span className="field-hint">La naturaleza técnica determina cómo afecta la operación a la rentabilidad y al efectivo. No debe cambiarse después del alta.</span>}
      </label>}
    </div>
    {canWrite&&<div className="form-actions">
      {editing&&<button type="button" className="button-secondary" onClick={reset}>Cancelar edición</button>}
      <button type="button" className="button-primary" disabled={busy||!name.trim()} onClick={save}>{editing?"Guardar nombre":"Crear registro"}</button>
    </div>}
    {notice&&<p className="bulk-feedback" role="status">{notice}</p>}
    <div className="table-wrap"><table><thead><tr><th>Nombre</th>{(catalog==="categories"||catalog==="movementTypes")&&<th>Naturaleza</th>}
      {catalog==="paymentAccounts"&&<th>Empresa</th>}<th>Estado</th>{canWrite&&<th>Acciones</th>}</tr></thead>
      <tbody>{rows.map(r=><tr key={r.id}><td>{r.name}</td>
        {(catalog==="categories"||catalog==="movementTypes")&&<td>{kindName(r.kind)}</td>}
        {catalog==="paymentAccounts"&&<td>{entities.find(e=>e.id===r.companyId)?.name??"—"}</td>}
        <td>{r.active?"Activo":"Inactivo"}</td>
        {canWrite&&<td><button type="button" className="button-link" disabled={busy} onClick={()=>edit(r)}>Editar</button>{" · "}
        <button type="button" className="button-link" disabled={busy} onClick={()=>toggle(r)}>{r.active?"Desactivar":"Reactivar"}</button></td>}
      </tr>)}</tbody></table></div>
  </section>;
}
