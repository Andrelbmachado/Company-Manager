import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "./db";
import { deriveStageStatus } from "./flow";
import type { Project, ProjectInput, ProjectStage, StageInput, Task, TaskInput, TaskStatus } from "./types";

// SQLite (datetime('now') tem resolução de 1 s) e os bancos demo desempatam de formas diferentes; por isso a ordem final é
// fixada aqui. Empates em created_at/position seguem a ORDEM DE INSERÇÃO (sort estável sobre o que o banco devolveu:
// rowid no SQLite, ordem do array no demo), que é a ordem natural do plano e do seed. Nunca desempate por id (uuid aleatório).
const byStage = (a: ProjectStage, b: ProjectStage) => a.position - b.position || a.created_at.localeCompare(b.created_at);
const byCreatedAsc = <T extends { created_at: string }>(a: T, b: T) => a.created_at.localeCompare(b.created_at);
/** Mais novo primeiro; entre empates, o inserido por último vem antes. */
function newestFirst<T extends { created_at: string }>(rows: T[]): T[] {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => b.row.created_at.localeCompare(a.row.created_at) || b.index - a.index).map(({ row }) => row);
}

/**
 * Grava na etapa o status derivado das suas tarefas. Sem isso, apagar a última tarefa de uma etapa concluída
 * faria a etapa "regredir" para o status velho gravado. Etapa sem tarefas mantém o último status gravado.
 */
export async function syncStageStatus(db: DatabaseLike, companyId: string, stageId: string | null | undefined): Promise<void> {
  if (!stageId) return;
  const stage = (await db.select<ProjectStage[]>("SELECT * FROM project_stages WHERE id=? AND company_id=? AND deleted_at IS NULL", [stageId, companyId]))[0];
  if (!stage) return;
  const tasks = await db.select<Task[]>("SELECT * FROM tasks WHERE company_id=? AND stage_id=? AND deleted_at IS NULL", [companyId, stageId]);
  if (tasks.length === 0) return;
  const status = deriveStageStatus(stage, tasks);
  if (status !== stage.status) {
    await db.execute("UPDATE project_stages SET status=?, updated_at=datetime('now') WHERE id=? AND company_id=?", [status, stageId, companyId]);
  }
}

