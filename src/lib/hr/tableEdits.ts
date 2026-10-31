// Gravação das tabelas editáveis do RH (EditableTable): colaboradores, solicitações, pendências, comunicados e banco
// de horas. Cada função recebe só o que mudou (por id) e confere permissão e regras aqui, não só na tela. Decisões
// (aprovar/recusar) continuam nas funções próprias; o que já foi decidido não se altera pela tabela.
// Todas as linhas do lote são conferidas antes da primeira escrita: se a gravação falha, a tabela mantém todos os
// rascunhos, e uma linha já gravada seria gravada de novo (duplicada) ao salvar outra vez.
// Funções com `db` recebem o banco (getDb() da tela ou o SQLite dos testes); SQL nos padrões do banco demo.
import { v4 as uuidv4 } from "uuid";
import type { CalendarItem } from "@/components/shared/CalendarView";
import type { DatabaseLike } from "@/lib/db/demo";
import { can } from "@/lib/permissions/rbac";
import type { ContractType, Employee, HrAnnouncement, HrAnnouncementCategory, HrRequest, HrRequestType, HrTask, HrTimeEntry, Role } from "@/types";
import { emptyEmployeeInput, employeeToInput, fetchEmployee, saveEmployee, validateEmployee, type EmployeeInput } from "./employees";
import { duplicateEmailMessage } from "./employment";
import { REQUEST_TYPE_LABEL, REQUEST_TYPES, inclusiveDays, validateRequest, vacationBalance } from "./rules";
import { addTimeEntry, formatMinutes, parseDuration, validateTimeEntry, type NewTimeEntry } from "./timebank";

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

const emailKey = (email: string | null | undefined) => (email ?? "").trim().toLowerCase();

/** Colaboradores criados e alterados na tabela da Gestão de RH. O resto da ficha (endereço, documentos...) fica como está. */
export async function saveEmployeeRows(db: DatabaseLike, companyId: string, role: Role, changes: RowChanges<EmployeeRowFields>, today: string): Promise<{ created: string[] }> {
  if (changes.created.length) requirePermission(role, "create", "hr_admin", "colaboradores");
  if (changes.updated.length) requirePermission(role, "edit", "hr_admin", "colaboradores");
  const all = await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const updates = changes.updated.map((fields) => {
    const current = all.find((employee) => employee.id === fields.id);
    if (!current) throw new Error("Colaborador não encontrado.");
    return { id: fields.id, input: applyEmployeeFields(employeeToInput(current), fields) };
  });
  const creates = changes.created.map((fields) => applyEmployeeFields(emptyEmployeeInput(), fields));
  for (const input of [...updates.map((update) => update.input), ...creates]) {
    const problem = validateEmployee(input, today);
    if (problem) throw new Error(problem);
  }
  // E-mail de outra pessoa, na ordem em que saveEmployee grava (alterações e depois cadastros novos).
  const emails = new Map(all.map((employee) => [employee.id, emailKey(employee.email)]));
  for (const update of updates) {
    const email = emailKey(update.input.email);
    const clash = email ? all.find((employee) => employee.id !== update.id && emails.get(employee.id) === email) : undefined;
    if (clash) throw new Error(`Já existe um colaborador com este e-mail: ${clash.name}.`);
    emails.set(update.id, email);
  }
  for (const input of creates) {
    const email = emailKey(input.email);
    const same = email ? all.find((employee) => emails.get(employee.id) === email) : undefined;
    if (same?.status === "desligado") throw new Error(duplicateEmailMessage(same));
  }

  for (const update of updates) await saveEmployee(db, companyId, update.input, update.id, today);
  const created: string[] = [];
  for (const input of creates) created.push((await saveEmployee(db, companyId, input, null, today)).id);
  return { created };
}

// ── Solicitações (férias, folgas, atestados) ─────────────────────────────────────────────────────────────────────

export type RequestRowFields = Partial<Pick<HrRequest, "employee_id" | "type" | "start_date" | "end_date" | "reason">>;
const REQUEST_TYPE_SET = new Set<string>(REQUEST_TYPES.map((type) => type.value));

async function employeeRequests(db: DatabaseLike, companyId: string, employeeId: string): Promise<HrRequest[]> {
  return db.select<HrRequest[]>("SELECT * FROM hr_requests WHERE company_id=? AND employee_id=? AND deleted_at IS NULL", [companyId, employeeId]);
}

type BalanceRequest = Pick<HrRequest, "id" | "type" | "status" | "days" | "start_date">;
interface RequestPlan {
  id: string;
  employeeId: string;
  type: string;
  start: string;
  end: string;
  reason: string | null;
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

