// Dados do calendário: agendas conectadas por link (calendar_sources), eventos criados no app (calendar_events sem
// source_id) e ausências aprovadas do RH. A permissão do recurso `calendar` é conferida aqui também, não só na tela:
// `create` conecta a própria agenda e cria eventos próprios; `edit`/`delete` mexem nos de todos; `export` baixa o
// .ics da empresa. Eventos sincronizados só mudam na agenda de origem. SQL nos padrões do banco demo.
import { v4 as uuidv4 } from "uuid";
import type { CalendarItem } from "@/components/shared/CalendarView";
import { addDays, isDayKey, parseInstant, zonedParts } from "@/components/shared/calendar/layout";
import type { DatabaseLike } from "@/lib/db/demo";
import { can } from "@/lib/permissions/rbac";
import type { CalendarEvent, CalendarEventKind, CalendarSource, Employee, HrRequest, Role } from "@/types";
import { absenceTitle, buildCompanyFeed, EVENT_KIND_LABEL, FEED_TIME_ZONE } from "./feed";
import { normalizeCalendarUrl } from "./sync";

export interface CalendarActor {
  companyId: string;
  userId: string;
  role: Role;
}

interface WriteOptions {
  now?: Date;
}

const MAX_NAME = 120;
const MAX_TITLE = 300;
const MAX_TEXT = 2_000;

const allowed = (actor: CalendarActor, action: "view" | "create" | "edit" | "delete" | "export") => can(actor.role, action, "calendar");
const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const cleanMultiline = (value: unknown, limit: number) => {
  const text = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
  return text ? text.slice(0, limit) : null;
};
const has = <T extends object>(input: T, key: keyof T) => Object.prototype.hasOwnProperty.call(input, key);

// ── agendas conectadas ────────────────────────────────────────────

export interface SourceInput {
  name?: string | null;
  url?: string | null;
  user_id?: string | null;
}

export interface Changes<T> {
  created: T[];
  updated: (T & { id: string })[];
}

/** Pode alterar a agenda: gerencia todas (`edit`) ou ela é sua e o perfil conecta agendas (`create`). */
export const canManageSource = (actor: CalendarActor, source: Pick<CalendarSource, "user_id">) => allowed(actor, "edit") || (allowed(actor, "create") && source.user_id === actor.userId);

export const canDeleteSource = (actor: CalendarActor, source: Pick<CalendarSource, "user_id">) => allowed(actor, "delete") || (allowed(actor, "create") && source.user_id === actor.userId);

export async function listSources(db: DatabaseLike, companyId: string): Promise<CalendarSource[]> {
  const rows = await db.select<CalendarSource[]>("SELECT * FROM calendar_sources WHERE company_id = ? AND deleted_at IS NULL", [companyId]);
  return rows.filter((row) => !row.deleted_at).sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id));
}

function sourceName(value: unknown): string {
  const name = clean(value);
  if (!name) throw new Error("Informe o nome da agenda.");
  return name.slice(0, MAX_NAME);
}

function sourceUrl(value: unknown): string {
  const url = normalizeCalendarUrl(typeof value === "string" ? value : null);
  if (!url) throw new Error("Link da agenda inválido: use o endereço http(s) ou webcal do formato iCal (.ics).");
  return url;
}

async function findSource(db: DatabaseLike, companyId: string, id: string): Promise<CalendarSource> {
  const [row] = (await db.select<CalendarSource[]>("SELECT * FROM calendar_sources WHERE company_id = ? AND id = ? AND deleted_at IS NULL", [companyId, id])).filter((source) => !source.deleted_at);
  if (!row) throw new Error("Agenda não encontrada.");
  return row;
}

/**
 * Grava as agendas da tabela (tudo validado antes da primeira escrita). Quem não gerencia conecta a agenda no
 * próprio nome. Trocar o link zera a última sincronização (a tela sincroniza de novo). Devolve os ids criados.
 */
