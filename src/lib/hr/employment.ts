// Ciclo do colaborador: admissão e desligamento com checklist (hr_tasks.category = admissao | desligamento, 0008).
// O desligamento grava termination_date/termination_reason; o status vira "desligado" na data (na hora, se a data já
// passou; desligamento agendado vira na primeira abertura das telas de RH depois da data: applyDueTerminations).
// Funções com `db` recebem o banco; SQL nos padrões do banco demo (contas e filtros no TypeScript).
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import type { ContractType, Employee, HrTask } from "@/types";

export type CycleKind = "admissao" | "desligamento";

export interface ChecklistStep {
  title: string;
  /** Prazo em dias a partir da data de admissão/desligamento (negativo = antes). */
  offset: number;
}

export const ADMISSION_STEPS: readonly ChecklistStep[] = [
  { title: "Receber documentos pessoais (RG, CPF, PIS, comprovante de endereço)", offset: -5 },
  { title: "Agendar exame admissional (ASO)", offset: -3 },
  { title: "Assinar contrato e registrar no eSocial", offset: 0 },
  { title: "Criar acessos (e-mail e sistema) e entregar equipamentos", offset: 0 },
  { title: "Integração: equipe, políticas e benefícios", offset: 1 },
  { title: "Avaliação do período de experiência (45 dias)", offset: 45 },
];

export const TERMINATION_STEPS: readonly ChecklistStep[] = [
  { title: "Formalizar o desligamento e o aviso prévio", offset: 0 },
  { title: "Recolher notebook, crachá, chaves e equipamentos", offset: 0 },
  { title: "Pedir à Administração a suspensão dos acessos ao sistema e ao e-mail", offset: 0 },
  { title: "Agendar exame demissional", offset: 5 },
  { title: "Enviar ao Financeiro o cálculo das verbas rescisórias", offset: 7 },
  { title: "Homologação e entrega das guias", offset: 10 },
];

export const TERMINATION_REASONS = [
  "Pedido de demissão",
  "Dispensa sem justa causa",
  "Dispensa com justa causa",
  "Término de contrato",
  "Acordo entre as partes",
  "Aposentadoria",
  "Outro",
] as const;

export const CYCLE_LABEL: Record<CycleKind, string> = { admissao: "Admissão", desligamento: "Desligamento" };

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

async function insertChecklist(db: DatabaseLike, companyId: string, employeeId: string, kind: CycleKind, start: string, actorId: string): Promise<string[]> {
  const steps = kind === "admissao" ? ADMISSION_STEPS : TERMINATION_STEPS;
  const ids: string[] = [];
  for (const step of steps) {
    const id = uuidv4();
    await db.execute(
      "INSERT INTO hr_tasks (id, company_id, employee_id, title, due_date, status, category, created_by) VALUES (?,?,?,?,?,?,?,?)",
      [id, companyId, employeeId, step.title, addDays(start, step.offset), "pendente", kind, actorId],
    );
    ids.push(id);
  }
  return ids;
}

export interface AdmissionInput {
  name: string;
  email: string;
  department: string;
  position: string;
  hire_date: string;
  contract_type: ContractType | "";
}

/** Cadastra quem está entrando (status ativo) e cria o checklist de admissão com prazos a partir da data de início. */
export async function startAdmission(db: DatabaseLike, companyId: string, input: AdmissionInput, actorId: string): Promise<{ employeeId: string; taskIds: string[] }> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) throw new Error("Informe o nome de quem está entrando.");
  if (!DATE.test(input.hire_date)) throw new Error("Informe a data de início.");
  if (email && !EMAIL.test(email)) throw new Error("E-mail inválido.");
  if (email) {
    const [same] = (await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND email=? AND deleted_at IS NULL", [companyId, email]));
    if (same) throw new Error(`Já existe um colaborador com este e-mail: ${same.name}. Abra a ficha dele.`);
  }
  const employeeId = uuidv4();
  await db.execute(
    "INSERT INTO employees (id, company_id, name, email, department, position, hire_date, contract_type, daily_minutes, vacation_days_entitled, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [employeeId, companyId, name, email || null, input.department.trim() || null, input.position.trim() || null, input.hire_date, input.contract_type || null, 480, 30, "ativo"],
  );
  const taskIds = await insertChecklist(db, companyId, employeeId, "admissao", input.hire_date, actorId);
  return { employeeId, taskIds };
}

export interface TerminationInput {
  date: string;
  reason: string;
  notes?: string;
}

async function loadEmployee(db: DatabaseLike, companyId: string, employeeId: string): Promise<Employee> {
  const [employee] = await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, employeeId]);
  if (!employee) throw new Error("Colaborador não encontrado.");
  return employee;
}

async function openTasks(db: DatabaseLike, companyId: string, employeeId: string, kind: CycleKind): Promise<HrTask[]> {
  const tasks = await db.select<HrTask[]>("SELECT * FROM hr_tasks WHERE company_id=? AND employee_id=? AND deleted_at IS NULL", [companyId, employeeId]);
  return tasks.filter((task) => task.category === kind && task.status === "pendente");
}

/**
 * Registra o desligamento: data e motivo na ficha e checklist de saída. Data de hoje ou passada → status "desligado"
 * já; data futura → agendado (continua ativo até a data). Recusa quem já está desligado ou já tem saída em andamento.
 */