  // Saldo de férias por colaborador, já com as linhas do lote conferidas antes (pendentes até o RH decidir).
  const known = new Map<string, { employee: Employee; requests: BalanceRequest[] }>();
  async function check(plan: RequestPlan): Promise<void> {
    if (!REQUEST_TYPE_SET.has(plan.type)) throw new Error("Tipo de solicitação inválido.");
    let entry = known.get(plan.employeeId);
    if (!entry) {
      const employee = await fetchEmployee(db, companyId, plan.employeeId);
      if (!employee) throw new Error("Colaborador não encontrado.");
      entry = { employee, requests: await employeeRequests(db, companyId, plan.employeeId) };
      known.set(plan.employeeId, entry);
    }
    const others = entry.requests.filter((request) => request.id !== plan.id);
    // O saldo é o do ano em que as férias começam (não o de hoje).
    const year = Number((plan.start || today).slice(0, 4));
    const problem = validateRequest({ type: plan.type as HrRequestType, start: plan.start, end: plan.end }, vacationBalance(entry.employee, others, year), today);
    if (problem) throw new Error(problem);
    entry.requests = [...others, { id: plan.id, type: plan.type as HrRequestType, status: "pendente", days: inclusiveDays(plan.start, plan.end), start_date: plan.start }];
  }