export async function saveSources(db: DatabaseLike, actor: CalendarActor, changes: Changes<SourceInput>, options: WriteOptions = {}): Promise<string[]> {
  if (changes.created.length && !allowed(actor, "create")) throw new Error("Seu perfil não tem permissão para conectar agendas.");
  const manages = allowed(actor, "edit");
  const inserts = changes.created.map((input) => ({
    id: uuidv4(),
    name: sourceName(input.name),
    url: sourceUrl(input.url),
    user_id: manages ? (has(input, "user_id") ? (input.user_id ?? null) : actor.userId) : actor.userId,
  }));
  const updates: { id: string; sets: Record<string, unknown> }[] = [];
  for (const input of changes.updated) {
    const current = await findSource(db, actor.companyId, input.id);
    if (!canManageSource(actor, current)) throw new Error("Você só pode alterar as agendas que conectou.");
    const sets: Record<string, unknown> = {};
    if (has(input, "name")) sets.name = sourceName(input.name);
    if (has(input, "url")) {
      const url = sourceUrl(input.url);
      if (url !== current.url) Object.assign(sets, { url, last_sync_at: null, last_error: null });
    }
    if (has(input, "user_id") && (input.user_id ?? null) !== (current.user_id ?? null)) {
      if (!manages) throw new Error("Seu perfil não tem permissão para mudar o dono da agenda.");
      sets.user_id = input.user_id ?? null;
    }
    if (Object.keys(sets).length) updates.push({ id: current.id, sets });
  }

  const stamp = (options.now ?? new Date()).toISOString();
  for (const row of inserts) {
    await db.execute("INSERT INTO calendar_sources (id, company_id, user_id, name, kind, url, created_at, updated_at) VALUES (?, ?, ?, ?, 'ical', ?, ?, ?)", [
      row.id,
      actor.companyId,
      row.user_id,
      row.name,
      row.url,
      stamp,
      stamp,
    ]);
  }
  for (const { id, sets } of updates) {
    const columns = [...Object.keys(sets), "updated_at"];
    await db.execute(`UPDATE calendar_sources SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`, [
      ...Object.values(sets),
      stamp,
      id,
      actor.companyId,
    ]);
  }
  // Eventos sincronizados herdam o dono da agenda.
  for (const { id, sets } of updates) {
    if (has(sets, "user_id")) {
      await db.execute("UPDATE calendar_events SET user_id = ?, updated_at = ? WHERE company_id = ? AND source_id = ? AND deleted_at IS NULL", [sets.user_id, stamp, actor.companyId, id]);
    }
  }
  return inserts.map((row) => row.id);
}

/** Exclui a agenda (soft delete) e os eventos que vieram dela. */
export async function deleteSource(db: DatabaseLike, actor: CalendarActor, id: string, options: WriteOptions = {}): Promise<void> {
  const current = await findSource(db, actor.companyId, id);
  if (!canDeleteSource(actor, current)) throw new Error("Você só pode excluir as agendas que conectou.");
  const stamp = (options.now ?? new Date()).toISOString();
  await db.execute("UPDATE calendar_sources SET deleted_at = ?, updated_at = ? WHERE id = ? AND company_id = ?", [stamp, stamp, id, actor.companyId]);
  await db.execute("UPDATE calendar_events SET deleted_at = ?, updated_at = ? WHERE company_id = ? AND source_id = ? AND deleted_at IS NULL", [stamp, stamp, actor.companyId, id]);
}

// ── eventos do app ────────────────────────────────────────────────

/** Tipos de evento criados no app ("externo" é só das agendas conectadas). */
export const LOCAL_EVENT_KINDS: CalendarEventKind[] = ["reuniao", "ausencia", "ferias", "evento"];

export interface LocalEventInput {
  title?: string | null;
  kind?: string | null;
  /** Dia inteiro: 'YYYY-MM-DD'. Com horário: instante ISO (ou "YYYY-MM-DDTHH:MM" no horário de São Paulo). */
  starts_at?: string | null;
  /** Fim exclusivo no dia inteiro (como no iCal); vazio = um dia / sem duração. */
  ends_at?: string | null;
  all_day?: number | boolean | null;
  location?: string | null;
  description?: string | null;
  user_id?: string | null;
}

const isLocal = (event: Pick<CalendarEvent, "source_id">) => !event.source_id;
const SYNCED = "Eventos de agendas conectadas são alterados na agenda de origem.";

export const canManageEvent = (actor: CalendarActor, event: Pick<CalendarEvent, "source_id" | "user_id">) =>
  isLocal(event) && (allowed(actor, "edit") || (allowed(actor, "create") && event.user_id === actor.userId));

export const canDeleteEvent = (actor: CalendarActor, event: Pick<CalendarEvent, "source_id" | "user_id">) =>
  isLocal(event) && (allowed(actor, "delete") || (allowed(actor, "create") && event.user_id === actor.userId));

