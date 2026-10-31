import { v5 as uuidv5 } from "uuid";
import { getDb } from "@/lib/db/client";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
import { isCycleTask } from "./employment";
import type { Employee, HrAnnouncement, HrRequest, HrTask, Role, Session } from "@/types";

const NAMESPACE = "b3d1c4e2-5a7f-4c11-9e0a-2f6d8a7c1b55";

export async function fetchEmployees(companyId: string): Promise<Employee[]> {
  return (await getDb()).select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND deleted_at IS NULL ORDER BY name ASC", [companyId]);
}

export async function fetchMyEmployee(companyId: string, userId: string): Promise<Employee | null> {
  const rows = await (await getDb()).select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND user_id=? AND deleted_at IS NULL", [companyId, userId]);
  return rows[0] ?? null;
}

/** Cria o cadastro do próprio usuário na primeira visita ao Meu RH, quando o RH ainda não o cadastrou. Idempotente. */
export async function ensureMyEmployee(session: Session): Promise<Employee> {
  const employee = await findOrCreateMyEmployee(session);
  // O exemplo é opcional: se falhar, o Meu RH abre com o cadastro de verdade assim mesmo.
  await seedMyHrIfDemo(session.company.id, employee.id).catch((error) => console.warn("[demo] não foi possível criar o Meu RH de exemplo", error));
  return employee;
}

/**
 * Modo demonstração ligado: o Meu RH da pessoa ganha solicitações e pendências de exemplo (ids dev-*, a limpeza apaga),
 * mesmo quando o cadastro dela nasceu depois de ligar o modo. Import dinâmico: os seeds não entram no pacote principal.
 */
async function seedMyHrIfDemo(companyId: string, employeeId: string): Promise<void> {
  const db = await getDb();
  const { isDemoMode } = await import("@/lib/demo/demoMode");
  if (!(await isDemoMode(db, companyId))) return;
  const { seedMyHrDemo } = await import("@/lib/dev/seeds/myHr");
  await seedMyHrDemo(companyId, employeeId);
}

async function findOrCreateMyEmployee(session: Session): Promise<Employee> {
  const existing = await fetchMyEmployee(session.company.id, session.user.id);
  if (existing) return existing;
  // O RH pode ter cadastrado esta pessoa antes de ela entrar: liga o cadastro pelo e-mail (gravado em minúsculas) em vez de duplicar.
  const email = session.user.email.trim().toLowerCase();
  const db = await getDb();
  const preRegistered = (await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND email=? AND user_id IS NULL AND deleted_at IS NULL", [session.company.id, email]))[0];
  if (preRegistered) {
    await db.execute("UPDATE employees SET user_id=?, updated_at=datetime('now') WHERE id=? AND company_id=?", [session.user.id, preRegistered.id, session.company.id]);
    return { ...preRegistered, user_id: session.user.id };
  }
  const id = uuidv5(`${session.company.id}:employee:${session.user.id}`, NAMESPACE);
  await db.execute(
    "INSERT OR IGNORE INTO employees (id, company_id, user_id, name, email, department, position, vacation_days_entitled, status) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, session.company.id, session.user.id, session.user.name, email, ROLE_LABELS[session.membership.role as Role], "Colaborador", 30, "ativo"],
  );
  return (await fetchMyEmployee(session.company.id, session.user.id)) as Employee;
}

export async function fetchRequests(companyId: string): Promise<HrRequest[]> {
  return (await getDb()).select<HrRequest[]>("SELECT * FROM hr_requests WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at DESC", [companyId]);
}

export async function fetchMyRequests(companyId: string, employeeId: string): Promise<HrRequest[]> {
  return (await getDb()).select<HrRequest[]>("SELECT * FROM hr_requests WHERE company_id=? AND employee_id=? AND deleted_at IS NULL ORDER BY created_at DESC", [companyId, employeeId]);
}

export async function fetchAnnouncements(companyId: string): Promise<HrAnnouncement[]> {
  return (await getDb()).select<HrAnnouncement[]>("SELECT * FROM hr_announcements WHERE company_id=? AND deleted_at IS NULL ORDER BY published_at DESC", [companyId]);
}

export async function fetchHrTasks(companyId: string): Promise<HrTask[]> {
  return (await getDb()).select<HrTask[]>("SELECT * FROM hr_tasks WHERE company_id=? AND deleted_at IS NULL ORDER BY due_date ASC", [companyId]);
}

/**
 * Pendências que o RH pediu à pessoa (Meu RH). O checklist de admissão/desligamento sobre ela é tarefa do RH: não
 * aparece aqui (nem um desligamento agendado se revela, nem a pessoa marca itens do RH).
 */
export async function fetchMyHrTasks(companyId: string, employeeId: string): Promise<HrTask[]> {
  const tasks = await (await getDb()).select<HrTask[]>("SELECT * FROM hr_tasks WHERE company_id=? AND employee_id=? AND deleted_at IS NULL ORDER BY due_date ASC", [companyId, employeeId]);
  return tasks.filter((task) => !isCycleTask(task));
}
