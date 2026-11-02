"use client";

import { useState } from "react";
import { collection, doc, getDocs, runTransaction, serverTimestamp, type DocumentData } from "firebase/firestore";
import { firebaseServices, organizationId } from "@/lib/firebase";
import { centsToMoney, dollarsToCents, movementLabels, type Category, type Customer, type Entity, type Movement } from "@/lib/finance";

type Props = { movement: Movement; entities: Entity[]; categories: Category[]; customers: Customer[]; uid: string; canWrite: boolean };
type AuditRow = { action: string; reason: string; createdBy: string; revision: number; before?: DocumentData; after?: DocumentData };
const editable = new Set(["income", "cost", "expense", "transfer", "personal_draw"]);
const textError = (e: unknown) => e instanceof Error ? e.message : "Error desconocido";

export function MovementActions({ movement, entities, categories, customers, uid, canWrite }: Props) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [date, setDate] = useState(movement.date);
  const [fromId, setFromId] = useState(movement.fromEntityId ?? "");
  const [toId, setToId] = useState(movement.toEntityId ?? "");
  const [categoryId, setCategoryId] = useState(movement.categoryId ?? "");
  const [customerId, setCustomerId] = useState(movement.customerId ?? "");
  const [amount, setAmount] = useState((movement.amountCents / 100).toFixed(2));
  const [net, setNet] = useState(((movement.amountCents - movement.taxCents) / 100).toFixed(2));
  const [counterparty, setCounterparty] = useState(movement.counterparty);
  const [description, setDescription] = useState(movement.description);
  const [reason, setReason] = useState("");

  const kind = movement.kind;
  const income = kind === "income";
  const outgoing = kind === "expense" || kind === "cost";
  const ordinary = income || outgoing;
  const canEdit = canWrite && !movement.voided && editable.has(kind);
  const companyCustomers = customers.filter((c) => c.active && c.companyId === toId);
  const movementRef = doc(firebaseServices().db, "organizations", organizationId, "movements", movement.id);
  const auditCollection = collection(movementRef, "audit");

  async function open() {
    setDate(movement.date);
    setFromId(movement.fromEntityId ?? "");
    setToId(movement.toEntityId ?? "");
    setCategoryId(movement.categoryId ?? "");
    setCustomerId(movement.customerId ?? "");
    setAmount((movement.amountCents / 100).toFixed(2));
    setNet(((movement.amountCents - movement.taxCents) / 100).toFixed(2));
    setCounterparty(movement.counterparty);
    setDescription(movement.description);
    setReason("");
    setShow(true); setNotice("");
    try {
      const snapshots = await getDocs(auditCollection);
      setAudit(snapshots.docs.map((d) => d.data() as AuditRow).sort((a,b) => b.revision - a.revision));
    } catch (error) { setNotice(`No se pudo consultar auditoría: ${textError(error)}`); }
  }

  async function change(action: "edit" | "void") {
    if (!canEdit || busy) return;
    const cleanReason = reason.trim();
    if (cleanReason.length < 8 || cleanReason.length > 400) { setNotice("Indica un motivo de al menos 8 caracteres (máximo 400)."); return; }
    const amountCents = dollarsToCents(amount);
    const netCents = ordinary ? dollarsToCents(net) : amountCents;
    const taxCents = ordinary ? amountCents - netCents : 0;
    if (action === "edit" && (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 100000000000 || !Number.isSafeInteger(netCents) || netCents <= 0 || netCents > amountCents)) {
      setNotice("Revisa los importes: el valor antes de impuestos debe ser positivo y el total igual o mayor."); return;
    }
    if (action === "edit") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) { setNotice("Fecha inválida."); return; }
      if ((income && !toId) || (outgoing && !fromId) || (!ordinary && (!fromId || !toId || fromId === toId))) { setNotice("Selecciona las entidades correctas."); return; }
      if (ordinary && !categories.some((c) => c.id === categoryId && c.kind === kind && c.active)) { setNotice("Selecciona un concepto activo de la misma clasificación."); return; }
      if (kind === "personal_draw" && !(entities.find((e)=>e.id === fromId && e.type === "company") && entities.find((e)=>e.id === toId && e.type === "personal"))) { setNotice("El retiro debe salir de una empresa hacia el ámbito personal."); return; }
      if (kind === "income" && customerId && !companyCustomers.some((c)=>c.id === customerId)) { setNotice("El cliente debe estar activo y pertenecer a la empresa destino."); return; }
      if (counterparty.trim().length > 160 || description.trim().length > 500) { setNotice("Contraparte u observaciones exceden su longitud máxima."); return; }
    }
    if (action === "void" && !window.confirm("¿Anular este movimiento? Se excluirá de los cálculos y quedará conservado para auditoría.")) return;
    setBusy(true); setNotice("");
    try {
      await runTransaction(firebaseServices().db, async (transaction) => {
        const snapshot = await transaction.get(movementRef);
        if (!snapshot.exists()) throw new Error("El movimiento ya no existe.");
        const before = snapshot.data();
        if (before.voided) throw new Error("El movimiento ya fue anulado.");
        if (!editable.has(before.kind)) throw new Error("Préstamos y abonos requieren conciliación especial.");
        const revision = (Number(before.revision) || 0) + 1;
        const auditRef = doc(auditCollection, `r${revision}`);
        const oldAudit = await transaction.get(auditRef);
        if (oldAudit.exists()) throw new Error("Esta revisión ya existe. Vuelve a cargar la página.");
        const selectedCustomer = income && customerId ? customers.find((c)=>c.id === customerId && c.active && c.companyId === toId) : null;
        const patch: DocumentData = action === "void" ? { voided: true, voidReason: cleanReason } : {
          date, fromEntityId: incomingEntity(kind, fromId), toEntityId: outgoingEntity(kind, toId),
          categoryId: ordinary ? categoryId : null,
          amountCents, taxCents,
          counterparty: selectedCustomer ? selectedCustomer.name : counterparty.trim(),
          description: description.trim(),
          ...(selectedCustomer ? { customerId: selectedCustomer.id } : {}),
        };
        const after = { ...before, ...patch, revision, updatedBy: uid, updatedAt: serverTimestamp() } as DocumentData;
        // Eliminar un cliente previamente vinculado, conservando el resto del historial.
        if (action === "edit" && !selectedCustomer && before.customerId) delete after.customerId;
        transaction.set(auditRef, {
          action, reason: cleanReason, revision, createdBy: uid, createdAt: serverTimestamp(),
          before: snapshotFields(before), after: snapshotFields(after),
        });
        transaction.set(movementRef, after);
      });
      setNotice(action === "void" ? "Movimiento anulado y auditado correctamente en Firestore." : "Corrección guardada y auditada correctamente en Firestore.");
      // Una consulta posterior de auditoría no debe hacer parecer que el guardado falló.
      try {
        const auditSnap = await getDocs(auditCollection);
        setAudit(auditSnap.docs.map((d) => d.data() as AuditRow).sort((a,b)=>b.revision-a.revision));
      } catch {
        setNotice("La corrección o anulación se guardó, pero no pudo actualizarse la bitácora en pantalla. Cierra y vuelve a abrir el movimiento.");
      }
      // Mantener el modal abierto: confirmación visible incluso con datos actualizados por Firestore.
    } catch (error) { setNotice(`No se guardó la ${action === "edit" ? "corrección" : "anulación"}: ${textError(error)}. Verifica que las reglas v0.6+ de Firestore estén publicadas.`); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" className="button-link" onClick={open}>Ver / gestionar</button>
    {show && <div className="movement-modal-backdrop" role="presentation" onMouseDown={(e)=>{ if(e.target === e.currentTarget) setShow(false); }}>
      <section className="movement-modal panel" role="dialog" aria-modal="true" aria-label={`Movimiento ${movement.id}`}>
        <div className="panel-title"><h2>Movimiento · {movementLabels[kind]}</h2><button type="button" className="button-secondary" onClick={()=>setShow(false)}>Cerrar</button></div>
        <p className="small-note">ID interno: <code>{movement.id}</code> · {movement.voided ? "Anulado" : "Vigente"} · Revisión {movement.revision ?? 0}</p>
        {notice && <div className="notice" role="status">{notice}</div>}
        {canEdit ? <>
          <p className="small-note">Puedes corregir los movimientos ordinarios y las transferencias. Para préstamos y abonos se requiere conciliación vinculada.</p>
          <div className="form-grid">
            <label>Fecha<input type="date" value={date} onChange={(e)=>setDate(e.target.value)} /></label>
            {!income && <label>Entidad origen<select value={fromId} onChange={(e)=>setFromId(e.target.value)}>{entities.map((e)=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}
            {!outgoing && <label>Entidad destino<select value={toId} onChange={(e)=>{setToId(e.target.value);setCustomerId("");}}>{entities.map((e)=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}
            {ordinary && <label>Concepto<select value={categoryId} onChange={(e)=>setCategoryId(e.target.value)}>{categories.filter((c)=>c.kind===kind).map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
            {income && <label>Cliente<select value={customerId} onChange={(e)=>setCustomerId(e.target.value)}><option value="">Sin cliente del catálogo</option>{companyCustomers.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
            {ordinary && <label>{income ? "Valor de venta antes de impuestos CAD" : kind === "cost" ? "Costo antes de impuestos CAD" : "Gasto antes de impuestos CAD"}
              <input inputMode="decimal" value={net} onChange={(e)=>setNet(e.target.value)} /></label>}
            <label>{income ? "Total cobrado CAD" : outgoing ? "Total pagado CAD" : "Importe total CAD"}
              <input inputMode="decimal" value={amount} onChange={(e)=>setAmount(e.target.value)} /></label>
            {ordinary && <div className="calculated-tax" role="status"><span>Impuestos calculados automáticamente</span>
              <strong>{Number.isSafeInteger(dollarsToCents(amount)) && Number.isSafeInteger(dollarsToCents(net)) && dollarsToCents(amount) >= dollarsToCents(net) && dollarsToCents(net) > 0
                ? centsToMoney(dollarsToCents(amount) - dollarsToCents(net)) : "—"}</strong></div>}
            <label>Contraparte<input maxLength={160} disabled={income && !!customerId} value={income && customerId ? companyCustomers.find((c)=>c.id===customerId)?.name ?? "" : counterparty} onChange={(e)=>setCounterparty(e.target.value)} /></label>
            <label className="wide">Observaciones<input maxLength={500} value={description} onChange={(e)=>setDescription(e.target.value)} /></label>
          </div>
          <label className="movement-reason">Motivo obligatorio de la corrección o anulación<textarea value={reason} onChange={(e)=>setReason(e.target.value)} maxLength={400} rows={2} placeholder="Describe por qué se modifica este registro" /></label>
          <div className="movement-dialog-actions">
            <button type="button" className="button-primary" disabled={busy} onClick={()=>change("edit")}>Guardar corrección</button>
            <button type="button" className="button-secondary" disabled={busy} onClick={()=>change("void")}>Anular movimiento</button>
          </div>
        </> : <p className="small-note">{movement.voided ? "Este movimiento fue anulado; se conserva para auditoría." : "Este tipo de operación se consulta sin edición para proteger saldos de préstamos y abonos."}</p>}
        <h3>Bitácora de cambios</h3>
        {audit.length ? <div className="table-wrap"><table><thead><tr><th>Revisión</th><th>Acción</th><th>Motivo</th><th>Usuario</th><th>Antes / después</th></tr></thead><tbody>{audit.map((a)=><tr key={a.revision}><td>{a.revision}</td><td>{a.action === "void" ? "Anulación" : "Corrección"}</td><td>{a.reason}</td><td>{a.createdBy}</td><td>{centsToMoney(a.before?.amountCents ?? 0)} → {centsToMoney(a.after?.amountCents ?? 0)}</td></tr>)}</tbody></table></div> : <p className="empty">Sin modificaciones registradas.</p>}
      </section>
    </div>}
  </>;
}
function incomingEntity(kind: Movement["kind"], value: string): string | null { return kind === "income" ? null : value; }
function outgoingEntity(kind: Movement["kind"], value: string): string | null { return kind === "cost" || kind === "expense" ? null : value; }

function snapshotFields(d: DocumentData) {
  return {
    date: d.date, kind: d.kind,
    fromEntityId: d.fromEntityId ?? null, toEntityId: d.toEntityId ?? null,
    categoryId: d.categoryId ?? null, loanId: d.loanId ?? null,
    counterparty: d.counterparty ?? "", description: d.description ?? "",
    amountCents: d.amountCents, taxCents: d.taxCents,
    customerId: d.customerId ?? "", voided: d.voided ?? false,
    voidReason: d.voidReason ?? "", revision: d.revision ?? 0,
  };
}
