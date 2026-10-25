// Fornecedores editados na própria tabela (endereço em colunas): permissão conferida na camada de dados e as regras de
// lib/erp/suppliers (nome, e-mail, avaliação 1 a 5, CPF/CNPJ válido e único) conferidas em todas as linhas antes da
// primeira gravação, inclusive CNPJ repetido entre linhas da mesma gravação.
import type { EditableTableChanges } from "@/components/shared/EditableTable";
import type { DatabaseLike } from "@/lib/db/demo";
import { ADDRESS_FIELDS, documentDigits, saveSupplier, supplierAddress, type SupplierAddress, type SupplierInput } from "@/lib/erp/suppliers";
import { cleanText } from "@/lib/erp/tradeDb";
import { emit } from "@/lib/events/bus";
import type { Supplier } from "@/types";
import { requireTablePermission, rowError, type EditContext } from "@/modules/finance/data/guard";

export interface SupplierRow extends Record<keyof SupplierAddress, string | null> {
  id: string;
  name: string | null;
  trade_name: string | null;
  document: string | null;
  state_registration: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  category: string | null;
  terms: string | null;
  /** "1" a "5" (select) ou vazio. */
  rating: string | null;
  notes: string | null;
  /** Pedidos de compra em andamento (só leitura). */
  open_orders: number | null;
}

export function supplierRow(supplier: Supplier, openOrders: number): SupplierRow {
  const address = supplierAddress(supplier);
  return {
    id: supplier.id,
    name: supplier.name,
    trade_name: supplier.trade_name ?? null,
    document: supplier.document ?? null,
    state_registration: supplier.state_registration ?? null,
    contact_name: supplier.contact_name ?? null,
    email: supplier.email ?? null,
    phone: supplier.phone ?? null,
    website: supplier.website ?? null,
    category: supplier.category ?? null,
    terms: supplier.terms ?? null,
    rating: supplier.rating ? String(supplier.rating) : null,
    notes: supplier.notes ?? null,
    ...(Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, address[field] ?? null])) as Record<keyof SupplierAddress, string | null>),
    open_orders: openOrders,
  };
}

const has = <T extends object>(patch: T, key: keyof T) => Object.prototype.hasOwnProperty.call(patch, key);
const text = (value: unknown) => (value === null || value === undefined ? null : cleanText(String(value)));

/** Linha (gravada + alterações) no formato de entrada de saveSupplier. */
function supplierInput(values: Partial<SupplierRow>, current?: SupplierRow): SupplierInput {
  const pick = (key: keyof SupplierRow) => text(has(values, key) ? values[key] : current?.[key]);
  const rating = pick("rating");
  return {
    name: pick("name") ?? "",
    tradeName: pick("trade_name"),
    document: pick("document"),
    email: pick("email"),
    phone: pick("phone"),
    contactName: pick("contact_name"),
    category: pick("category"),
    terms: pick("terms"),
    rating: rating ? Number(rating) : null,
    website: pick("website"),
    stateRegistration: pick("state_registration"),
    notes: pick("notes"),
    address: Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, pick(field)]).filter(([, value]) => value)),
  };
}

/** As regras de saveSupplier, conferidas antes de gravar qualquer linha (mensagem com o nome da linha). */
function check(label: string, input: SupplierInput): void {
  if (!input.name.trim()) throw rowError(label, "Informe o nome do fornecedor.");
  const email = input.email?.toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw rowError(label, "E-mail inválido.");
  if (input.rating != null && (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)) throw rowError(label, "A avaliação vai de 1 a 5.");
  const digits = documentDigits(input.document);
  if (input.document && digits.length !== 11 && digits.length !== 14) throw rowError(label, "Documento inválido: informe o CPF (11 dígitos) ou o CNPJ (14 dígitos).");
}

/** Grava as alterações da tabela de fornecedores. Devolve os ids dos fornecedores criados. */
export async function saveSupplierChanges(db: DatabaseLike, ctx: EditContext, changes: EditableTableChanges<SupplierRow>): Promise<string[]> {
  requireTablePermission(ctx.role, "suppliers", changes);
  const suppliers = await db.select<Supplier[]>("SELECT * FROM suppliers WHERE company_id=? AND deleted_at IS NULL", [ctx.companyId]);
  const byId = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  // Dono de cada documento depois desta gravação (dígitos → id ou rótulo da linha nova), para achar repetidos.
  const owners = new Map(suppliers.filter((supplier) => documentDigits(supplier.document)).map((supplier) => [documentDigits(supplier.document), { id: supplier.id, name: supplier.name }]));
  const work: { id?: string; input: SupplierInput }[] = [];

  const claim = (label: string, input: SupplierInput, id?: string) => {
    const digits = documentDigits(input.document);
    if (!digits) return;
    const owner = owners.get(digits);
    if (owner && owner.id !== id) throw rowError(label, `Já existe um fornecedor com este CNPJ/CPF: ${owner.name}.`);
    owners.set(digits, { id: id ?? `nova:${label}`, name: input.name.trim() });
  };

  for (const patch of changes.updated) {
    const supplier = byId.get(patch.id);
    if (!supplier) throw rowError("Fornecedor", "fornecedor não encontrado; atualize a lista.");
    const input = supplierInput(patch, supplierRow(supplier, 0));
    const label = input.name.trim() || supplier.name;
    check(label, input);
    // O documento antigo deixa de ser deste fornecedor se ele mudou.
    const before = documentDigits(supplier.document);
    if (before && before !== documentDigits(input.document) && owners.get(before)?.id === supplier.id) owners.delete(before);
    work.push({ id: supplier.id, input });
  }
  for (const entry of work) claim(entry.input.name.trim(), entry.input, entry.id);
  changes.created.forEach((values, index) => {
    const input = supplierInput(values);
    const label = input.name.trim() || `Fornecedor novo ${index + 1}`;
    check(label, input);
    claim(label, input);
    work.push({ input });
  });

  const created: string[] = [];
  for (const item of work) {
    const id = await saveSupplier(db, ctx.companyId, item.input, item.id);
    await emit({ type: item.id ? "supplier.updated" : "supplier.created", companyId: ctx.companyId, actorId: ctx.userId, entityType: "supplier", entityId: id, title: `${item.id ? "Fornecedor atualizado" : "Fornecedor cadastrado"}: ${item.input.name.trim()}`, module: "purchasing" });
    if (!item.id) created.push(id);
  }
  return created;
}
