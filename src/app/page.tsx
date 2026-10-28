"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, doc, getDoc, onSnapshot, serverTimestamp,
  type DocumentData,
} from "firebase/firestore";
import {
  GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut,
  type User,
} from "firebase/auth";
import {
  type Category, type CategoryKind, type Entity, type EntityType,
  type Movement, type MovementKind, type UserRole,
  categoriesLabels, centsToMoney, dollarsToCents, movementLabels,
  profitability, selectedCashDelta,
} from "@/lib/finance";
import { firebaseServices, isFirebaseConfigured, organizationId } from "@/lib/firebase";
import { BulkImport } from "@/components/bulk-import";
import { CatalogImport } from "@/components/catalog-import";

type Tab = "dashboard" | "movements" | "entities" | "categories";
type Status = "loading" | "login" | "unauthorized" | "ready" | "config-error";

const dateToday = () => {
  const date = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Toronto",
  }).formatToParts(date);
  const obj = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${obj.year}-${obj.month}-${obj.day}`;
};
const pad = (month: number) => String(month).padStart(2, "0");
const yearMonth = (date: string) => date.slice(0, 7);
const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function readDocs<T>(docs: { id: string; data: () => DocumentData }[]): T[] {
  return docs.map((item) => ({ ...item.data(), id: item.id }) as T);
}
function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : "Se produjo un error inesperado.";
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [role, setRole] = useState<UserRole | null>(null);
  const [retry, setRetry] = useState(0);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [movementMode, setMovementMode] = useState<"single" | "bulk">("single");
  const [year, setYear] = useState("");
  const [selectedEntity, setSelectedEntity] = useState("companies");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [entityName, setEntityName] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("company");
  const [categoryName, setCategoryName] = useState("");
  const [categoryKind, setCategoryKind] = useState<CategoryKind>("income");
  const [entryKind, setEntryKind] = useState<MovementKind>("income");
  const [entryDate, setEntryDate] = useState("");
  const [fromEntityId, setFromEntityId] = useState("");
  const [toEntityId, setToEntityId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [loanId, setLoanId] = useState("");
  const [amount, setAmount] = useState("");
  const [tax, setTax] = useState("0");
  const [counterparty, setCounterparty] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    const today = dateToday();
    setYear(today.slice(0, 4));
    setEntryDate(today);
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setStatus("config-error");
      return;
    }
    const { auth } = firebaseServices();
    return onAuthStateChanged(auth, (current) => {
      setUser(current);
      setStatus(current ? "loading" : "login");
      if (!current) setRole(null);
    }, (error) => { setNotice(messageFromError(error)); setStatus("login"); });
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const { db } = firebaseServices();
    const org = doc(db, "organizations", organizationId);
    const member = doc(org, "members", user.uid);
    const unsubscribers: (() => void)[] = [];

    (async () => {
      try {
        const access = await getDoc(member);
        if (!active) return;
        if (!access.exists() || !["admin", "editor", "viewer"].includes(access.data().role)) {
          setStatus("unauthorized");
          return;
        }
        setRole(access.data().role as UserRole);
        const fail = (error: Error) => { if (active) setNotice(`Error de lectura: ${error.message}`); };
        unsubscribers.push(onSnapshot(collection(org, "entities"), (snap) => {
          if (active) setEntities(readDocs<Entity>(snap.docs));
        }, fail));
        unsubscribers.push(onSnapshot(collection(org, "categories"), (snap) => {
          if (active) setCategories(readDocs<Category>(snap.docs));
        }, fail));
        unsubscribers.push(onSnapshot(collection(org, "movements"), (snap) => {
          if (active) setMovements(readDocs<Movement>(snap.docs));
        }, fail));
        setStatus("ready");
      } catch (error) {
        if (active) { setStatus("unauthorized"); setNotice(messageFromError(error)); }
      }
    })();
    return () => { active = false; unsubscribers.forEach((unsubscribe) => unsubscribe()); };
  }, [user, retry]);

  const canWrite = role === "admin" || role === "editor";
  const sortedEntities = useMemo(() => [...entities].sort((a, b) => a.name.localeCompare(b.name)), [entities]);
  const selectedIds = useMemo(() => new Set(
    selectedEntity === "all" ? entities.map((e) => e.id) :
      selectedEntity === "companies" ? entities.filter((e) => e.type === "company").map((e) => e.id) :
        [selectedEntity]
  ), [selectedEntity, entities]);
  const filteredMovements = useMemo(() => movements
    .filter((m) => m.date.startsWith(`${year}-`) && (
      (m.fromEntityId !== null && selectedIds.has(m.fromEntityId)) ||
      (m.toEntityId !== null && selectedIds.has(m.toEntityId))
    ))
    .sort((a, b) => b.date.localeCompare(a.date)), [movements, year, selectedIds]);
  const finance = useMemo(() => profitability(filteredMovements, selectedIds), [filteredMovements, selectedIds]);
  const cashChange = useMemo(() => filteredMovements.reduce((sum, m) =>
    sum + selectedCashDelta(m, selectedIds), 0), [filteredMovements, selectedIds]);
  const months = useMemo(() => monthNames.map((label, index) => {
    const list = filteredMovements.filter((m) => yearMonth(m.date) === `${year}-${pad(index + 1)}`);
    const profit = profitability(list, selectedIds);
    return { label, ...profit, cash: list.reduce((sum, m) => sum + selectedCashDelta(m, selectedIds), 0) };
  }), [filteredMovements, selectedIds, year]);
  const categoryAnnual = useMemo(() => {
    const result = new Map<string, { categoryId: string; kind: CategoryKind; values: number[]; total: number }>();
    for (const m of filteredMovements) {
      if (!(m.kind === "income" || m.kind === "cost" || m.kind === "expense") || !m.categoryId) continue;
      const relevantId = m.kind === "income" ? m.toEntityId : m.fromEntityId;
      if (!relevantId || !selectedIds.has(relevantId)) continue;
      const index = Number(m.date.slice(5, 7)) - 1;
      if (index < 0 || index > 11) continue;
      const key = `${m.kind}/${m.categoryId}`;
      const entry = result.get(key) ?? { categoryId: m.categoryId, kind: m.kind, values: Array(12).fill(0) as number[], total: 0 };
      const net = m.amountCents - m.taxCents;
      entry.values[index] += net;
      entry.total += net;
      result.set(key, entry);
    }
    return [...result.values()].sort((a, b) => a.kind.localeCompare(b.kind) || b.total - a.total);
  }, [filteredMovements, selectedIds]);
  const loans = useMemo(() => movements.filter((m) => m.kind === "loan"), [movements]);
  const loanBalances = useMemo(() => loans.map((loan) => ({
    ...loan,
    outstanding: loan.amountCents - movements.filter((m) => m.kind === "loan_repayment" && m.loanId === loan.id)
      .reduce((sum, m) => sum + m.amountCents, 0),
  })), [loans, movements]);
  const availableCategories = categories.filter((c) => c.active && c.kind === entryKind);
  const isOrdinary = ["income", "cost", "expense"].includes(entryKind);
  const isIncoming = entryKind === "income";
  const isOutgoing = entryKind === "cost" || entryKind === "expense";
  const needsTo = !isOutgoing;
  const needsFrom = !isIncoming;
  const nameOf = (id: string | null) => entities.find((e) => e.id === id)?.name ?? "—";
  const kindOf = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "—";

  async function googleLogin() {
    setNotice("");
    try { await signInWithPopup(firebaseServices().auth, new GoogleAuthProvider()); }
    catch (error) { setNotice(messageFromError(error)); }
  }
  async function createEntity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !canWrite || !entityName.trim()) return;
    setBusy(true); setNotice("");
    try {
      await addDoc(collection(firebaseServices().db, "organizations", organizationId, "entities"), {
        name: entityName.trim(), type: entityType, active: true, createdBy: user.uid, createdAt: serverTimestamp(),
      });
      setEntityName(""); setNotice("Entidad registrada.");
    } catch (error) { setNotice(messageFromError(error)); }
    finally { setBusy(false); }
  }
  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !canWrite || !categoryName.trim()) return;
    setBusy(true); setNotice("");
    try {
      await addDoc(collection(firebaseServices().db, "organizations", organizationId, "categories"), {
        name: categoryName.trim(), kind: categoryKind, active: true, createdBy: user.uid, createdAt: serverTimestamp(),
      });
      setCategoryName(""); setNotice("Concepto registrado.");
    } catch (error) { setNotice(messageFromError(error)); }
    finally { setBusy(false); }
  }
  async function createMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !canWrite) return;
    const amountCents = dollarsToCents(amount);
    const taxCents = isOrdinary ? dollarsToCents(tax) : 0;
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 100000000000 ||
      !Number.isSafeInteger(taxCents) || taxCents < 0 || taxCents > amountCents) {
      setNotice("Importe inválido. El impuesto debe estar incluido en el monto y no superarlo.");
      return;
    }
    const actualFrom = needsFrom ? fromEntityId : null;
    const actualTo = needsTo ? toEntityId : null;
    const selectedLoan = loanBalances.find((l) => l.id === loanId);
    if ((needsFrom && !actualFrom) || (needsTo && !actualTo) ||
      (actualFrom && actualTo && actualFrom === actualTo) ||
      (isOrdinary && !categoryId)) {
      setNotice("Selecciona todas las entidades y el concepto requeridos.");
      return;
    }
    if (entryKind === "personal_draw" &&
      (entities.find((e) => e.id === actualFrom)?.type !== "company" ||
        entities.find((e) => e.id === actualTo)?.type !== "personal")) {
      setNotice("El retiro debe ir de una empresa hacia una entidad personal."); return;
    }
    if (entryKind === "loan_repayment" && (!selectedLoan ||
      actualFrom !== selectedLoan.toEntityId || actualTo !== selectedLoan.fromEntityId ||
      amountCents > selectedLoan.outstanding)) {
      setNotice("Selecciona el préstamo original, invierte correctamente las entidades y verifica el saldo."); return;
    }
    setBusy(true); setNotice("");
    try {
      await addDoc(collection(firebaseServices().db, "organizations", organizationId, "movements"), {
        date: entryDate, kind: entryKind,
        fromEntityId: actualFrom, toEntityId: actualTo,
        categoryId: isOrdinary ? categoryId : null,
        loanId: entryKind === "loan_repayment" ? loanId : null,
        counterparty: counterparty.trim(), description: description.trim(),
        amountCents, taxCents, createdAt: serverTimestamp(), createdBy: user.uid,
      });
      setAmount(""); setTax("0"); setCounterparty(""); setDescription(""); setLoanId("");
      setNotice("Movimiento guardado en Firestore.");
    } catch (error) { setNotice(messageFromError(error)); }
    finally { setBusy(false); }
  }

  if (status !== "ready") {
    return <main className="center-page">
      <section className="login-card">
        <div className="brand-icon">N</div>
        <p className="eyebrow">NELCY CORPORATE GROUP</p>
        <h1>Control financiero</h1>
        {status === "loading" && <p>Verificando tu acceso…</p>}
        {status === "config-error" && <p>Faltan variables de Firebase en <code>.env.local</code> o Vercel.</p>}
        {status === "login" && <><p>Accede con tu cuenta autorizada por el administrador.</p>
          <button className="button-primary" onClick={googleLogin}>Entrar con Google</button></>}
        {status === "unauthorized" && <>
          <p>Tu sesión está activa, pero todavía no tienes permisos en <strong>{organizationId}</strong>.</p>
          <div className="uid-box"><span>UID para activar tu acceso:</span><code>{user?.uid}</code>
            <button className="button-secondary" onClick={() => navigator.clipboard.writeText(user?.uid ?? "")}>Copiar UID</button></div>
          <p className="small-note">Crea el documento <code>organizations/{organizationId}/members/UID</code> en Firestore con el campo <code>role = "admin"</code>. Después comprueba el acceso.</p>
          <button className="button-primary" onClick={() => { setStatus("loading"); setRetry((n) => n + 1); }}>Comprobar acceso</button>
          <button className="button-link" onClick={() => signOut(firebaseServices().auth)}>Cambiar cuenta</button>
        </>}
        {notice && <p className="notice error">{notice}</p>}
      </section>
    </main>;
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-icon">N</div>
        <div><strong>Nelcy Corporate Group</strong><span>Financial Control · v0.1</span></div>
      </div>
      <div className="account"><span>{user?.email}</span><span className="role-tag">{role}</span>
        <button className="button-secondary" onClick={() => signOut(firebaseServices().auth)}>Salir</button></div>
    </header>
    <div className="workspace">
      <nav className="nav-tabs" aria-label="Secciones">
        {([ ["dashboard", "Resumen"], ["movements", "Movimientos"],
          ["entities", "Empresas y personal"], ["categories", "Catálogos"] ] as const).map(([id, label]) =>
          <button key={id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); setNotice(""); }}>{label}</button>)}
      </nav>
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}

      {tab === "dashboard" && <>
        <section className="section-heading"><div><p className="eyebrow">VISIÓN FINANCIERA</p><h1>Dashboard</h1>
          <p>Rentabilidad y variación neta de efectivo, sin duplicar transferencias internas.</p></div>
          <div className="filters"><label>Ejercicio<select value={year} onChange={(e) => setYear(e.target.value)}>
              {Array.from(new Set([year, ...movements.map((m) => m.date.slice(0, 4))])).filter(Boolean)
                .sort().reverse().map((y) => <option key={y}>{y}</option>)}
            </select></label><label>Perspectiva<select value={selectedEntity} onChange={(e) => setSelectedEntity(e.target.value)}>
              <option value="companies">Todas las empresas</option><option value="all">Consolidado + personal</option>
              {sortedEntities.map((e) => <option key={e.id} value={e.id}>{e.name} {e.type === "personal" ? "· Personal" : ""}</option>)}
            </select></label></div>
        </section>
        <section className="stats-grid">
          <Stat label="Ingresos netos" value={finance.income} tone="teal" />
          <Stat label="Costos directos" value={finance.cost} tone="amber" />
          <Stat label="Margen bruto" value={finance.gross} tone="blue" />
          <Stat label="Gastos operativos" value={finance.expense} tone="amber" />
          <Stat label="Resultado operativo" value={finance.operating} tone="blue" />
          <Stat label="Variación de efectivo" value={cashChange} tone="teal" />
        </section>
        <section className="panel"><div className="panel-title"><h2>Resultados por mes</h2><span>CAD · Ejercicio {year}</span></div>
          <div className="table-wrap"><table><thead><tr><th>Mes</th><th>Ingresos</th><th>Costos</th><th>Gastos</th><th>Margen bruto</th><th>Operativo</th><th>Δ Efectivo</th></tr></thead>
            <tbody>{months.map((m) => <tr key={m.label}><td>{m.label}</td><td>{centsToMoney(m.income)}</td><td>{centsToMoney(m.cost)}</td>
              <td>{centsToMoney(m.expense)}</td><td>{centsToMoney(m.gross)}</td><td className={m.operating < 0 ? "negative" : "positive"}>{centsToMoney(m.operating)}</td>
              <td className={m.cash < 0 ? "negative" : "positive"}>{centsToMoney(m.cash)}</td></tr>)}</tbody></table></div>
        </section>
        <section className="panel"><div className="panel-title"><h2>Participación por concepto</h2><span>Meses y porcentaje anual de su clasificación</span></div>
          <div className="table-wrap"><table><thead><tr><th>Concepto</th><th>Tipo</th><th>Total anual</th><th>% anual</th>
            {monthNames.map((m) => <th key={m}>{m}</th>)}</tr></thead><tbody>{categoryAnnual.map((item) => {
              const base = finance[item.kind];
              return <tr key={`${item.kind}/${item.categoryId}`}><td>{kindOf(item.categoryId)}</td>
                <td>{categoriesLabels[item.kind]}</td><td>{centsToMoney(item.total)}</td>
                <td>{base ? (item.total / base * 100).toFixed(2) : "0.00"}%</td>
                {item.values.map((amount, i) => <td key={i}>{centsToMoney(amount)}</td>)}
              </tr>;})}</tbody></table></div>
          {!categoryAnnual.length && <p className="empty">Registra movimientos para ver la composición por conceptos.</p>}
        </section>
        <div className="two-columns">
          <section className="panel"><div className="panel-title"><h2>Ingresos vs. costos y gastos</h2></div>
            <div className="chart-legend"><span><i className="key income"/>Ingresos</span><span><i className="key outflow"/>Costos + gastos</span></div>
            <div className="bar-chart">{months.map((m) => { const max = Math.max(1, ...months.map((x) => Math.max(x.income, x.cost + x.expense)));
              return <div className="bar-month" key={m.label}><div className="bars">
                <div title={`Ingresos ${centsToMoney(m.income)}`} className="bar income" style={{ height: `${Math.max(2, m.income / max * 100)}%` }}/>
                <div title={`Costos y gastos ${centsToMoney(m.cost + m.expense)}`} className="bar outflow" style={{ height: `${Math.max(2, (m.cost + m.expense) / max * 100)}%` }}/>
              </div><span>{m.label}</span></div>; })}</div>
          </section>
          <section className="panel"><div className="panel-title"><h2>Préstamos internos</h2><span>Saldo nominal registrado</span></div>
            {loanBalances.length ? <div className="table-wrap"><table><thead><tr><th>De → Para</th><th>Fecha</th><th>Pendiente</th></tr></thead><tbody>
              {loanBalances.map((m) => <tr key={m.id}><td>{nameOf(m.fromEntityId)} → {nameOf(m.toEntityId)}</td><td>{m.date}</td>
                <td className={m.outstanding < 0 ? "negative" : ""}>{centsToMoney(m.outstanding)}</td></tr>)}
            </tbody></table></div> : <p className="empty">Todavía no hay préstamos registrados.</p>}
          </section>
        </div>
        <p className="disclaimer">Indicadores gerenciales preliminares, no estados financieros certificados. El importe incluye impuestos y la rentabilidad excluye la porción de impuesto capturada. La variación de efectivo refleja movimientos registrados durante el período, no el saldo bancario disponible ni el flujo contable ajustado.</p>
      </>}

      {tab === "entities" && <><section className="section-heading"><div><p className="eyebrow">CONFIGURACIÓN</p><h1>Empresas y ámbito personal</h1><p>Las entidades son independientes, pero pueden transferirse recursos entre sí.</p></div></section>
        {canWrite && <form className="form-panel" onSubmit={createEntity}><label>Nombre<input value={entityName} onChange={(e) => setEntityName(e.target.value)} placeholder="Ej. Cataleya Contracting Inc." maxLength={100} required /></label>
          <label>Tipo<select value={entityType} onChange={(e) => setEntityType(e.target.value as EntityType)}><option value="company">Empresa</option><option value="personal">Personal</option></select></label>
          <button className="button-primary" disabled={busy}>Crear entidad</button></form>}
        {canWrite && user && <CatalogImport catalogType="entities" entities={entities} categories={categories} uid={user.uid} />}
        <section className="panel"><div className="panel-title"><h2>Entidades configuradas</h2><span>{entities.length} registradas</span></div>
          <div className="table-wrap"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Estado</th></tr></thead><tbody>{sortedEntities.map((e) => <tr key={e.id}><td>{e.name}</td><td>{e.type === "personal" ? "Personal" : "Empresa"}</td><td>{e.active ? "Activa" : "Inactiva"}</td></tr>)}</tbody></table></div>
          {!entities.length && <p className="empty">Primero crea una empresa y una entidad personal si necesitas registrar retiros.</p>}</section></>}

      {tab === "categories" && <><section className="section-heading"><div><p className="eyebrow">CONFIGURACIÓN</p><h1>Catálogos financieros</h1><p>Conceptos reutilizables de ingresos, costos y gastos.</p></div></section>
        {canWrite && <form className="form-panel" onSubmit={createCategory}><label>Concepto<input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="Ej. Venta de servicios" maxLength={100} required /></label>
          <label>Clasificación<select value={categoryKind} onChange={(e) => setCategoryKind(e.target.value as CategoryKind)}>
            {Object.entries(categoriesLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <button className="button-primary" disabled={busy}>Crear concepto</button></form>}
        {canWrite && user && <CatalogImport catalogType="categories" entities={entities} categories={categories} uid={user.uid} />}
        <section className="panel"><div className="panel-title"><h2>Conceptos configurados</h2><span>{categories.length} registrados</span></div>
          <div className="table-wrap"><table><thead><tr><th>Concepto</th><th>Clasificación</th><th>Estado</th></tr></thead><tbody>{categories.slice().sort((a,b) => a.name.localeCompare(b.name)).map((c) =>
            <tr key={c.id}><td>{c.name}</td><td>{categoriesLabels[c.kind]}</td><td>{c.active ? "Activo" : "Inactivo"}</td></tr>)}</tbody></table></div>
          {!categories.length && <p className="empty">Crea al menos un concepto para poder registrar ingresos o gastos.</p>}</section></>}

      {tab === "movements" && <><section className="section-heading"><div><p className="eyebrow">OPERACIÓN</p><h1>Registro de movimientos</h1>
        <p>Un préstamo o transferencia se registra una sola vez y aparece en las dos entidades.</p></div></section>
        {canWrite && <div className="bulk-mode-tabs" role="group" aria-label="Modo de captura">
          <button className={movementMode === "single" ? "active" : ""} type="button" onClick={() => setMovementMode("single")}>Captura individual</button>
          <button className={movementMode === "bulk" ? "active" : ""} type="button" onClick={() => setMovementMode("bulk")}>Importación masiva Excel</button>
        </div>}
        {canWrite && movementMode === "bulk" && user && <BulkImport entities={entities} categories={categories} movements={movements} uid={user.uid} />}
        {canWrite && movementMode === "single" && <form className="movement-form panel" onSubmit={createMovement}><div className="panel-title"><h2>Nuevo movimiento</h2><span>Los movimientos guardados no pueden editarse en v0.1</span></div>
          <div className="form-grid">
            <label>Tipo de movimiento<select value={entryKind} onChange={(e) => { setEntryKind(e.target.value as MovementKind); setCategoryId(""); setLoanId(""); }}>
              {Object.entries(movementLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label>Fecha<input type="date" required value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></label>
            {needsFrom && <label>Entidad de origen<select required value={fromEntityId} onChange={(e) => setFromEntityId(e.target.value)}><option value="">Seleccionar origen</option>
              {sortedEntities.filter((e) => e.active).map((e) => <option value={e.id} key={e.id}>{e.name}</option>)}</select></label>}
            {needsTo && <label>Entidad de destino<select required value={toEntityId} onChange={(e) => setToEntityId(e.target.value)}><option value="">Seleccionar destino</option>
              {sortedEntities.filter((e) => e.active).map((e) => <option value={e.id} key={e.id}>{e.name}</option>)}</select></label>}
            {isOrdinary && <label>Concepto<select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Seleccionar concepto</option>
              {availableCategories.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>}
            {entryKind === "loan_repayment" && <label>Préstamo original<select required value={loanId} onChange={(e) => { const id = e.target.value; setLoanId(id);
              const original = loans.find((l) => l.id === id);
              if (original) { setFromEntityId(original.toEntityId ?? ""); setToEntityId(original.fromEntityId ?? ""); }
            }}><option value="">Seleccionar préstamo</option>
              {loanBalances.filter((l) => l.outstanding > 0).map((loan) => <option key={loan.id} value={loan.id}>{loan.date}: {nameOf(loan.fromEntityId)} → {nameOf(loan.toEntityId)} ({centsToMoney(loan.outstanding)})</option>)}</select></label>}
            <label>Importe total (CAD)<input required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000.00" inputMode="decimal" /></label>
            {isOrdinary && <label>Impuestos incluidos (CAD)<input required value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0.00" inputMode="decimal" /></label>}
            <label>Contraparte / proveedor<input value={counterparty} maxLength={160} onChange={(e) => setCounterparty(e.target.value)} placeholder="Opcional" /></label>
            <label className="wide">Observaciones<input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="Referencia, factura o motivo" /></label>
          </div><div className="form-actions"><p>Una transferencia interna cambia el efectivo, pero no la utilidad del grupo.</p>
            <button className="button-primary" disabled={busy || !entities.length}>{busy ? "Guardando…" : "Guardar movimiento"}</button></div>
        </form>}
        <section className="panel"><div className="panel-title"><h2>Historial de movimientos</h2><span>{movements.length} registros en total</span></div>
          <p className="small-note">El listado incluye todas las entidades y ejercicios. Los filtros del dashboard se aplican solo a sus reportes.</p>
          <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Operación</th><th>Origen</th><th>Destino</th><th>Concepto</th><th>Contraparte</th><th>Importe</th></tr></thead>
            <tbody>{movements.slice().sort((a,b) => b.date.localeCompare(a.date)).slice(0, 200).map((m) => <tr key={m.id}>
              <td>{m.date}</td><td>{movementLabels[m.kind]}</td><td>{nameOf(m.fromEntityId)}</td><td>{nameOf(m.toEntityId)}</td><td>{kindOf(m.categoryId)}</td><td>{m.counterparty || m.description || "—"}</td><td>{centsToMoney(m.amountCents)}</td></tr>)}</tbody></table></div>
          {!movements.length && <p className="empty">No hay movimientos registrados todavía.</p>}
          {movements.length > 200 && <p className="small-note">Vista preliminar: se muestran los 200 movimientos más recientes.</p>}
        </section>
      </>}
    </div>
  </div>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "blue" | "teal" | "amber" }) {
  return <div className={`stat ${tone}`}><span>{label}</span><strong className={value < 0 ? "negative" : ""}>{centsToMoney(value)}</strong></div>;
}