  const updates: RequestPlan[] = [];
  for (const fields of changes.updated) {
    const [current] = await db.select<HrRequest[]>("SELECT * FROM hr_requests WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, fields.id]);
    if (!current) throw new Error("Solicitação não encontrada.");
    if (current.status !== "pendente") throw new Error("Esta solicitação já foi decidida e não se altera.");
    if ("employee_id" in fields && fields.employee_id !== current.employee_id) throw new Error("Para trocar o colaborador, registre outra solicitação.");
    const plan: RequestPlan = {
      id: current.id,
      employeeId: current.employee_id,
      type: "type" in fields ? text(fields.type) : current.type,
      start: "start_date" in fields ? text(fields.start_date) : current.start_date,
      end: "end_date" in fields ? text(fields.end_date) : current.end_date,
      reason: "reason" in fields ? text(fields.reason) || null : current.reason ?? null,
    };
    await check(plan);
    updates.push(plan);
  }

  const creates: RequestPlan[] = [];
  for (const fields of changes.created) {
    const employeeId = options.employeeId ?? text(fields.employee_id);
    if (!employeeId) throw new Error("Escolha o colaborador.");
    const plan: RequestPlan = { id: uuidv4(), employeeId, type: text(fields.type) || "ferias", start: text(fields.start_date), end: text(fields.end_date), reason: text(fields.reason) || null };
    await check(plan);
    creates.push(plan);
  }

  for (const plan of updates) {
    await db.execute(
      "UPDATE hr_requests SET type=?, start_date=?, end_date=?, days=?, reason=?, updated_at=datetime('now') WHERE company_id=? AND id=? AND status='pendente' AND deleted_at IS NULL",
      [plan.type, plan.start, plan.end, inclusiveDays(plan.start, plan.end), plan.reason, companyId, plan.id],
    );
  }
  for (const plan of creates) {
    await db.execute(
      "INSERT INTO hr_requests (id, company_id, employee_id, type, start_date, end_date, days, reason, status) VALUES (?,?,?,?,?,?,?,?,?)",
      [plan.id, companyId, plan.employeeId, plan.type, plan.start, plan.end, inclusiveDays(plan.start, plan.end), plan.reason, "pendente"],
    );
  }
  return { created: creates.map((plan) => plan.id) };
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

  const updates: { id: string; title: string; due: string | null; status: string }[] = [];
  for (const fields of changes.updated) {
    const [current] = await db.select<HrTask[]>("SELECT * FROM hr_tasks WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, fields.id]);
    if (!current) throw new Error("Pendência não encontrada.");
    if ("employee_id" in fields && fields.employee_id !== current.employee_id) throw new Error("Para pedir a outra pessoa, crie outra pendência.");
    const due = check(fields, false);
    updates.push({ id: current.id, title: "title" in fields ? text(fields.title) : current.title, due: "due_date" in fields ? due : current.due_date ?? null, status: fields.status ?? current.status });
  }

  const creates: { id: string; employeeId: string; title: string; due: string | null; status: string }[] = [];
  for (const fields of changes.created) {
    const due = check(fields, true);
    const target = text(fields.employee_id);
    const targets = target === "todos" ? [...activeEmployeeIds] : activeEmployeeIds.includes(target) ? [target] : [];
    if (targets.length === 0) throw new Error("Escolha para quem é a pendência (colaborador ativo ou todos).");
    for (const employeeId of targets) creates.push({ id: uuidv4(), employeeId, title: text(fields.title), due, status: fields.status ?? "pendente" });
  }

  for (const task of updates) {
    await db.execute(
      "UPDATE hr_tasks SET title=?, due_date=?, status=?, updated_at=datetime('now') WHERE company_id=? AND id=? AND deleted_at IS NULL",
      [task.title, task.due, task.status, companyId, task.id],
    );
  }
  for (const task of creates) {
    await db.execute(
      "INSERT INTO hr_tasks (id, company_id, employee_id, title, due_date, status, created_by) VALUES (?,?,?,?,?,?,?)",
      [task.id, companyId, task.employeeId, task.title, task.due, task.status, actor.userId],
    );
  }
  return { created: creates.map((task) => task.id) };
}

// ── Comunicados ──────────────────────────────────────────────────────────────────────────────────────────────────

export type AnnouncementRowFields = Partial<Pick<HrAnnouncement, "title" | "body" | "category">> & { pinned?: number | boolean; important?: number | boolean };
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

  const updates: unknown[][] = [];
  for (const fields of changes.updated) {
    const [current] = await db.select<HrAnnouncement[]>("SELECT * FROM hr_announcements WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, fields.id]);
    if (!current) throw new Error("Comunicado não encontrado.");
    check(fields, false);
    updates.push(["title" in fields ? text(fields.title) : current.title, "body" in fields ? text(fields.body) : current.body, fields.category ?? current.category, "pinned" in fields ? flag(fields.pinned) : current.pinned, "important" in fields ? flag(fields.important) : (current.important ?? 0), companyId, current.id]);
  }
  for (const fields of changes.created) check(fields, true);

  for (const values of updates) {
    await db.execute("UPDATE hr_announcements SET title=?, body=?, category=?, pinned=?, important=?, updated_at=datetime('now') WHERE company_id=? AND id=? AND deleted_at IS NULL", values);
  }
  const created: string[] = [];
  for (const fields of changes.created) {
    const id = uuidv4();
    await db.execute(
      "INSERT INTO hr_announcements (id, company_id, title, body, category, pinned, important, published_by, published_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, companyId, text(fields.title), text(fields.body), fields.category ?? "comunicado", flag(fields.pinned), flag(fields.important), actor.userId, new Date().toISOString()],
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

  const updates: { id: string; date: string; minutes: number; reason: string }[] = [];
  for (const fields of changes.updated) {
    const [current] = await db.select<HrTimeEntry[]>("SELECT * FROM hr_time_entries WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, fields.id]);
    if (!current) throw new Error("Lançamento não encontrado.");
    if (current.status !== "pendente") throw new Error("Lançamento já decidido não se altera: lance um ajuste (crédito ou compensação).");
    if ("employee_id" in fields && fields.employee_id !== current.employee_id) throw new Error("Para lançar para outra pessoa, registre outro lançamento.");
    const next = {
      date: "entry_date" in fields ? text(fields.entry_date) : current.entry_date,
      minutes: "hours" in fields ? minutesOf(fields.hours) : current.minutes,
      reason: "reason" in fields ? text(fields.reason) : current.reason ?? "",
    };
    const problem = validateTimeEntry(next, today);
    if (problem) throw new Error(problem);
    updates.push({ id: current.id, ...next });
  }

  const creates: NewTimeEntry[] = [];
  for (const fields of changes.created) {
    const employeeId = options.employeeId ?? text(fields.employee_id);
    if (!employeeId) throw new Error("Escolha o colaborador.");
    if (!(await fetchEmployee(db, companyId, employeeId))) throw new Error("Colaborador não encontrado.");
    const entry = { employeeId, date: text(fields.entry_date), minutes: minutesOf(fields.hours), reason: text(fields.reason) };
    const problem = validateTimeEntry(entry, today);
    if (problem) throw new Error(problem);
    creates.push(entry);
  }

  for (const next of updates) {
    await db.execute(
      "UPDATE hr_time_entries SET entry_date=?, minutes=?, reason=?, updated_at=datetime('now') WHERE company_id=? AND id=? AND status='pendente' AND deleted_at IS NULL",
      [next.date, next.minutes, next.reason.trim(), companyId, next.id],
    );
  }
  const created: string[] = [];
  for (const entry of creates) created.push(await addTimeEntry(db, companyId, entry, actor.userId, today, rh ? actor.userId : null));
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
