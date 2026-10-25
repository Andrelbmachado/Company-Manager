// Iniciativas de desenvolvimento de produtos (módulo `products`, recurso `product_development`). Não há tabela
// própria no schema: a lista fica por empresa na tabela `settings` (chave abaixo, valor = JSON com os itens).
// Gravar relê a lista do banco e aplica só o que mudou, por id. Permissão conferida aqui, não só na tela.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { can } from "@/lib/permissions/rbac";
import { getCompanySetting, setCompanySetting } from "@/lib/settings/companySettings";
import type { CalendarItem } from "@/components/shared/CalendarView";
import type { Role } from "@/types";

export const INITIATIVES_SETTING = "product_development.initiatives";

export type InitiativeType = "fisico" | "digital";
export type InitiativeStatus = "planejado" | "descoberta" | "em_desenvolvimento" | "em_validacao" | "lancado" | "pausado";

export interface ProductInitiative {
  id: string;
  name: string;
  type: InitiativeType;
  status: InitiativeStatus;
  owner: string | null;
  next_milestone: string | null;
  /** Data do próximo marco ('YYYY-MM-DD'). */
  milestone_date: string | null;
  created_at: string;
  updated_at: string;
}

export const INITIATIVE_TYPE_OPTIONS: { value: InitiativeType; label: string }[] = [
  { value: "fisico", label: "Físico" },
  { value: "digital", label: "Digital" },
];

export const INITIATIVE_STATUS_OPTIONS: { value: InitiativeStatus; label: string }[] = [
  { value: "planejado", label: "Planejado" },
  { value: "descoberta", label: "Descoberta" },
  { value: "em_desenvolvimento", label: "Em desenvolvimento" },
  { value: "em_validacao", label: "Em validação" },
  { value: "lancado", label: "Lançado" },
  { value: "pausado", label: "Pausado" },
];

/** Em andamento = nem lançada nem pausada. */
export const isActiveInitiative = (item: Pick<ProductInitiative, "status">) => item.status !== "lancado" && item.status !== "pausado";

export type InitiativeFields = Partial<Omit<ProductInitiative, "id" | "created_at" | "updated_at">>;

export interface InitiativeChanges {
  updated: (InitiativeFields & { id: string })[];
  created: InitiativeFields[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = new Set(INITIATIVE_TYPE_OPTIONS.map((option) => option.value));
const STATUSES = new Set(INITIATIVE_STATUS_OPTIONS.map((option) => option.value));

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const clean = String(value).trim();
  return clean ? clean : null;
}

function parse(value: unknown): ProductInitiative | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = text(raw.name);
  if (typeof raw.id !== "string" || !name || !TYPES.has(raw.type as InitiativeType)) return null;
  return {
    id: raw.id,
    name,
    type: raw.type as InitiativeType,
    status: STATUSES.has(raw.status as InitiativeStatus) ? (raw.status as InitiativeStatus) : "planejado",
    owner: text(raw.owner),
    next_milestone: text(raw.next_milestone),
    milestone_date: typeof raw.milestone_date === "string" && DATE.test(raw.milestone_date) ? raw.milestone_date : null,
    created_at: typeof raw.created_at === "string" ? raw.created_at : "",
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : "",
  };
}

/** Lista gravada (na ordem em que foi criada). JSON quebrado ou item inválido é ignorado. */
export async function loadInitiatives(db: DatabaseLike, companyId: string): Promise<ProductInitiative[]> {
  const value = await getCompanySetting(db, companyId, INITIATIVES_SETTING);
  if (!Array.isArray(value)) return [];
  return value.map(parse).filter((item): item is ProductInitiative => item !== null);
}

function validate(fields: InitiativeFields, creating: boolean): void {
  if ((creating || "name" in fields) && !text(fields.name)) throw new Error("Informe o nome da iniciativa.");
  if ((creating || "type" in fields) && !TYPES.has(fields.type as InitiativeType)) throw new Error("Tipo inválido: escolha Físico ou Digital.");
  if (fields.status != null && !STATUSES.has(fields.status)) throw new Error("Status inválido.");
  if (fields.milestone_date != null && !DATE.test(fields.milestone_date)) throw new Error("Data do marco inválida.");
}

function apply(item: ProductInitiative, fields: InitiativeFields, now: string): ProductInitiative {
  const next = { ...item, updated_at: now };
  if ("name" in fields) next.name = text(fields.name) ?? item.name;
  if (fields.type) next.type = fields.type;
  if (fields.status) next.status = fields.status;
  if ("owner" in fields) next.owner = text(fields.owner);
  if ("next_milestone" in fields) next.next_milestone = text(fields.next_milestone);
  if ("milestone_date" in fields) next.milestone_date = fields.milestone_date ?? null;
  return next;
}

/** Cria e altera iniciativas (só os campos enviados). Exige `create`/`edit` em `product_development`. */
export async function saveInitiativeChanges(db: DatabaseLike, companyId: string, role: Role, changes: InitiativeChanges): Promise<{ created: string[] }> {
  if (changes.created.length && !can(role, "create", "product_development")) throw new Error("Seu perfil não tem permissão para adicionar iniciativas de produto.");
  if (changes.updated.length && !can(role, "edit", "product_development")) throw new Error("Seu perfil não tem permissão para editar iniciativas de produto.");
  changes.created.forEach((fields) => validate(fields, true));
  changes.updated.forEach((fields) => validate(fields, false));

  const now = new Date().toISOString();
  const list = await loadInitiatives(db, companyId);
  for (const fields of changes.updated) {
    const index = list.findIndex((item) => item.id === fields.id);
    if (index < 0) throw new Error("Iniciativa não encontrada (pode ter sido excluída por outra pessoa).");
    list[index] = apply(list[index], fields, now);
  }
  const created: string[] = [];
  for (const fields of changes.created) {
    const base: ProductInitiative = { id: uuidv4(), name: "", type: fields.type as InitiativeType, status: "planejado", owner: null, next_milestone: null, milestone_date: null, created_at: now, updated_at: now };
    const item = apply(base, fields, now);
    list.push(item);
    created.push(item.id);
  }
  await setCompanySetting(db, companyId, INITIATIVES_SETTING, list);
  return { created };
}

/** Exclui uma iniciativa. Exige `delete` em `product_development`. */
export async function deleteInitiative(db: DatabaseLike, companyId: string, role: Role, id: string): Promise<void> {
  if (!can(role, "delete", "product_development")) throw new Error("Seu perfil não tem permissão para excluir iniciativas de produto.");
  const list = await loadInitiatives(db, companyId);
  await setCompanySetting(db, companyId, INITIATIVES_SETTING, list.filter((item) => item.id !== id));
}

/** Próximos marcos com data, para o CalendarView (dia inteiro). */
export function milestoneItems(list: ProductInitiative[]): CalendarItem[] {
  return list
    .filter((item) => item.milestone_date)
    .map((item) => ({
      id: item.id,
      title: item.next_milestone ? `${item.name}: ${item.next_milestone}` : item.name,
      start: item.milestone_date as string,
      allDay: true,
      sourceLabel: INITIATIVE_TYPE_OPTIONS.find((option) => option.value === item.type)?.label,
    }));
}
