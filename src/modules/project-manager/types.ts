// Tipos de domínio. Project, ProjectStage e Task espelham as tabelas `projects`, `project_stages` e `tasks`
// do Company Manager — não renomeie colunas sem atualizar o contrato do bundle e as migrations dos dois lados.

export type ProjectStatus = "planejado" | "andamento" | "pausado" | "concluido" | "cancelado";
export type TaskStatus = "aberta" | "em_andamento" | "concluida" | "bloqueada";
export type Priority = "baixa" | "media" | "alta" | "urgente";
/** Estado de uma etapa do plano. Com tarefas, é derivado delas (ver flow.ts); sem tarefas, vale o valor gravado. */
export type StageStatus = "a_seguir" | "em_andamento" | "concluida";

export const PROJECT_STATUSES: ProjectStatus[] = ["planejado", "andamento", "pausado", "concluido", "cancelado"];
/** Ordem das colunas do quadro: o fluxo normal primeiro e Bloqueada por último (é desvio, não etapa do caminho). */
export const TASK_STATUSES: TaskStatus[] = ["aberta", "em_andamento", "concluida", "bloqueada"];
export const PRIORITIES: Priority[] = ["baixa", "media", "alta", "urgente"];
export const STAGE_STATUSES: StageStatus[] = ["a_seguir", "em_andamento", "concluida"];

export interface Project {
  id: string;
  company_id: string;
  customer_id?: string | null;
  name: string;
  status: ProjectStatus;
  budget: number;
  start_date?: string | null;
  end_date?: string | null;
  owner_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface ProjectStage {
  id: string;
  company_id: string;
  project_id: string;
  name: string;
  description?: string | null;
  /** Ordem no plano linear (1, 2, 3…). */
  position: number;
  status: StageStatus;
  start_date?: string | null;
  end_date?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Task {
  id: string;
  company_id: string;
  project_id?: string | null;
  stage_id?: string | null;
  parent_task_id?: string | null;
  title: string;
  description?: string | null;
  status: TaskStatus;
  assignee_id?: string | null;
  priority: Priority;
  due_date?: string | null;
  estimate_hours?: number | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface ProjectInput {
  name: string;
  status: ProjectStatus;
  budget: number;
  start_date: string | null;
  end_date: string | null;
}

export interface StageInput {
  name: string;
  description: string | null;
  status: StageStatus;
  start_date: string | null;
  end_date: string | null;
}

export interface TaskInput {
  title: string;
  description: string | null;
  stage_id: string | null;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  estimate_hours: number | null;
}

export interface ProjectProgress {
  total: number;
  done: number;
  percent: number;
}

/** Percentual inteiro que só chega a 100 quando está tudo feito (199/200 mostra 99%, não 100%) e só é 0 quando nada foi feito. */
export function percentOf(done: number, total: number): number {
  if (total <= 0) return 0;
  if (done >= total) return 100;
  return Math.max(done > 0 ? 1 : 0, Math.floor((done / total) * 100));
}

export function projectProgress(tasks: Pick<Task, "status">[]): ProjectProgress {
  const done = tasks.filter((task) => task.status === "concluida").length;
  return { total: tasks.length, done, percent: percentOf(done, tasks.length) };
}