interface EventValues {
  title: string;
  kind: CalendarEventKind;
  starts_at: string;
  ends_at: string | null;
  all_day: number;
  location: string | null;
  description: string | null;
}

const truthy = (value: unknown) => value === true || value === 1 || value === "1" || value === "true";

function eventValues(input: LocalEventInput): EventValues {
  const title = clean(input.title);
  if (!title) throw new Error("Informe o título do evento.");
  const kind = (input.kind ?? "evento") as CalendarEventKind;
  if (!LOCAL_EVENT_KINDS.includes(kind)) throw new Error("Tipo de evento inválido: use reunião, ausência, férias ou evento.");
  const startText = typeof input.starts_at === "string" ? input.starts_at.trim() : "";
  const allDay = input.all_day === undefined || input.all_day === null ? isDayKey(startText) : truthy(input.all_day);
  const base = { title: title.slice(0, MAX_TITLE), kind, location: cleanMultiline(input.location, MAX_TEXT)?.replace(/\n/g, " ") ?? null, description: cleanMultiline(input.description, MAX_TEXT) };

  if (allDay) {
    const parsed = isDayKey(startText) ? startText : (() => {
      const instant = startText ? parseInstant(startText, FEED_TIME_ZONE) : null;
      return instant ? zonedParts(instant, FEED_TIME_ZONE).day : null;
    })();
    if (!parsed) throw new Error("Data de início inválida.");
    const endText = typeof input.ends_at === "string" ? input.ends_at.trim() : "";
    if (endText && !isDayKey(endText)) throw new Error("Data de fim inválida.");
    if (endText && endText <= parsed) throw new Error("A data de fim deve ser depois do início.");
    return { ...base, starts_at: parsed, ends_at: endText || addDays(parsed, 1), all_day: 1 };
  }

  const start = startText ? parseInstant(startText, FEED_TIME_ZONE) : null;
  if (!start) throw new Error("Data e hora de início inválidas.");
  const endText = typeof input.ends_at === "string" ? input.ends_at.trim() : "";
  let endsAt: string | null = null;
  if (endText) {
    const end = parseInstant(endText, FEED_TIME_ZONE);
    if (!end) throw new Error("Data e hora de fim inválidas.");
    if (end.getTime() <= start.getTime()) throw new Error("O fim deve ser depois do início.");
    endsAt = end.toISOString();
  }
  return { ...base, starts_at: start.toISOString(), ends_at: endsAt, all_day: 0 };
}

async function findEvent(db: DatabaseLike, companyId: string, id: string): Promise<CalendarEvent> {
  const [row] = (await db.select<CalendarEvent[]>("SELECT * FROM calendar_events WHERE company_id = ? AND id = ? AND deleted_at IS NULL", [companyId, id])).filter((event) => !event.deleted_at);
  if (!row) throw new Error("Evento não encontrado.");
  return row;
}

function ownerFor(actor: CalendarActor, input: LocalEventInput): string | null {
  return allowed(actor, "edit") && has(input, "user_id") ? (input.user_id ?? null) : actor.userId;
}

async function insertEvent(db: DatabaseLike, actor: CalendarActor, values: EventValues, userId: string | null, stamp: string): Promise<string> {
  const id = uuidv4();
  await db.execute(
    "INSERT INTO calendar_events (id, company_id, source_id, uid, title, starts_at, ends_at, all_day, location, description, user_id, kind, created_at, updated_at) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, actor.companyId, values.title, values.starts_at, values.ends_at, values.all_day, values.location, values.description, userId, values.kind, stamp, stamp],
  );
  return id;
}

/** Cria um evento no app. Quem não gerencia cria no próprio nome. Devolve o id. */
export async function createLocalEvent(db: DatabaseLike, actor: CalendarActor, input: LocalEventInput, options: WriteOptions = {}): Promise<string> {
  if (!allowed(actor, "create")) throw new Error("Seu perfil não tem permissão para criar eventos.");
  const values = eventValues(input);
  return insertEvent(db, actor, values, ownerFor(actor, input), (options.now ?? new Date()).toISOString());
}

