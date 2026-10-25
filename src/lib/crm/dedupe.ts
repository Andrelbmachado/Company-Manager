// Clientes duplicados: agrupa por documento (CPF/CNPJ), e-mail e telefone normalizados e mescla no cadastro que fica.
// Mesclar move para o que fica tudo o que aponta para os duplicados (contatos, oportunidades, propostas, atividades,
// pedidos, faturas, contas a receber, recorrências, projetos, tickets, OS, leads, tags e documentos), completa campos
// vazios do que fica e faz soft delete dos duplicados com merged_into_id (migration 0011). Sem transação (ver convert.ts):
// a ordem (mover primeiro, excluir por último) deixa o banco coerente se parar no meio, e rodar de novo termina o serviço.
import type { DatabaseLike } from "@/lib/db/demo";
import type { Customer, EntityTag } from "@/types";
import { logActivity } from "./activities";
import { nowIso } from "./queries";

export function normalizeEmail(value: string | null | undefined): string | null {
  const email = (value ?? "").trim().toLowerCase();
  return email.includes("@") ? email : null;
}

/** Só dígitos, sem DDI 55 e sem o zero de operadora; menos de 10 dígitos (DDD + número) não identifica ninguém. */
export function normalizePhone(value: string | null | undefined): string | null {
  let digits = (value ?? "").replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  digits = digits.replace(/^0+/, "");
  return digits.length >= 10 && digits.length <= 11 ? digits : null;
}

/** CPF (11 dígitos) ou CNPJ (14); dígitos todos iguais (000...) não contam. */
export function normalizeDocument(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length !== 11 && digits.length !== 14) return null;
  return /^(\d)\1+$/.test(digits) ? null : digits;
}

export type DuplicateReason = "documento" | "email" | "telefone";

export interface DuplicateGroup {
  /** Cadastro que fica: o mais antigo. */
  keep: string;
  merge: string[];
  reasons: DuplicateReason[];
}

const REASON_ORDER: DuplicateReason[] = ["documento", "email", "telefone"];

function byAge(a: Pick<Customer, "id" | "created_at">, b: Pick<Customer, "id" | "created_at">): number {
  return String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || a.id.localeCompare(b.id);
}

