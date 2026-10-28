"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { firebaseServices, organizationId } from "@/lib/firebase";
import type { Customer, Entity } from "@/lib/finance";

type Props = {
  entities: Entity[];
  customers: Customer[];
  selectedEntity: string;
  uid: string;
  canWrite: boolean;
};
type CustomerForm = { name: string; code: string; email: string; phone: string; notes: string };
const blankForm: CustomerForm = { name: "", code: "", email: "", phone: "", notes: "" };
const normalized = (text: string) => text.normalize("NFKC").trim().toLocaleLowerCase("es");
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Ocurrió un error al guardar en Firestore.";
}

export function CustomerCatalog({ entities, customers, selectedEntity, uid, canWrite }: Props) {
  const companies = useMemo(() => entities.filter((e) => e.type === "company").sort((a,b) => a.name.localeCompare(b.name)), [entities]);
  const [companyId, setCompanyId] = useState("");
  const [filterCompany, setFilterCompany] = useState("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<CustomerForm>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const current = companies.find((e) => e.id === selectedEntity);
    if (current) {
      setFilterCompany(current.id);
      setCompanyId(current.id);
    } else {
      setFilterCompany("all");
    }
  }, [selectedEntity, companies]);

  const filtered = useMemo(() => customers.filter((c) =>
    (filterCompany === "all" || c.companyId === filterCompany) &&
    [c.name, c.code, c.email, c.phone].some((t) => normalized(t ?? "").includes(normalized(search)))
  ).sort((a,b) => a.companyId.localeCompare(b.companyId) || a.name.localeCompare(b.name)), [customers, filterCompany, search]);

  function updateForm(field: keyof CustomerForm, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }
  function reset() {
    setEditingId(null);
    setForm(blankForm);
  }
  function edit(customer: Customer) {
    setCompanyId(customer.companyId);
    setEditingId(customer.id);
    setForm({ name: customer.name, code: customer.code ?? "", email: customer.email ?? "", phone: customer.phone ?? "", notes: customer.notes ?? "" });
    setNotice("");
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || !uid) return;
    const company = companies.find((e) => e.id === companyId && e.active);
    if (!company) { setNotice("Selecciona una compañía activa."); return; }
    const data: CustomerForm = {
      name: form.name.trim(), code: form.code.trim(), email: form.email.trim(),
      phone: form.phone.trim(), notes: form.notes.trim(),
    };
    if (!data.name || data.name.length > 160 || data.code.length > 50 || data.email.length > 160 ||
      data.phone.length > 40 || data.notes.length > 400) {
      setNotice("Revisa las longitudes del nombre y de los datos de contacto."); return;
    }
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      setNotice("El correo electrónico no tiene un formato válido."); return;
    }
    if (customers.some((c) => c.id !== editingId && c.companyId === companyId && normalized(c.name) === normalized(data.name))) {
      setNotice("Ya existe un cliente con ese nombre dentro de la compañía seleccionada."); return;
    }
    setBusy(true); setNotice("");
    try {
      const db = firebaseServices().db;
      if (editingId) {
        const original = customers.find((c) => c.id === editingId);
        if (!original || original.companyId !== companyId) {
          setNotice("No puedes cambiar la empresa propietaria de un cliente existente."); return;
        }
        await updateDoc(doc(db, "organizations", organizationId, "customers", editingId), {
          ...data, updatedAt: serverTimestamp(), updatedBy: uid,
        });
        setNotice("Cliente actualizado correctamente.");
      } else {
        await addDoc(collection(db, "organizations", organizationId, "customers"), {
          ...data, companyId, active: true, createdBy: uid, createdAt: serverTimestamp(),
        });
        setNotice("Cliente registrado para la compañía seleccionada.");
      }
      reset();
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function toggleActive(customer: Customer) {
    if (!canWrite || busy || !uid) return;
    setBusy(true); setNotice("");
    try {
      await updateDoc(doc(firebaseServices().db, "organizations", organizationId, "customers", customer.id), {
        active: !customer.active, updatedAt: serverTimestamp(), updatedBy: uid,
      });
      setNotice(customer.active ? "Cliente desactivado. Los movimientos históricos se conservan." : "Cliente reactivado.");
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }
  const nameOfCompany = (id: string) => companies.find((e) => e.id === id)?.name ?? "Empresa no encontrada";
  return <div className="customer-section">
    {notice && <div className="notice" role="status">{notice}<button type="button" aria-label="Cerrar aviso" onClick={() => setNotice("")}>×</button></div>}
    {canWrite && <section className="panel">
      <div className="panel-title"><h2>{editingId ? "Editar cliente" : "Registrar nuevo cliente"}</h2><span>Los clientes pertenecen a una empresa, no al grupo completo</span></div>
      <form onSubmit={save}>
        <div className="form-grid">
          <label>Empresa propietaria
            <select value={companyId} disabled={busy || Boolean(editingId)} onChange={(e) => setCompanyId(e.target.value)} required>
              <option value="">Seleccionar compañía</option>
              {companies.filter((e) => e.active || e.id === companyId).map((e) => <option key={e.id} value={e.id}>{e.name}{!e.active ? " (inactiva)" : ""}</option>)}
            </select>
          </label>
          <label>Nombre del cliente
            <input required maxLength={160} value={form.name} onChange={(e) => updateForm("name", e.target.value)} placeholder="Ej. Distribuidora ABC" />
          </label>
          <label>Código o folio de cliente (opcional)
            <input maxLength={50} value={form.code} onChange={(e) => updateForm("code", e.target.value)} placeholder="Ej. CLI-001" />
          </label>
          <label>Correo (opcional)
            <input type="email" maxLength={160} value={form.email} onChange={(e) => updateForm("email", e.target.value)} placeholder="cliente@empresa.com" />
          </label>
          <label>Teléfono (opcional)
            <input type="tel" maxLength={40} value={form.phone} onChange={(e) => updateForm("phone", e.target.value)} placeholder="Teléfono de contacto" />
          </label>
          <label>Notas (opcional)
            <input maxLength={400} value={form.notes} onChange={(e) => updateForm("notes", e.target.value)} placeholder="Información comercial breve" />
          </label>
        </div>
        <div className="customer-actions">
          <p className="small-note">Si una misma persona compra a dos compañías, registra un cliente en cada una. No se borran registros históricos.</p>
          {editingId && <button className="button-secondary" disabled={busy} type="button" onClick={reset}>Cancelar edición</button>}
          <button className="button-primary" disabled={busy || !companyId || !companies.some((c) => c.id === companyId && c.active)} type="submit">{busy ? "Guardando…" : editingId ? "Guardar cambios" : "Crear cliente"}</button>
        </div>
      </form>
    </section>}
    {!companies.length && <section className="panel"><p className="empty">Todavía no hay empresas. Primero crea una en «Empresas y personal».</p></section>}
    <section className="panel">
      <div className="panel-title"><h2>Directorio de clientes</h2><span>{filtered.length} visibles · {customers.length} registrados</span></div>
      <div className="customer-filters">
        <label>Compañía<select value={filterCompany} onChange={(e) => setFilterCompany(e.target.value)}><option value="all">Todas las empresas</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        <label>Buscar cliente<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, folio, correo o teléfono" /></label>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Empresa</th><th>Folio</th><th>Correo / teléfono</th><th>Estado</th>{canWrite && <th>Acciones</th>}</tr></thead><tbody>
        {filtered.map((customer) => <tr key={customer.id}>
          <td>{customer.name}</td><td>{nameOfCompany(customer.companyId)}</td><td>{customer.code || "—"}</td>
          <td>{customer.email || customer.phone ? <>{customer.email}{customer.email && customer.phone ? " · " : ""}{customer.phone}</> : "—"}</td>
          <td>{customer.active ? "Activo" : "Inactivo"}</td>
          {canWrite && <td><div className="customer-row-actions"><button className="button-link" disabled={busy} type="button" onClick={() => edit(customer)}>Editar</button><button className="button-link" disabled={busy} type="button" onClick={() => toggleActive(customer)}>{customer.active ? "Desactivar" : "Reactivar"}</button></div></td>}
        </tr>)}
      </tbody></table></div>
      {!filtered.length && <p className="empty">No hay clientes para los filtros seleccionados.</p>}
    </section>
  </div>;
}