/** Grava os eventos da tabela (tudo validado antes da primeira escrita); campos ausentes ficam como estão. */
export async function saveLocalEvents(db: DatabaseLike, actor: CalendarActor, changes: Changes<LocalEventInput>, options: WriteOptions = {}): Promise<string[]> {
  if (changes.created.length && !allowed(actor, "create")) throw new Error("Seu perfil não tem permissão para criar eventos.");
  const creates = changes.created.map((input) => ({ values: eventValues(input), userId: ownerFor(actor, input) }));
  const updates: { id: string; values: EventValues; userId: string | null }[] = [];
  for (const input of changes.updated) {
    const current = await findEvent(db, actor.companyId, input.id);
    if (!isLocal(current)) throw new Error(SYNCED);
    if (!canManageEvent(actor, current)) throw new Error("Você só pode alterar os seus eventos.");
    const merged: LocalEventInput = {
      title: has(input, "title") ? input.title : current.title,
      kind: has(input, "kind") ? input.kind : current.kind,
      starts_at: has(input, "starts_at") ? input.starts_at : current.starts_at,
      ends_at: has(input, "ends_at") ? input.ends_at : current.ends_at,
      all_day: has(input, "all_day") ? input.all_day : current.all_day,
      location: has(input, "location") ? input.location : current.location,
      description: has(input, "description") ? input.description : current.description,
    };
    let userId = current.user_id ?? null;
    if (has(input, "user_id") && (input.user_id ?? null) !== userId) {
      if (!allowed(actor, "edit")) throw new Error("Seu perfil não tem permissão para mudar a pessoa do evento.");
      userId = input.user_id ?? null;
    }
    updates.push({ id: current.id, values: eventValues(merged), userId });
  }

  const stamp = (options.now ?? new Date()).toISOString();
  const ids: string[] = [];
  for (const entry of creates) ids.push(await insertEvent(db, actor, entry.values, entry.userId, stamp));
  for (const { id, values, userId } of updates) {
    await db.execute(
      "UPDATE calendar_events SET title = ?, kind = ?, starts_at = ?, ends_at = ?, all_day = ?, location = ?, description = ?, user_id = ?, updated_at = ? WHERE id = ? AND company_id = ? AND deleted_at IS NULL",
      [values.title, values.kind, values.starts_at, values.ends_at, values.all_day, values.location, values.description, userId, stamp, id, actor.companyId],
    );
  }
  return ids;
}

export async function deleteLocalEvent(db: DatabaseLike, actor: CalendarActor, id: string, options: WriteOptions = {}): Promise<void> {
  const current = await findEvent(db, actor.companyId, id);
  if (!isLocal(current)) throw new Error(SYNCED);
  if (!canDeleteEvent(actor, current)) throw new Error("Você só pode excluir os seus eventos.");
  const stamp = (options.now ?? new Date()).toISOString();
  await db.execute("UPDATE calendar_events SET deleted_at = ?, updated_at = ? WHERE id = ? AND company_id = ?", [stamp, stamp, id, actor.companyId]);
}

// ── leitura para a tela ───────────────────────────────────────────

export interface CalendarData {
  sources: CalendarSource[];
  events: CalendarEvent[];
  requests: HrRequest[];
  employees: Employee[];
}

/** Tudo que o calendário mostra (o demo não filtra por período: o recorte é feito em TypeScript). */
export async function loadCalendarData(db: DatabaseLike, companyId: string): Promise<CalendarData> {
  const [sources, events, requests, employees] = [
    await listSources(db, companyId),
    (await db.select<CalendarEvent[]>("SELECT * FROM calendar_events WHERE company_id = ? AND deleted_at IS NULL", [companyId])).filter((event) => !event.deleted_at),
    (await db.select<HrRequest[]>("SELECT * FROM hr_requests WHERE company_id = ? AND deleted_at IS NULL", [companyId])).filter((request) => !request.deleted_at && request.status === "aprovada"),
    await db.select<Employee[]>("SELECT * FROM employees WHERE company_id = ? AND deleted_at IS NULL", [companyId]),
  ];
  return { sources, events, requests, employees };
}

export type CalendarOrigin = "agenda" | "app" | "rh";

export interface CalendarEntry extends CalendarItem {
  origin: CalendarOrigin;
  kind: CalendarEventKind;
  /** Conta da pessoa do evento (dono da agenda, pessoa da ausência); null = empresa ou colaborador sem conta. */
  userId: string | null;
  /** Ausência do RH: o colaborador e o nome dele (que pode não ter conta no app). */
  employeeId?: string | null;
  personName?: string | null;
  location?: string | null;
  description?: string | null;
  /** Evento gravado (agendas e app); ausência do RH não tem. */
  event?: CalendarEvent;
}

