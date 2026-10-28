export type EntityType = "company" | "personal";
export type MovementKind =
  | "income" | "cost" | "expense" | "transfer"
  | "loan" | "loan_repayment" | "personal_draw";
export type CategoryKind = "income" | "cost" | "expense";
export type UserRole = "admin" | "editor" | "viewer";

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  active: boolean;
}
export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  active: boolean;
}
export interface Movement {
  id: string;
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
  createdBy: string;
  externalRef?: string;
  userFolio?: string;
}

export const movementLabels: Record<MovementKind, string> = {
  income: "Ingreso",
  cost: "Costo directo",
  expense: "Gasto operativo",
  transfer: "Transferencia",
  loan: "Préstamo entre entidades",
  loan_repayment: "Abono a préstamo",
  personal_draw: "Retiro para uso personal",
};
export const categoriesLabels: Record<CategoryKind, string> = {
  income: "Ingresos", cost: "Costos", expense: "Gastos",
};

export function centsToMoney(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency", currency: "CAD", maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function dollarsToCents(raw: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(raw.trim())) return NaN;
  return Math.round(Number(raw) * 100);
}

export function selectedCashDelta(m: Movement, selectedIds: Set<string>): number {
  const outgoing = m.fromEntityId && selectedIds.has(m.fromEntityId) ? m.amountCents : 0;
  const incoming = m.toEntityId && selectedIds.has(m.toEntityId) ? m.amountCents : 0;
  return incoming - outgoing;
}

// Indicadores preliminares por criterio de captura; NO sustituyen un estado contable.
export function profitability(movements: Movement[], selected: Set<string>) {
  const totals = { income: 0, cost: 0, expense: 0 };
  for (const m of movements) {
    if (m.kind === "income" && m.toEntityId && selected.has(m.toEntityId)) {
      totals.income += m.amountCents - m.taxCents;
    } else if (m.kind === "cost" && m.fromEntityId && selected.has(m.fromEntityId)) {
      totals.cost += m.amountCents - m.taxCents;
    } else if (m.kind === "expense" && m.fromEntityId && selected.has(m.fromEntityId)) {
      totals.expense += m.amountCents - m.taxCents;
    }
  }
  return { ...totals, gross: totals.income - totals.cost,
    operating: totals.income - totals.cost - totals.expense };
}
