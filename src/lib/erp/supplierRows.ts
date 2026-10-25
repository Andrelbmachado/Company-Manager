// Fornecedores pela tabela editável (Compras › Fornecedores): linhas com o endereço aberto em colunas e os pedidos em
// andamento; gravação só dos campos alterados (endereço mesclado com o gravado), linha nova com o id da tela (salvar de
// novo não duplica) e tudo conferido antes de gravar, com as mesmas regras de saveSupplier (nome obrigatório, e-mail,
// avaliação 1 a 5, CPF/CNPJ válido e único por empresa, comparado só pelos dígitos). Permissão: `suppliers`.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { assertCan, assertCanSaveRows, type Actor } from "@/lib/inventory/permission";
import type { Supplier } from "@/types";
import { ADDRESS_FIELDS, deleteSupplier, documentDigits, supplierAddress, type SupplierAddress } from "./suppliers";
import { activeRows, cleanText, fail, insertRow, nowIso, updateRow } from "./tradeDb";

/** Pedido de compra em andamento (o mesmo critério da exclusão). */
export const OPEN_PURCHASE_STATUSES: readonly string[] = ["rascunho", "aprovado", "enviado", "recebido_parcial"];

export interface SupplierTableRow extends Supplier, Record<keyof SupplierAddress, string | null> {
  open_orders: number;
}

/** Linhas da tabela: endereço em colunas, pedidos em andamento contados. */
export function toSupplierTableRows(suppliers: readonly Supplier[], orders: readonly { supplier_id: string; status: string }[]): SupplierTableRow[] {
  return suppliers.map((supplier) => {
    const address = supplierAddress(supplier);
    return {
      ...supplier,
      ...(Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, address[field] ?? null])) as Record<keyof SupplierAddress, string | null>),
      open_orders: orders.filter((order) => order.supplier_id === supplier.id && OPEN_PURCHASE_STATUSES.includes(order.status)).length,
    };
  });
}

const COLUMNS = ["name", "trade_name", "document", "email", "phone", "contact_name", "category", "terms", "rating", "website", "state_registration", "notes"] as const;
type Column = (typeof COLUMNS)[number];
export type SupplierRowInput = Partial<Record<Column | keyof SupplierAddress, unknown>> & { id?: string };

const text = (value: unknown): string | null => (value === null || value === undefined ? null : cleanText(String(value)));

function validate(source: SupplierRowInput, context: string): Record<Column, string | number | null> {
  const name = text(source.name) ?? fail(`${context}: informe o nome do fornecedor.`);
  const email = text(source.email)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`${context}: E-mail inválido.`);
  const ratingText = text(source.rating);
  const rating = ratingText === null ? null : Number(ratingText.replace(",", "."));
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) fail(`${context}: a avaliação vai de 1 a 5.`);
  const document = text(source.document);
  const digits = documentDigits(document);
  if (document && digits.length !== 11 && digits.length !== 14) fail(`${context}: Documento inválido: informe o CPF (11 dígitos) ou o CNPJ (14 dígitos).`);
  return {
    name,
    trade_name: text(source.trade_name),
    document,
    email,
    phone: text(source.phone),
    contact_name: text(source.contact_name),
    category: text(source.category),
    terms: text(source.terms),
    rating,
    website: text(source.website),
    state_registration: text(source.state_registration),
    notes: text(source.notes),
  };
}

interface Plan {
  kind: "create" | "update";
  id: string;
  values: Record<Column, string | number | null>;
  columns: Column[];
  address: Record<string, string> | null;
}

/**
 * Grava a tabela de fornecedores: `updated` = só os campos alterados (e o id), `created` = cadastros novos com o id da
 * tela. Exige `edit`/`create` em `suppliers`. Uma linha com erro e nenhuma é gravada.
 */
export async function saveSupplierRows(
  db: DatabaseLike,
  companyId: string,
  actor: Actor,
  changes: { updated: readonly (SupplierRowInput & { id: string })[]; created: readonly SupplierRowInput[] },
): Promise<{ created: string[]; updated: string[] }> {
  assertCanSaveRows(actor, "suppliers", "fornecedores", changes);
  const current = await activeRows<Supplier>(db, "suppliers", companyId);
  const byId = new Map(current.map((row) => [row.id, row]));
  const plans: Plan[] = [];

  for (const patch of changes.updated) {
    const row = byId.get(patch.id) ?? fail("Fornecedor não encontrado (excluído ou de outra empresa). Atualize a lista.");
    const columns = COLUMNS.filter((column) => column in patch);
    const addressFields = ADDRESS_FIELDS.filter((field) => field in patch);
    if (columns.length === 0 && addressFields.length === 0) continue;
    const merged: SupplierRowInput = { ...row, ...Object.fromEntries(columns.map((column) => [column, patch[column]])) };
    const values = validate(merged, `"${row.name}"`);
    let address: Record<string, string> | null = null;
    if (addressFields.length > 0) {
      const next: Record<string, unknown> = { ...supplierAddress(row), ...Object.fromEntries(addressFields.map((field) => [field, patch[field]])) };
      address = Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, text(next[field])]).filter(([, value]) => value)) as Record<string, string>;
    }
    plans.push({ kind: "update", id: row.id, values, columns, address });
  }
  for (const [index, row] of changes.created.entries()) {
    const id = text(row.id) ?? uuidv4();
    if ((await db.select<Supplier[]>("SELECT * FROM suppliers WHERE company_id=? AND id=?", [companyId, id]))[0]) continue;
    const values = validate(row, `Linha nova ${index + 1}`);
    const address = Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, text(row[field])]).filter(([, value]) => value)) as Record<string, string>;
    plans.push({ kind: "create", id, values, columns: [...COLUMNS], address });
  }

  // CPF/CNPJ único no conjunto final (troca entre dois cadastros na mesma gravação vale).
  const finalDocs = new Map(current.map((row) => [row.id, { name: row.name, digits: documentDigits(row.document) }]));
  for (const plan of plans) finalDocs.set(plan.id, { name: String(plan.values.name), digits: documentDigits(text(plan.values.document)) });
  for (const plan of plans) {
    if (!plan.columns.includes("document") || !plan.values.document) continue;
    const digits = documentDigits(String(plan.values.document));
    const clash = [...finalDocs.entries()].find(([id, other]) => id !== plan.id && other.digits === digits);
    if (clash) fail(`Já existe um fornecedor com este CNPJ/CPF: ${clash[1].name}.`);
  }

  const result = { created: [] as string[], updated: [] as string[] };
  const now = nowIso();
  for (const plan of plans) {
    if (plan.kind === "update") {
      const patch: Record<string, unknown> = Object.fromEntries(plan.columns.map((column) => [column, plan.values[column]]));
      if (plan.address) patch.address_json = JSON.stringify(plan.address);
      await updateRow(db, "suppliers", companyId, plan.id, { ...patch, updated_at: now });
      result.updated.push(plan.id);
    } else {
      await insertRow(db, "suppliers", { id: plan.id, company_id: companyId, ...plan.values, address_json: JSON.stringify(plan.address ?? {}), created_at: now, updated_at: now });
      result.created.push(plan.id);
    }
  }
  return result;
}

/** Exclui (soft delete) pelo botão da ficha: exige `delete` em `suppliers`; as regras são as de deleteSupplier. */
export async function deleteSupplierRow(db: DatabaseLike, companyId: string, actor: Actor, supplierId: string): Promise<void> {
  assertCan(actor, "delete", "suppliers", "fornecedores");
  await deleteSupplier(db, companyId, supplierId);
}