/** Filtro por funcionário: a conta da pessoa ou o colaborador do RH (que traz também os eventos da conta dele). */
export interface CalendarFilter {
  userId?: string | null;
  employeeId?: string | null;
}

/** Valor do filtro para colaborador sem conta no app (os demais usam o id da conta). */
export const EMPLOYEE_FILTER_PREFIX = "funcionario:";

export function parsePersonFilter(value: string | null | undefined): CalendarFilter {
  if (!value) return {};
  return value.startsWith(EMPLOYEE_FILTER_PREFIX) ? { employeeId: value.slice(EMPLOYEE_FILTER_PREFIX.length) } : { userId: value };
}

/**
 * Opções do filtro "Funcionário": as contas da empresa e, depois, os colaboradores do RH sem conta ativa no app (só
 * as ausências deles aparecem). Desligados sem conta ficam de fora da lista (continuam em "Todos").
 */
export function personFilterOptions(
  accounts: { value: string; label: string }[],
  employees: Pick<Employee, "id" | "name" | "user_id" | "status">[],
): { value: string; label: string }[] {
  const known = new Set(accounts.map((account) => account.value));
  const withoutAccount = employees
    .filter((employee) => (!employee.user_id || !known.has(employee.user_id)) && employee.status !== "desligado")
    .map((employee) => ({ value: `${EMPLOYEE_FILTER_PREFIX}${employee.id}`, label: `${employee.name} (sem acesso ao app)` }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  return [...accounts, ...withoutAccount];
}

/** Itens do CalendarView: agendas conectadas, eventos do app e ausências aprovadas (fim exclusivo, sem o motivo). */
export function calendarItems(data: CalendarData, filter: CalendarFilter = {}): CalendarEntry[] {
  const sources = new Map(data.sources.map((source) => [source.id, source]));
  const items: CalendarEntry[] = [];
  for (const event of data.events) {
    if (event.deleted_at) continue;
    const source = event.source_id ? sources.get(event.source_id) : undefined;
    if (event.source_id && !source) continue;
    items.push({
      id: event.id,
      title: event.title,
      start: event.starts_at,
      end: event.ends_at ?? undefined,
      allDay: Number(event.all_day) === 1,
      sourceLabel: source ? source.name : EVENT_KIND_LABEL[event.kind] ?? "Evento",
      origin: source ? "agenda" : "app",
      kind: event.kind,
      userId: event.user_id ?? null,
      location: event.location,
      description: event.description,
      event,
    });
  }
  const employees = new Map(data.employees.map((employee) => [employee.id, employee]));
  for (const request of data.requests) {
    const employee = employees.get(request.employee_id);
    const startDay = request.start_date?.slice(0, 10);
    if (!employee || request.status !== "aprovada" || request.deleted_at || !isDayKey(startDay)) continue;
    const lastDay = isDayKey(request.end_date?.slice(0, 10)) && request.end_date.slice(0, 10) >= startDay ? request.end_date.slice(0, 10) : startDay;
    items.push({
      id: `hr-${request.id}`,
      title: absenceTitle(request.type, employee.name),
      start: startDay,
      end: addDays(lastDay, 1),
      allDay: true,
      sourceLabel: "RH",
      origin: "rh",
      kind: request.type === "ferias" ? "ferias" : "ausencia",
      userId: employee.user_id ?? null,
      employeeId: employee.id,
      personName: employee.name,
    });
  }
  if (!filter.userId && !filter.employeeId) return items;
  const userId = filter.userId ?? (filter.employeeId ? (employees.get(filter.employeeId)?.user_id ?? null) : null);
  return items.filter((item) => (userId !== null && item.userId === userId) || (!!filter.employeeId && item.employeeId === filter.employeeId));
}

// ── exportação ────────────────────────────────────────────────────

/** Texto .ics da agenda da empresa, para quem tem `export` no calendário. */
export async function exportCompanyCalendar(db: DatabaseLike, actor: CalendarActor, options: WriteOptions = {}): Promise<string> {
  if (!allowed(actor, "export")) throw new Error("Seu perfil não tem permissão para exportar a agenda da empresa.");
  return buildCompanyFeed(db, actor.companyId, options);
}
