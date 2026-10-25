// Tabela de projetos do Company Manager por cima do módulo Project Manager: gravação das linhas da EditableTable
// (permissão e regras aqui, na camada de dados) e o cronograma (projetos, etapas e tarefas) para o CalendarView.
// Usa só a API pública do módulo (src/modules/project-manager/index.ts); o módulo em si não muda.
import type { CalendarItem } from "@/components/shared/CalendarView";
import type { DatabaseLike } from "@/lib/db/demo";
import { can } from "@/lib/permissions/rbac";
import { buildFlow, createProjectRepository, PROJECT_STATUSES, type Project, type ProjectInput, type ProjectStage, type ProjectStatus, type Task } from "@/modules/project-manager";
import type { Role } from "@/types";

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planejado: "Planejado",
  andamento: "Em andamento",
  pausado: "Pausado",
  concluido: "Concluído",
  cancelado: "Cancelado",
};
export const PROJECT_STATUS_OPTIONS = PROJECT_STATUSES.map((value) => ({ value, label: PROJECT_STATUS_LABEL[value] }));

export type ProjectRow = Project & { progress: string; stage: string };
export type ProjectRowFields = Partial<Pick<Project, "name" | "status" | "budget" | "start_date" | "end_date">>;
export interface ProjectActor {
  role: Role;
  userId: string;
}
export interface ProjectRowChanges {
  updated: (ProjectRowFields & { id: string })[];
  created: ProjectRowFields[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function day(value: unknown): string | null {
  const text = value == null ? "" : String(value).trim().slice(0, 10);
  return text ? text : null;
}

function toInput(fields: ProjectRowFields, base?: Project): ProjectInput {
  const pick = <K extends keyof ProjectRowFields>(key: K) => (key in fields ? fields[key] : base?.[key]);
  const name = String(pick("name") ?? "").trim();
  if (!name) throw new Error("Informe o nome do projeto.");
  const status = String(pick("status") ?? "planejado") as ProjectStatus;
  if (!PROJECT_STATUSES.includes(status)) throw new Error("Status de projeto inválido.");
  const rawBudget = pick("budget");
  const budget = rawBudget == null || rawBudget === ("" as unknown) ? 0 : Number(rawBudget);
  if (!Number.isFinite(budget)) throw new Error("Orçamento inválido.");
  if (budget < 0) throw new Error("O orçamento não pode ser negativo.");
  const start_date = day(pick("start_date"));
  const end_date = day(pick("end_date"));
  for (const value of [start_date, end_date]) if (value && !DATE.test(value)) throw new Error("Data inválida. Use dd/mm/aaaa.");
  if (start_date && end_date && end_date < start_date) throw new Error("O prazo não pode ser anterior ao início.");
  return { name, status, budget, start_date, end_date };
}

/** Grava a tabela: confere create/edit em `projects`, valida tudo antes e só então escreve. */
export async function saveProjectRows(db: DatabaseLike, companyId: string, actor: ProjectActor, changes: ProjectRowChanges): Promise<{ created: string[] }> {
  if (changes.created.length && !can(actor.role, "create", "projects")) throw new Error("Seu perfil não tem permissão para adicionar projetos.");
  if (changes.updated.length && !can(actor.role, "edit", "projects")) throw new Error("Seu perfil não tem permissão para alterar projetos.");
  const repo = createProjectRepository(db, companyId, actor.userId);
  const updates: { id: string; input: ProjectInput }[] = [];
  for (const fields of changes.updated) {
    const current = await repo.getProject(fields.id);
    if (!current) throw new Error("Projeto não encontrado.");
    updates.push({ id: fields.id, input: toInput(fields, current) });
  }
  const creations = changes.created.map((fields) => toInput(fields));
  for (const { id, input } of updates) await repo.updateProject(id, input);
  const created: string[] = [];
  for (const input of creations) created.push(await repo.createProject(input));
  return { created };
}

/** Linhas da tabela: o projeto mais o progresso das tarefas e a etapa atual do plano. */
export function projectRows(projects: readonly Project[], stages: readonly ProjectStage[], tasks: readonly Task[]): ProjectRow[] {
  return projects.map((project) => {
    const flow = buildFlow(stages.filter((stage) => stage.project_id === project.id), tasks.filter((task) => task.project_id === project.id));
    const current = flow.currentIndex !== null ? flow.steps[flow.currentIndex] : null;
    return {
      ...project,
      progress: flow.tasksTotal ? `${flow.tasksDone} de ${flow.tasksTotal} tarefas (${flow.overallPercent}%)` : "Sem tarefas",
      stage: current ? current.stage.name : flow.steps.length ? "Plano concluído" : "Sem etapas",
    };
  });
}

function nextDay(date: string): string {
  const [year, month, dayOfMonth] = date.slice(0, 10).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, dayOfMonth + 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

function span(start: string | null | undefined, end: string | null | undefined): { start: string; end: string } | null {
  const first = day(start);
  const last = day(end);
  const from = first && DATE.test(first) ? first : last && DATE.test(last) ? last : null;
  if (!from) return null;
  const to = last && DATE.test(last) && last >= from ? last : from;
  return { start: from, end: nextDay(to) };
}

/** Cronograma: período de cada projeto, de cada etapa e o prazo das tarefas abertas (dias inteiros, fim exclusivo). Cancelados ficam de fora. */
export function projectCalendarItems(projects: readonly Project[], stages: readonly ProjectStage[], tasks: readonly Task[]): CalendarItem[] {
  const live = new Map(projects.filter((project) => project.status !== "cancelado").map((project) => [project.id, project]));
  const items: CalendarItem[] = [];
  for (const project of live.values()) {
    const range = span(project.start_date, project.end_date);
    if (range) items.push({ id: `project-${project.id}`, title: day(project.start_date) ? project.name : `Prazo: ${project.name}`, ...range, allDay: true, sourceLabel: "Projeto" });
  }
  for (const stage of stages) {
    const project = live.get(stage.project_id);
    const range = project ? span(stage.start_date, stage.end_date) : null;
    if (project && range) items.push({ id: `stage-${stage.id}`, title: `${project.name}: ${stage.name}`, ...range, allDay: true, sourceLabel: "Etapa" });
  }
  for (const task of tasks) {
    const project = task.project_id ? live.get(task.project_id) : undefined;
    const range = project && task.status !== "concluida" && task.due_date ? span(task.due_date, task.due_date) : null;
    if (project && range) items.push({ id: `task-${task.id}`, title: `${task.title} (${project.name})`, ...range, allDay: true, sourceLabel: "Tarefa" });
  }
  return items;
}
