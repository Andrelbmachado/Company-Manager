import { v5 as uuidv5 } from "uuid";
import { getDb } from "@/lib/db/client";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
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
  const existing = await fetchMyEmployee(session.company.id, session.user.id);
  if (existing) return existing;
  const id = uuidv5(`${session.company.id}:employee:${session.user.id}`, NAMESPACE);
  await (await getDb()).execute(
    "INSERT OR IGNORE INTO employees (id, company_id, user_id, name, email, department, position, vacation_days_entitled, status) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, session.company.id, session.user.id, session.user.name, session.user.email, ROLE_LABELS[session.membership.role as Role], "Colaborador", 30, "ativo"],
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

export async function fetchMyHrTasks(companyId: string, employeeId: string): Promise<HrTask[]> {
  return (await getDb()).select<HrTask[]>("SELECT * FROM hr_tasks WHERE company_id=? AND employee_id=? AND deleted_at IS NULL ORDER BY due_date ASC", [companyId, employeeId]);
}
