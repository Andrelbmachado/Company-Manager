// Gravação das tabelas editáveis do RH (EditableTable): colaboradores, solicitações, pendências, comunicados e banco
// de horas. Cada função recebe só o que mudou (por id) e confere permissão e regras aqui, não só na tela. Decisões
// (aprovar/recusar) continuam nas funções próprias; o que já foi decidido não se altera pela tabela.
// Funções com `db` recebem o banco (getDb() da tela ou o SQLite dos testes); SQL nos padrões do banco demo.
import { v4 as uuidv4 } from "uuid";
import type { CalendarItem } from "@/components/shared/CalendarView";
import type { DatabaseLike } from "@/lib/db/demo";
import { can } from "@/lib/permissions/rbac";
import type { ContractType, Employee, HrAnnouncement, HrAnnouncementCategory, HrRequest, HrRequestType, HrTask, HrTimeEntry, Role } from "@/types";
import { emptyEmployeeInput, employeeToInput, fetchEmployee, saveEmployee, type EmployeeInput } from "./employees";
import { REQUEST_TYPE_LABEL, REQUEST_TYPES, inclusiveDays, validateRequest, vacationBalance } from "./rules";
import { addTimeEntry, formatMinutes, parseDuration, validateTimeEntry } from "./timebank";

export interface HrActor {
  role: Role;
  userId: string;
}