/** Acesso a projetos, etapas e tarefas. SQL idêntico para SQLite (Tauri) e para os bancos demo do navegador. */
export function createProjectRepository(db: DatabaseLike, companyId: string, actorId: string | null) {
  const listStages = async (projectId: string) =>
    (await db.select<ProjectStage[]>(
      "SELECT * FROM project_stages WHERE company_id=? AND project_id=? AND deleted_at IS NULL ORDER BY position ASC",
      [companyId, projectId],
    )).sort(byStage);

  const syncStage = (stageId: string | null | undefined) => syncStageStatus(db, companyId, stageId);
  const getTask = async (id: string) => (await db.select<Task[]>("SELECT * FROM tasks WHERE id=? AND company_id=?", [id, companyId]))[0] ?? null;

  return {
    // ── Projetos ──────────────────────────────────────────────
    listProjects: async () =>
      newestFirst(await db.select<Project[]>("SELECT * FROM projects WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at DESC", [companyId])),

    async getProject(id: string): Promise<Project | null> {
      const rows = await db.select<Project[]>("SELECT * FROM projects WHERE id=? AND company_id=? AND deleted_at IS NULL", [id, companyId]);
      return rows[0] ?? null;
    },

    async createProject(input: ProjectInput): Promise<string> {
      const id = uuidv4();
      await db.execute(
        "INSERT INTO projects (id, company_id, name, status, budget, start_date, end_date, owner_id) VALUES (?,?,?,?,?,?,?,?)",
        [id, companyId, input.name, input.status, input.budget, input.start_date, input.end_date, actorId],
      );
      return id;
    },

    async updateProject(id: string, input: ProjectInput): Promise<void> {
      await db.execute(
        "UPDATE projects SET name=?, status=?, budget=?, start_date=?, end_date=?, updated_at=datetime('now') WHERE id=? AND company_id=?",
        [input.name, input.status, input.budget, input.start_date, input.end_date, id, companyId],
      );
    },

    // ── Etapas (plano linear) ─────────────────────────────────
    listStages,

    listAllStages: async () =>
      (await db.select<ProjectStage[]>("SELECT * FROM project_stages WHERE company_id=? AND deleted_at IS NULL ORDER BY position ASC", [companyId])).sort(byStage),

    async createStage(projectId: string, input: StageInput): Promise<string> {
      const id = uuidv4();
      const position = (await listStages(projectId)).reduce((max, stage) => Math.max(max, stage.position), 0) + 1;
      await db.execute(
        "INSERT INTO project_stages (id, company_id, project_id, name, description, position, status, start_date, end_date) VALUES (?,?,?,?,?,?,?,?,?)",
        [id, companyId, projectId, input.name, input.description, position, input.status, input.start_date, input.end_date],
      );
      return id;
    },

    async updateStage(id: string, input: StageInput): Promise<void> {
      await db.execute(
        "UPDATE project_stages SET name=?, description=?, status=?, start_date=?, end_date=?, updated_at=datetime('now') WHERE id=? AND company_id=?",
        [input.name, input.description, input.status, input.start_date, input.end_date, id, companyId],
      );
      await syncStage(id);
    },

    /**
     * Move a etapa uma posição (direction -1 = para trás no plano, +1 = para frente) e **renumera o plano inteiro** (1..n),
     * o que também conserta posições repetidas (importação ou criações simultâneas) e buracos.
     */
    async moveStage(projectId: string, id: string, direction: -1 | 1): Promise<void> {
      const stages = await listStages(projectId);
      const index = stages.findIndex((stage) => stage.id === id);
      if (index === -1) return;
      const target = index + direction;
      if (target >= 0 && target < stages.length) [stages[index], stages[target]] = [stages[target], stages[index]];
      for (const [position, stage] of stages.entries()) {
        if (stage.position !== position + 1) {
          await db.execute("UPDATE project_stages SET position=?, updated_at=datetime('now') WHERE id=? AND company_id=?", [position + 1, stage.id, companyId]);
        }
      }
    },

    /** Soft delete da etapa; as tarefas dela ficam sem etapa (não são apagadas). */
    async deleteStage(id: string): Promise<void> {
      await db.execute("UPDATE tasks SET stage_id=NULL, updated_at=datetime('now') WHERE stage_id=? AND company_id=?", [id, companyId]);
      await db.execute("UPDATE project_stages SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND company_id=?", [id, companyId]);
    },

    // ── Tarefas ───────────────────────────────────────────────
    listTasks: async (projectId: string) =>
      (await db.select<Task[]>(
        "SELECT * FROM tasks WHERE company_id=? AND project_id=? AND deleted_at IS NULL ORDER BY created_at ASC",
        [companyId, projectId],
      )).sort(byCreatedAsc),

    listAllTasks: async () =>
      (await db.select<Task[]>("SELECT * FROM tasks WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at ASC", [companyId])).sort(byCreatedAsc),

    async createTask(projectId: string, input: TaskInput): Promise<string> {
      const id = uuidv4();
      await db.execute(
        "INSERT INTO tasks (id, company_id, project_id, stage_id, title, description, status, priority, due_date, estimate_hours) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [id, companyId, projectId, input.stage_id, input.title, input.description, input.status, input.priority, input.due_date, input.estimate_hours],
      );
      await syncStage(input.stage_id);
      return id;
    },

    async updateTask(id: string, input: TaskInput): Promise<void> {
      const before = await getTask(id);
      await db.execute(
        "UPDATE tasks SET title=?, description=?, stage_id=?, status=?, priority=?, due_date=?, estimate_hours=?, updated_at=datetime('now') WHERE id=? AND company_id=?",
        [input.title, input.description, input.stage_id, input.status, input.priority, input.due_date, input.estimate_hours, id, companyId],
      );
      await syncStage(input.stage_id);
      if (before?.stage_id && before.stage_id !== input.stage_id) await syncStage(before.stage_id);
    },

    async moveTask(id: string, status: TaskStatus): Promise<void> {
      const task = await getTask(id);
      await db.execute("UPDATE tasks SET status=?, updated_at=datetime('now') WHERE id=? AND company_id=?", [status, id, companyId]);
      await syncStage(task?.stage_id);
    },

    /** Soft delete (convenção do Company Manager: nunca DELETE no fluxo normal). */
    async deleteTask(id: string): Promise<void> {
      const task = await getTask(id);
      await db.execute("UPDATE tasks SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND company_id=?", [id, companyId]);
      await syncStage(task?.stage_id);
    },
  };
}

export type ProjectRepository = ReturnType<typeof createProjectRepository>;
