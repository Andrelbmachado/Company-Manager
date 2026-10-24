// Tags (tags + entity_tags) e segmentos salvos (saved_views) das listas do CRM, e o filtro da lista de clientes.
// O banco demo não aplica os índices únicos (nome da tag, tag ativa por registro): a chave é conferida aqui antes de gravar.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import type { BadgeTone, Customer, EntityTag, SavedView, Tag } from "@/types";
import { clean, fold, nowIso } from "./queries";

export const TAG_COLORS: readonly { value: BadgeTone; label: string }[] = [
  { value: "info", label: "Azul" },
  { value: "success", label: "Verde" },
  { value: "warning", label: "Amarelo" },
  { value: "orange", label: "Laranja" },
  { value: "danger", label: "Vermelho" },
  { value: "violet", label: "Violeta" },
  { value: "neutral", label: "Cinza" },
];

/** Tags ativas (as do tipo pedido e as que valem para qualquer tipo), por nome. */
export async function fetchTags(db: DatabaseLike, companyId: string, entityType?: string): Promise<Tag[]> {
  const rows = (await db.select<Tag[]>("SELECT * FROM tags WHERE company_id=? AND deleted_at IS NULL", [companyId])).filter((row) => !row.deleted_at);
  return rows.filter((row) => !entityType || !row.entity_type || row.entity_type === entityType).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Cria a tag, ou devolve a que já existe com o mesmo nome (sem diferenciar maiúsculas/acentos de espaço nas pontas). */
export async function createTag(db: DatabaseLike, companyId: string, name: string, color: BadgeTone = "neutral", entityType: string | null = "customer"): Promise<string> {
  const label = clean(name);
  if (!label) throw new Error("Informe o nome da tag.");
  const existing = (await db.select<Tag[]>("SELECT * FROM tags WHERE company_id=? AND deleted_at IS NULL", [companyId])).find((row) => !row.deleted_at && row.name.trim().toLowerCase() === label.toLowerCase());
  if (existing) return existing.id;
  const id = uuidv4();
  await db.execute("INSERT INTO tags (id, company_id, name, color, entity_type) VALUES (?,?,?,?,?)", [id, companyId, label, color, entityType]);
  return id;
}

/** Ligações ativas tag ↔ registro de um tipo (ex.: todas as tags de clientes). */
export async function fetchEntityTags(db: DatabaseLike, companyId: string, entityType: string): Promise<EntityTag[]> {
  const rows = await db.select<EntityTag[]>("SELECT * FROM entity_tags WHERE company_id=? AND entity_type=? AND deleted_at IS NULL", [companyId, entityType]);
  return rows.filter((row) => !row.deleted_at);
}

/** Marca o registro com a tag (sem duplicar a ligação ativa). */
export async function addTag(db: DatabaseLike, companyId: string, tagId: string, entityType: string, entityId: string, userId: string | null): Promise<void> {
  const active = (await db.select<EntityTag[]>("SELECT * FROM entity_tags WHERE company_id=? AND tag_id=? AND entity_type=? AND entity_id=? AND deleted_at IS NULL", [companyId, tagId, entityType, entityId])).filter(
    (row) => !row.deleted_at,
  );
  if (active.length > 0) return;
  await db.execute("INSERT INTO entity_tags (id, company_id, tag_id, entity_type, entity_id, created_by) VALUES (?,?,?,?,?,?)", [uuidv4(), companyId, tagId, entityType, entityId, userId]);
}

/** Tira a tag do registro (soft delete da ligação). */
export async function removeTag(db: DatabaseLike, companyId: string, tagId: string, entityType: string, entityId: string): Promise<void> {
  const now = nowIso();
  await db.execute("UPDATE entity_tags SET deleted_at=?, updated_at=? WHERE company_id=? AND tag_id=? AND entity_type=? AND entity_id=? AND deleted_at IS NULL", [now, now, companyId, tagId, entityType, entityId]);
}

/** Mapa registro → ids das tags. */
export function tagsByEntity(links: readonly EntityTag[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const link of links) map.set(link.entity_id, [...(map.get(link.entity_id) ?? []), link.tag_id]);
  return map;
}

// ---------------------------------------------------------------------------------------------------------------
// Segmentos salvos
// ---------------------------------------------------------------------------------------------------------------

export interface CustomerFilters {
  search?: string;
  segment?: string;
  tagId?: string;
  status?: string;
  /** "me" = quem está usando; "none" = sem responsável; ou o id da conta. */
  ownerId?: string;
}

const FILTER_KEYS = ["search", "segment", "tagId", "status", "ownerId"] as const;

/** filters_json → filtros conhecidos (o resto é ignorado; JSON inválido = sem filtro). */
export function parseCustomerFilters(json: string | null | undefined): CustomerFilters {
  try {
    const parsed: unknown = JSON.parse(json ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const filters: CustomerFilters = {};
    for (const key of FILTER_KEYS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string" && value) filters[key] = value;
    }
    return filters;
  } catch {
    return {};
  }
}

/** Segmentos do tipo que a pessoa vê: os dela e os compartilhados (user_id NULL), por nome. */
export async function fetchSavedViews(db: DatabaseLike, companyId: string, entityType: string, userId: string): Promise<SavedView[]> {
  const rows = await db.select<SavedView[]>("SELECT * FROM saved_views WHERE company_id=? AND entity_type=? AND deleted_at IS NULL", [companyId, entityType]);
  return rows.filter((row) => !row.deleted_at && (!row.user_id || row.user_id === userId)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Salva o filtro atual com um nome. `userId` null = compartilhado com a empresa. */
export async function saveView(db: DatabaseLike, companyId: string, userId: string | null, entityType: string, name: string, filters: object): Promise<string> {
  const label = clean(name);
  if (!label) throw new Error("Informe o nome do segmento.");
  const id = uuidv4();
  await db.execute("INSERT INTO saved_views (id, company_id, user_id, entity_type, name, filters_json, is_default) VALUES (?,?,?,?,?,?,?)", [id, companyId, userId, entityType, label, JSON.stringify(filters), 0]);
  return id;
}

export async function deleteSavedView(db: DatabaseLike, companyId: string, id: string): Promise<void> {
  const now = nowIso();
  await db.execute("UPDATE saved_views SET deleted_at=?, updated_at=? WHERE company_id=? AND id=?", [now, now, companyId, id]);
}

// ---------------------------------------------------------------------------------------------------------------
// Filtro da lista de clientes
// ---------------------------------------------------------------------------------------------------------------

const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

/**
 * Filtra a lista de clientes. A busca ignora acento e maiúsculas no nome, nome fantasia e e-mail; com 3+ dígitos,
 * também procura no documento e no telefone sem pontuação.
 */
export function filterCustomers(customers: readonly Customer[], filters: CustomerFilters, context: { tagsByCustomer: Map<string, string[]>; userId: string }): Customer[] {
  const term = fold(filters.search?.trim());
  const termDigits = digits(filters.search);
  const owner = filters.ownerId === "me" ? context.userId : filters.ownerId;
  return customers.filter((customer) => {
    if (term) {
      const inText = [customer.name, customer.trade_name, customer.email].some((field) => fold(field).includes(term));
      const inDigits = termDigits.length >= 3 && [customer.document, customer.phone].some((field) => digits(field).includes(termDigits));
      if (!inText && !inDigits) return false;
    }
    if (filters.segment && customer.segment !== filters.segment) return false;
    if (filters.status && customer.status !== filters.status) return false;
    if (filters.tagId && !(context.tagsByCustomer.get(customer.id) ?? []).includes(filters.tagId)) return false;
    if (owner === "none") {
      if (customer.owner_id) return false;
    } else if (owner && customer.owner_id !== owner) return false;
    return true;
  });
}
