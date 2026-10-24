// Fornecedores: cadastro com CNPJ/CPF único por empresa (comparado só pelos dígitos; o demo não tem UNIQUE),
// e-mail em minúsculas e endereço em address_json. Exclusão é soft delete e não vale com pedido de compra em andamento.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import type { PurchaseOrder, Supplier } from "@/types";
import { activeRow, activeRows, activeRowsBy, cleanText, fail, insertRow, nowIso, updateRow } from "./tradeDb";

export interface SupplierAddress {
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
}

export interface SupplierInput {
  name: string;
  tradeName?: string | null;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  contactName?: string | null;
  category?: string | null;
  /** Condição de pagamento (ex.: "28 dias"). */
  terms?: string | null;
  /** 1 a 5. */
  rating?: number | null;
  website?: string | null;
  stateRegistration?: string | null;
  notes?: string | null;
  address?: SupplierAddress | null;
}

export const ADDRESS_FIELDS: readonly (keyof SupplierAddress)[] = ["logradouro", "numero", "complemento", "bairro", "cidade", "uf", "cep"];

export function documentDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Endereço gravado (address_json), tolerante a JSON vazio ou inválido. */
export function supplierAddress(row: Pick<Supplier, "address_json">): SupplierAddress {
  try {
    const parsed: unknown = JSON.parse(row.address_json || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const source = parsed as Record<string, unknown>;
    return Object.fromEntries(ADDRESS_FIELDS.filter((field) => typeof source[field] === "string" && source[field]).map((field) => [field, String(source[field])]));
  } catch {
    return {};
  }
}

/** Endereço em uma linha ("Rua A, 10 - Centro, Sorocaba/SP"). */
export function formatAddress(address: SupplierAddress): string {
  const street = [address.logradouro, address.numero].filter(Boolean).join(", ");
  const city = [address.cidade, address.uf].filter(Boolean).join("/");
  return [street, address.complemento, address.bairro, city, address.cep].filter(Boolean).join(" - ");
}

const OPEN_STATUSES = new Set(["rascunho", "aprovado", "enviado", "recebido_parcial"]);

export async function saveSupplier(db: DatabaseLike, companyId: string, input: SupplierInput, supplierId?: string): Promise<string> {
  const name = cleanText(input.name) ?? fail("Informe o nome do fornecedor.");
  const email = cleanText(input.email)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("E-mail inválido.");
  const rating = input.rating == null || Number.isNaN(input.rating) ? null : Number(input.rating);
  if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) fail("A avaliação vai de 1 a 5.");
  const document = cleanText(input.document);
  const digits = documentDigits(document);
  if (document && digits.length !== 11 && digits.length !== 14) fail("Documento inválido: informe o CPF (11 dígitos) ou o CNPJ (14 dígitos).");
  if (supplierId && !(await activeRow<Supplier>(db, "suppliers", companyId, supplierId))) fail("Fornecedor não encontrado.");
  if (digits) {
    const clash = (await activeRows<Supplier>(db, "suppliers", companyId)).find((row) => row.id !== supplierId && documentDigits(row.document) === digits);
    if (clash) fail(`Já existe um fornecedor com este CNPJ/CPF: ${clash.name}.`);
  }
  const address = Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, cleanText(input.address?.[field])]).filter(([, value]) => value));
  const now = nowIso();
  const row = {
    name,
    trade_name: cleanText(input.tradeName),
    document,
    email,
    phone: cleanText(input.phone),
    contact_name: cleanText(input.contactName),
    category: cleanText(input.category),
    terms: cleanText(input.terms),
    rating,
    website: cleanText(input.website),
    state_registration: cleanText(input.stateRegistration),
    notes: cleanText(input.notes),
    address_json: JSON.stringify(address),
    updated_at: now,
  };
  if (supplierId) {
    await updateRow(db, "suppliers", companyId, supplierId, row);
    return supplierId;
  }
  const id = uuidv4();
  await insertRow(db, "suppliers", { id, company_id: companyId, ...row, created_at: now });
  return id;
}

/** Soft delete; recusa com pedido de compra em andamento (rascunho, aprovado, enviado ou recebido em parte). */
export async function deleteSupplier(db: DatabaseLike, companyId: string, supplierId: string): Promise<void> {
  if (!(await activeRow<Supplier>(db, "suppliers", companyId, supplierId))) fail("Fornecedor não encontrado.");
  const open = (await activeRowsBy<PurchaseOrder>(db, "purchase_orders", companyId, "supplier_id", supplierId)).filter((order) => OPEN_STATUSES.has(order.status));
  if (open.length > 0) fail("O fornecedor tem pedidos de compra em andamento; conclua ou cancele os pedidos antes de excluir.");
  const now = nowIso();
  await updateRow(db, "suppliers", companyId, supplierId, { deleted_at: now, updated_at: now });
}