export interface RowChanges<F> {
  updated: (F & { id: string })[];
  created: F[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value: unknown) => String(value ?? "").trim();
const optionalDate = (value: unknown, message: string): string | null => {
  const date = text(value);
  if (!date) return null;
  if (!DATE.test(date)) throw new Error(message);
  return date;
};

function requirePermission(role: Role, action: "create" | "edit", resource: "hr_admin" | "hr_self", what: string) {
  if (!can(role, action, resource)) throw new Error(`Seu perfil não tem permissão para ${action === "create" ? "adicionar" : "alterar"} ${what}.`);
}

export const STATUS_LABEL: Record<string, string> = { pendente: "Pendente", aprovada: "Aprovada", recusada: "Recusada", concluida: "Concluída" };

// ── Colaboradores ────────────────────────────────────────────────────────────────────────────────────────────────

export type EmployeeRowFields = Partial<Pick<Employee, "name" | "email" | "department" | "position" | "hire_date" | "contract_type">>;

function applyEmployeeFields(input: EmployeeInput, fields: EmployeeRowFields): EmployeeInput {
  const next = { ...input };
  if ("name" in fields) next.name = text(fields.name);
  if ("email" in fields) next.email = text(fields.email);
  if ("department" in fields) next.department = text(fields.department);
  if ("position" in fields) next.position = text(fields.position);
  if ("hire_date" in fields) next.hire_date = text(fields.hire_date);
  if ("contract_type" in fields) next.contract_type = (text(fields.contract_type) as ContractType) || "";
  return next;
}

/** Colaboradores criados e alterados na tabela da Gestão de RH. O resto da ficha (endereço, documentos...) fica como está. */
export async function saveEmployeeRows(db: DatabaseLike, companyId: string, role: Role, changes: RowChanges<EmployeeRowFields>, today: string): Promise<{ created: string[] }> {
  if (changes.created.length) requirePermission(role, "create", "hr_admin", "colaboradores");
  if (changes.updated.length) requirePermission(role, "edit", "hr_admin", "colaboradores");
  for (const fields of changes.updated) {
    const current = await fetchEmployee(db, companyId, fields.id);
    if (!current) throw new Error("Colaborador não encontrado.");
    await saveEmployee(db, companyId, applyEmployeeFields(employeeToInput(current), fields), fields.id, today);
  }
  const created: string[] = [];
  for (const fields of changes.created) {
    const result = await saveEmployee(db, companyId, applyEmployeeFields(emptyEmployeeInput(), fields), null, today);
    created.push(result.id);
  }
  return { created };
}

// ── Solicitações (férias, folgas, atestados) ─────────────────────────────────────────────────────────────────────

export type RequestRowFields = Partial<Pick<HrRequest, "employee_id" | "type" | "start_date" | "end_date" | "reason">>;
const REQUEST_TYPE_SET = new Set<string>(REQUEST_TYPES.map((type) => type.value));

async function employeeRequests(db: DatabaseLike, companyId: string, employeeId: string): Promise<HrRequest[]> {
  return db.select<HrRequest[]>("SELECT * FROM hr_requests WHERE company_id=? AND employee_id=? AND deleted_at IS NULL", [companyId, employeeId]);
}

async function checkRequest(db: DatabaseLike, companyId: string, employeeId: string, input: { type: string; start: string; end: string }, today: string, ignoreId?: string): Promise<void> {
  if (!REQUEST_TYPE_SET.has(input.type)) throw new Error("Tipo de solicitação inválido.");
  const employee = await fetchEmployee(db, companyId, employeeId);
  if (!employee) throw new Error("Colaborador não encontrado.");
  const others = (await employeeRequests(db, companyId, employeeId)).filter((request) => request.id !== ignoreId);
  // O saldo é o do ano em que as férias começam (não o de hoje).
  const year = Number((input.start || today).slice(0, 4));
  const problem = validateRequest({ type: input.type as HrRequestType, start: input.start, end: input.end }, vacationBalance(employee, others, year), today);
  if (problem) throw new Error(problem);
}

/**
 * RH (hr_admin) registra solicitações em nome do colaborador e corrige as ainda pendentes; no Meu RH (`self`) a
 * pessoa só cria para si (`employeeId`). Sempre entram pendentes: aprovar/recusar é na Gestão de RH.
 */
export async function saveRequestRows(db: DatabaseLike, companyId: string, actor: HrActor, changes: RowChanges<RequestRowFields>, today: string, options: { employeeId?: string; self?: boolean } = {}): Promise<{ created: string[] }> {
  const resource = options.self ? "hr_self" : "hr_admin";
  if (changes.created.length) requirePermission(actor.role, "create", resource, "solicitações");
  if (changes.updated.length) {
    if (options.self) throw new Error("Solicitação enviada não se altera por aqui: peça a correção ao RH.");
    requirePermission(actor.role, "edit", "hr_admin", "solicitações");
  }

  for (const fields of changes.updated) {
    const [current] = await db.select<HrRequest[]>("SELECT * FROM hr_requests WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, fields.id]);
    if (!current) throw new Error("Solicitação não encontrada.");
    if (current.status !== "pendente") throw new Error("Esta solicitação já foi decidida e não se altera.");
    if ("employee_id" in fields && fields.employee_id !== current.employee_id) throw new Error("Para trocar o colaborador, registre outra solicitação.");
    const next = {
      type: "type" in fields ? text(fields.type) : current.type,
      start: "start_date" in fields ? text(fields.start_date) : current.start_date,
      end: "end_date" in fields ? text(fields.end_date) : current.end_date,
      reason: "reason" in fields ? text(fields.reason) || null : current.reason ?? null,
    };
    await checkRequest(db, companyId, current.employee_id, next, today, current.id);
    await db.execute(
      "UPDATE hr_requests SET type=?, start_date=?, end_date=?, days=?, reason=?, updated_at=datetime('now') WHERE company_id=? AND id=? AND status='pendente' AND deleted_at IS NULL",
      [next.type, next.start, next.end, inclusiveDays(next.start, next.end), next.reason, companyId, current.id],
    );
  }

  const created: string[] = [];
  for (const fields of changes.created) {
    const employeeId = options.employeeId ?? text(fields.employee_id);
    if (!employeeId) throw new Error("Escolha o colaborador.");
    const input = { type: text(fields.type) || "ferias", start: text(fields.start_date), end: text(fields.end_date) };
    await checkRequest(db, companyId, employeeId, input, today);
    const id = uuidv4();
    await db.execute(
      "INSERT INTO hr_requests (id, company_id, employee_id, type, start_date, end_date, days, reason, status) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, companyId, employeeId, input.type, input.start, input.end, inclusiveDays(input.start, input.end), text(fields.reason) || null, "pendente"],
    );
    created.push(id);
  }
  return { created };
}

// ── Pendências ───────────────────────────────────────────────────────────────────────────────────────────────────

export type TaskRowFields = Partial<Pick<HrTask, "employee_id" | "title" | "due_date" | "status">>;
const TASK_STATUSES = new Set(["pendente", "concluida"]);

/** Pendências pedidas pelo RH. `employee_id` = "todos" cria uma para cada colaborador ativo (`activeEmployeeIds`). */
export async function saveTaskRows(db: DatabaseLike, companyId: string, actor: HrActor, changes: RowChanges<TaskRowFields>, activeEmployeeIds: readonly string[]): Promise<{ created: string[] }> {
  if (changes.created.length) requirePermission(actor.role, "create", "hr_admin", "pendências");
  if (changes.updated.length) requirePermission(actor.role, "edit", "hr_admin", "pendências");
  const check = (fields: TaskRowFields, creating: boolean) => {
    if ((creating || "title" in fields) && !text(fields.title)) throw new Error("Informe o que a pendência pede.");
    if (fields.status != null && !TASK_STATUSES.has(fields.status)) throw new Error("Situação da pendência inválida.");
    return optionalDate(fields.due_date, "Prazo inválido.");
  };

  for (const fields of changes.updated) {
    const [current] = await db.select<HrTask[]>("SELECT * FROM hr_tasks WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, fields.id]);
    if (!current) throw new Error("Pendência não encontrada.");
    if ("employee_id" in fields && fields.employee_id !== current.employee_id) throw new Error("Para pedir a outra pessoa, crie outra pendência.");
    const due = check(fields, false);
    await db.execute(
      "UPDATE hr_tasks SET title=?, due_date=?, status=?, updated_at=datetime('now') WHERE company_id=? AND id=? AND deleted_at IS NULL",
      ["title" in fields ? text(fields.title) : current.title, "due_date" in fields ? due : current.due_date ?? null, fields.status ?? current.status, companyId, current.id],
    );
  }

  const created: string[] = [];
  for (const fields of changes.created) {
    const due = check(fields, true);
    const target = text(fields.employee_id);
    const targets = target === "todos" ? [...activeEmployeeIds] : activeEmployeeIds.includes(target) ? [target] : [];
    if (targets.length === 0) throw new Error("Escolha para quem é a pendência (colaborador ativo ou todos).");
    for (const employeeId of targets) {
      const id = uuidv4();
      await db.execute(
        "INSERT INTO hr_tasks (id, company_id, employee_id, title, due_date, status, created_by) VALUES (?,?,?,?,?,?,?)",
        [id, companyId, employeeId, text(fields.title), due, fields.status ?? "pendente", actor.userId],
      );
      created.push(id);
    }
  }
  return { created };
}

// ── Comunicados ──────────────────────────────────────────────────────────────────────────────────────────────────

export type AnnouncementRowFields = Partial<Pick<HrAnnouncement, "title" | "body" | "category">> & { pinned?: number | boolean };
const CATEGORIES = new Set<HrAnnouncementCategory>(["comunicado", "politica", "beneficio"]);
const flag = (value: unknown) => (value === true || value === 1 || value === "1" || value === "true" ? 1 : 0);

export async function saveAnnouncementRows(db: DatabaseLike, companyId: string, actor: HrActor, changes: RowChanges<AnnouncementRowFields>): Promise<{ created: string[] }> {
  if (changes.created.length) requirePermission(actor.role, "create", "hr_admin", "comunicados");
  if (changes.updated.length) requirePermission(actor.role, "edit", "hr_admin", "comunicados");
  const check = (fields: AnnouncementRowFields, creating: boolean) => {
    if ((creating || "title" in fields) && !text(fields.title)) throw new Error("Informe o título do comunicado.");
    if ((creating || "body" in fields) && !text(fields.body)) throw new Error("Escreva o texto do comunicado.");
    if (fields.category != null && !CATEGORIES.has(fields.category)) throw new Error("Categoria inválida.");
  };

  for (const fields of changes.updated) {
    const [current] = await db.select<HrAnnouncement[]>("SELECT * FROM hr_announcements WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, fields.id]);
    if (!current) throw new Error("Comunicado não encontrado.");
    check(fields, false);
    await db.execute(
      "UPDATE hr_announcements SET title=?, body=?, category=?, pinned=?, updated_at=datetime('now') WHERE company_id=? AND id=? AND deleted_at IS NULL",
      ["title" in fields ? text(fields.title) : current.title, "body" in fields ? text(fields.body) : current.body, fields.category ?? current.category, "pinned" in fields ? flag(fields.pinned) : current.pinned, companyId, current.id],
    );
  }

  const created: string[] = [];
  for (const fields of changes.created) {
    check(fields, true);
    const id = uuidv4();
    await db.execute(
      "INSERT INTO hr_announcements (id, company_id, title, body, category, pinned, published_by, published_at) VALUES (?,?,?,?,?,?,?,?)",
      [id, companyId, text(fields.title), text(fields.body), fields.category ?? "comunicado", flag(fields.pinned), actor.userId, new Date().toISOString()],
    );
    created.push(id);
  }
  return { created };
}

// ── Banco de horas ───────────────────────────────────────────────────────────────────────────────────────────────

/** Lançamento com a duração em texto ("+1h30", "−0h30") para a coluna editável. */
export type TimeEntryRow = HrTimeEntry & { hours: string };
export type TimeEntryRowFields = Partial<Pick<HrTimeEntry, "employee_id" | "entry_date" | "reason">> & { hours?: string | null };

export function timeEntryRows(entries: readonly HrTimeEntry[]): TimeEntryRow[] {
  return entries.map((entry) => ({ ...entry, hours: formatMinutes(Number(entry.minutes) || 0) }));
}

function minutesOf(value: unknown): number {
  const minutes = parseDuration(text(value));
  if (minutes === null) throw new Error("Informe a duração (ex.: 1:30 para hora extra, -2:00 para compensação).");
  return minutes;
}

/**
 * `mode: "rh"` (hr_admin): lança já aprovado (para `employee_id` da linha ou `employeeId`) e corrige só lançamento
 * pendente. `mode: "self"` (Meu banco de horas): informa para si, pendente até o RH decidir; não altera.
 */
export async function saveTimeEntryRows(db: DatabaseLike, companyId: string, actor: HrActor, changes: RowChanges<TimeEntryRowFields>, today: string, options: { mode: "rh" | "self"; employeeId?: string }): Promise<{ created: string[] }> {
  const rh = options.mode === "rh";
  if (changes.created.length) requirePermission(actor.role, "create", rh ? "hr_admin" : "hr_self", "lançamentos no banco de horas");
  if (changes.updated.length) {
    if (!rh) throw new Error("Lançamento enviado não se altera por aqui: retire o pendente e informe de novo, ou peça ao RH.");
    requirePermission(actor.role, "edit", "hr_admin", "lançamentos no banco de horas");
  }

  for (const fields of changes.updated) {
    const [current] = await db.select<HrTimeEntry[]>("SELECT * FROM hr_time_entries WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, fields.id]);
    if (!current) throw new Error("Lançamento não encontrado.");
    if (current.status !== "pendente") throw new Error("Lançamento já decidido não se altera: lance um ajuste (crédito ou compensação).");
    const next = {
      date: "entry_date" in fields ? text(fields.entry_date) : current.entry_date,
      minutes: "hours" in fields ? minutesOf(fields.hours) : current.minutes,
      reason: "reason" in fields ? text(fields.reason) : current.reason ?? "",
    };
    const problem = validateTimeEntry(next, today);
    if (problem) throw new Error(problem);
    await db.execute(
      "UPDATE hr_time_entries SET entry_date=?, minutes=?, reason=?, updated_at=datetime('now') WHERE company_id=? AND id=? AND status='pendente' AND deleted_at IS NULL",
      [next.date, next.minutes, next.reason.trim(), companyId, current.id],
    );
  }

  const created: string[] = [];
  for (const fields of changes.created) {
    const employeeId = options.employeeId ?? text(fields.employee_id);
    if (!employeeId) throw new Error("Escolha o colaborador.");
    if (!(await fetchEmployee(db, companyId, employeeId))) throw new Error("Colaborador não encontrado.");
    const id = await addTimeEntry(db, companyId, { employeeId, date: text(fields.entry_date), minutes: minutesOf(fields.hours), reason: text(fields.reason) }, actor.userId, today, rh ? actor.userId : null);
    created.push(id);
  }
  return { created };
}

// ── Calendário ───────────────────────────────────────────────────────────────────────────────────────────────────

function nextDay(date: string): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

/** Férias, folgas e atestados (menos os recusados) como dias inteiros; fim exclusivo, como o CalendarView espera. */
export function requestCalendarItems(requests: readonly HrRequest[], names: ReadonlyMap<string, string>): CalendarItem[] {
  return requests
    .filter((request) => request.status !== "recusada" && DATE.test(request.start_date.slice(0, 10)) && DATE.test(request.end_date.slice(0, 10)))
    .map((request) => ({
      id: request.id,
      title: `${names.get(request.employee_id) ?? "Colaborador"}: ${REQUEST_TYPE_LABEL[request.type] ?? request.type}`,
      start: request.start_date.slice(0, 10),
      end: nextDay(request.end_date),
      allDay: true,
      sourceLabel: STATUS_LABEL[request.status] ?? request.status,
    }));
}

/** Lançamentos do banco de horas (menos os recusados) no dia de cada um. */
export function timeEntryCalendarItems(entries: readonly TimeEntryRow[], names: ReadonlyMap<string, string>): CalendarItem[] {
  return entries
    .filter((entry) => entry.status !== "recusada" && DATE.test(entry.entry_date.slice(0, 10)))
    .map((entry) => ({ id: entry.id, title: `${names.get(entry.employee_id) ?? "Colaborador"} ${entry.hours}`, start: entry.entry_date.slice(0, 10), allDay: true, sourceLabel: STATUS_LABEL[entry.status] ?? entry.status }));
}

/** Pendências com prazo, no dia do prazo. */
export function taskCalendarItems(tasks: readonly HrTask[], names: ReadonlyMap<string, string>): CalendarItem[] {
  return tasks
    .filter((task) => task.due_date && DATE.test(task.due_date.slice(0, 10)))
    .map((task) => ({ id: task.id, title: `${names.get(task.employee_id) ?? "Colaborador"}: ${task.title}`, start: (task.due_date as string).slice(0, 10), allDay: true, sourceLabel: STATUS_LABEL[task.status] ?? task.status }));
}