export async function startTermination(db: DatabaseLike, companyId: string, employeeId: string, input: TerminationInput, actorId: string, today: string): Promise<{ taskIds: string[]; effective: boolean }> {
  if (!DATE.test(input.date)) throw new Error("Informe a data do desligamento.");
  if (!input.reason.trim()) throw new Error("Informe o motivo do desligamento.");
  const employee = await loadEmployee(db, companyId, employeeId);
  if (employee.status === "desligado") throw new Error(`${employee.name} já está desligado(a).`);
  if (employee.termination_date || (await openTasks(db, companyId, employeeId, "desligamento")).length > 0) throw new Error(`Já há um desligamento em andamento para ${employee.name}.`);
  if (employee.hire_date && input.date < employee.hire_date.slice(0, 10)) throw new Error("O desligamento não pode ser antes da admissão.");
  const effective = input.date <= today;
  const notes = input.notes?.trim() ? [employee.notes?.trim(), `Desligamento: ${input.notes.trim()}`].filter(Boolean).join("\n") : employee.notes ?? null;
  await db.execute(
    "UPDATE employees SET termination_date=?, termination_reason=?, status=?, notes=?, updated_at=datetime('now') WHERE company_id=? AND id=?",
    [input.date, input.reason.trim(), effective ? "desligado" : employee.status, notes, companyId, employeeId],
  );
  const taskIds = await insertChecklist(db, companyId, employeeId, "desligamento", input.date, actorId);
  return { taskIds, effective };
}

/**
 * Desfaz um desligamento agendado (ainda não efetivado): limpa data e motivo e retira o checklist de saída inteiro
 * (o processo deixa de valer; um desligamento futuro começa um checklist limpo). Pendências gerais ficam.
 */
export async function cancelTermination(db: DatabaseLike, companyId: string, employeeId: string): Promise<void> {
  const employee = await loadEmployee(db, companyId, employeeId);
  if (employee.status === "desligado") throw new Error("O desligamento já foi efetivado; para voltar, faça uma nova admissão.");
  if (!employee.termination_date) throw new Error("Não há desligamento agendado.");
  await db.execute("UPDATE employees SET termination_date=NULL, termination_reason=NULL, updated_at=datetime('now') WHERE company_id=? AND id=?", [companyId, employeeId]);
  const tasks = await db.select<HrTask[]>("SELECT * FROM hr_tasks WHERE company_id=? AND employee_id=? AND deleted_at IS NULL", [companyId, employeeId]);
  for (const task of tasks.filter((item) => item.category === "desligamento")) {
    await db.execute("UPDATE hr_tasks SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE company_id=? AND id=?", [companyId, task.id]);
  }
}

/** Efetiva desligamentos agendados cuja data chegou. Idempotente; devolve quantos mudaram. */
export async function applyDueTerminations(db: DatabaseLike, companyId: string, today: string): Promise<number> {
  const employees = await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const due = employees.filter((employee) => employee.status !== "desligado" && employee.termination_date && employee.termination_date.slice(0, 10) <= today);
  for (const employee of due) {
    await db.execute("UPDATE employees SET status=?, updated_at=datetime('now') WHERE company_id=? AND id=?", ["desligado", companyId, employee.id]);
  }
  return due.length;
}

/** Marca ou desmarca um item de checklist (ou pendência). */
export async function setTaskDone(db: DatabaseLike, companyId: string, taskId: string, done: boolean): Promise<void> {
  await db.execute("UPDATE hr_tasks SET status=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [done ? "concluida" : "pendente", companyId, taskId]);
}

export interface CycleCase {
  employee: Employee;
  kind: CycleKind;
  /** Data de início (admissão) ou de saída (desligamento). */
  date: string | null;
  tasks: HrTask[];
  done: number;
  total: number;
  late: number;
  complete: boolean;
}

/**
 * Agrupa o checklist por colaborador e tipo. Em andamento primeiro (pela data), depois os concluídos (mais recentes
 * primeiro). Colaborador excluído some.
 */
export function cycleCases(employees: readonly Employee[], tasks: readonly HrTask[], today: string): CycleCase[] {
  const byId = new Map(employees.map((employee) => [employee.id, employee]));
  const groups = new Map<string, HrTask[]>();
  for (const task of tasks) {
    if (task.category !== "admissao" && task.category !== "desligamento") continue;
    if (!byId.has(task.employee_id)) continue;
    const key = `${task.employee_id}|${task.category}`;
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  const cases = [...groups].map(([key, list]): CycleCase => {
    const [employeeId, kind] = key.split("|") as [string, CycleKind];
    const employee = byId.get(employeeId)!;
    const sorted = [...list].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.title.localeCompare(b.title, "pt-BR"));
    const done = sorted.filter((task) => task.status === "concluida").length;
    const late = sorted.filter((task) => task.status === "pendente" && !!task.due_date && task.due_date < today).length;
    return {
      employee,
      kind,
      date: (kind === "admissao" ? employee.hire_date : employee.termination_date)?.slice(0, 10) ?? null,
      tasks: sorted,
      done,
      total: sorted.length,
      late,
      complete: done === sorted.length,
    };
  });
  return cases.sort((a, b) => Number(a.complete) - Number(b.complete) || (a.complete ? (b.date ?? "").localeCompare(a.date ?? "") : (a.date ?? "9999").localeCompare(b.date ?? "9999")) || a.employee.name.localeCompare(b.employee.name, "pt-BR"));
}