/** Grupos de clientes ativos que compartilham documento, e-mail ou telefone (também em cadeia: A~B por e-mail, B~C por telefone). */
export async function findDuplicateCustomers(db: DatabaseLike, companyId: string): Promise<DuplicateGroup[]> {
  const customers = (await db.select<Customer[]>("SELECT * FROM customers WHERE company_id=? AND deleted_at IS NULL", [companyId])).filter((row) => !row.deleted_at && row.company_id === companyId);
  const parent = new Map(customers.map((customer) => [customer.id, customer.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const reasonsByRoot = new Map<string, Set<DuplicateReason>>();
  const union = (a: string, b: string, reason: DuplicateReason) => {
    const ra = find(a);
    const rb = find(b);
    const reasons = new Set([...(reasonsByRoot.get(ra) ?? []), ...(reasonsByRoot.get(rb) ?? []), reason]);
    if (ra !== rb) parent.set(rb, ra);
    reasonsByRoot.delete(rb);
    reasonsByRoot.set(ra, reasons);
  };
  const keys: [DuplicateReason, (customer: Customer) => string | null][] = [
    ["documento", (customer) => normalizeDocument(customer.document)],
    ["email", (customer) => normalizeEmail(customer.email)],
    ["telefone", (customer) => normalizePhone(customer.phone)],
  ];
  for (const [reason, keyOf] of keys) {
    const firstWithKey = new Map<string, string>();
    for (const customer of customers) {
      const key = keyOf(customer);
      if (!key) continue;
      const first = firstWithKey.get(key);
      if (first) union(first, customer.id, reason);
      else firstWithKey.set(key, customer.id);
    }
  }
  const groups = new Map<string, Customer[]>();
  for (const customer of customers) {
    const root = find(customer.id);
    groups.set(root, [...(groups.get(root) ?? []), customer]);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([root, members]) => {
      const [keep, ...rest] = [...members].sort(byAge);
      const reasons = reasonsByRoot.get(root) ?? new Set<DuplicateReason>();
      return { keep: keep.id, merge: rest.map((customer) => customer.id), reasons: REASON_ORDER.filter((reason) => reasons.has(reason)) };
    })
    .sort((a, b) => a.keep.localeCompare(b.keep));
}

/** Tabelas com customer_id que passam para o cadastro que fica. */
const CUSTOMER_FK_TABLES = ["contacts", "opportunities", "proposals", "crm_activities", "leads", "projects", "tickets", "work_orders", "receivables", "sales_orders", "invoices", "recurring_entries"] as const;

/** Campos que o cadastro que fica herda do duplicado quando estão vazios nele. */
const FILL_FIELDS = ["document", "email", "phone", "segment", "owner_id", "trade_name", "state_registration", "website", "source", "notes", "payment_terms", "credit_limit", "price_list_id"] as const;

const isBlank = (value: unknown) => value == null || (typeof value === "string" && value.trim() === "");

export interface MergeResult {
  keepId: string;
  merged: string[];
}

/** Mescla `mergeIds` em `keepId` (todos ativos e da mesma empresa). `userId` assina a atividade registrada na ficha. */
export async function mergeCustomers(db: DatabaseLike, keepId: string, mergeIds: string[], userId?: string): Promise<MergeResult> {
  const ids = [...new Set(mergeIds)];
  if (ids.length === 0) throw new Error("Escolha ao menos um cadastro para mesclar.");
  if (ids.includes(keepId)) throw new Error("O cadastro que fica não pode ser mesclado nele mesmo.");
  const [keep] = (await db.select<Customer[]>("SELECT * FROM customers WHERE id=? AND deleted_at IS NULL", [keepId])).filter((row) => row.id === keepId && !row.deleted_at);
  if (!keep) throw new Error("Cliente que fica não encontrado (ou excluído).");
  const companyId = keep.company_id;
  const duplicates: Customer[] = [];
  for (const id of ids) {
    const [row] = (await db.select<Customer[]>("SELECT * FROM customers WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, id])).filter((item) => item.id === id && !item.deleted_at);
    if (!row) throw new Error("Um dos cadastros a mesclar não existe, já foi excluído ou é de outra empresa.");
    duplicates.push(row);
  }

  const now = nowIso();
  // 1. Campos vazios do que fica, na ordem dos duplicados (mais antigo primeiro).
  const patch: Record<string, unknown> = {};
  for (const field of FILL_FIELDS) {
    if (!isBlank(keep[field])) continue;
    const source = [...duplicates].sort(byAge).find((row) => !isBlank(row[field]));
    if (source) patch[field] = source[field];
  }
  const fields = Object.keys(patch);
  if (fields.length > 0) {
    await db.execute(`UPDATE customers SET ${fields.map((field) => `${field}=?`).join(", ")}, updated_at=? WHERE company_id=? AND id=?`, [...fields.map((field) => patch[field]), now, companyId, keepId]);
  }

  let keepHasPrimary = (await db.select<{ is_primary: number; deleted_at?: string | null }[]>("SELECT * FROM contacts WHERE company_id=? AND customer_id=? AND deleted_at IS NULL", [companyId, keepId])).some(
    (row) => !row.deleted_at && Number(row.is_primary) === 1,
  );
  const keepTags = new Set(
    (await db.select<EntityTag[]>("SELECT * FROM entity_tags WHERE company_id=? AND entity_type=? AND entity_id=? AND deleted_at IS NULL", [companyId, "customer", keepId]))
      .filter((row) => !row.deleted_at)
      .map((row) => row.tag_id),
  );

  for (const duplicate of duplicates) {
    // 2. Contatos: o principal do duplicado deixa de ser principal se o que fica já tem um.
    if (keepHasPrimary) await db.execute("UPDATE contacts SET is_primary=?, updated_at=? WHERE company_id=? AND customer_id=?", [0, now, companyId, duplicate.id]);
    else {
      keepHasPrimary = (await db.select<{ is_primary: number; deleted_at?: string | null }[]>("SELECT * FROM contacts WHERE company_id=? AND customer_id=? AND deleted_at IS NULL", [companyId, duplicate.id])).some(
        (row) => !row.deleted_at && Number(row.is_primary) === 1,
      );
    }
    // 3. Tudo que aponta para o duplicado.
    for (const table of CUSTOMER_FK_TABLES) {
      await db.execute(`UPDATE ${table} SET customer_id=?, updated_at=? WHERE company_id=? AND customer_id=?`, [keepId, now, companyId, duplicate.id]);
    }
    await db.execute("UPDATE crm_activities SET entity_id=?, updated_at=? WHERE company_id=? AND entity_type=? AND entity_id=?", [keepId, now, companyId, "customer", duplicate.id]);
    await db.execute("UPDATE documents SET entity_id=?, updated_at=? WHERE company_id=? AND entity_type=? AND entity_id=?", [keepId, now, companyId, "customer", duplicate.id]);
    await db.execute("UPDATE attachments SET entity_id=? WHERE company_id=? AND entity_type=? AND entity_id=?", [keepId, companyId, "customer", duplicate.id]);
    // Mesclados antes neste duplicado passam a apontar para o que fica.
    await db.execute("UPDATE customers SET merged_into_id=?, updated_at=? WHERE company_id=? AND merged_into_id=?", [keepId, now, companyId, duplicate.id]);
    // 4. Tags: a que o que fica já tem é excluída (índice único das ativas); as outras passam para ele.
    const tags = (await db.select<EntityTag[]>("SELECT * FROM entity_tags WHERE company_id=? AND entity_type=? AND entity_id=? AND deleted_at IS NULL", [companyId, "customer", duplicate.id])).filter((row) => !row.deleted_at);
    for (const tag of tags) {
      if (keepTags.has(tag.tag_id)) {
        await db.execute("UPDATE entity_tags SET deleted_at=?, updated_at=? WHERE company_id=? AND id=?", [now, now, companyId, tag.id]);
      } else {
        await db.execute("UPDATE entity_tags SET entity_id=?, updated_at=? WHERE company_id=? AND id=?", [keepId, now, companyId, tag.id]);
        keepTags.add(tag.tag_id);
      }
    }
    // 5. Por último, o duplicado sai da lista.
    await db.execute("UPDATE customers SET merged_into_id=?, deleted_at=?, updated_at=? WHERE company_id=? AND id=?", [keepId, now, now, companyId, duplicate.id]);
  }

  if (userId) {
    await logActivity(db, companyId, userId, {
      entity_type: "customer",
      entity_id: keepId,
      customer_id: keepId,
      subject: "Cadastros mesclados",
      body: `Mesclado(s) neste cadastro: ${duplicates.map((row) => row.name).join(", ")}`,
    });
  }
  return { keepId, merged: duplicates.map((row) => row.id) };
}
