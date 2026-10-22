import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "./db";
import type { Project, ProjectInput, ProjectStage, StageInput, Task, TaskInput, TaskStatus } from "./types";

/** Acesso a projetos, etapas e tarefas. SQL idêntico para SQLite (Tauri) e para os bancos demo do navegador. */
export function createProjectRepository(db: DatabaseLike, companyId: string, actorId: string | null) {
  const listStages = (projectId: string) =>
    db.select<ProjectStage[]>(
      "SELECT * FROM project_stages WHERE company_id=? AND project_id=? AND deleted_at IS NULL ORDER BY position ASC",
      [companyId, projectId],
    );

  return {
    // ── Projetos ──────────────────────────────────────────────
    listProjects: () =>
      db.select<Project[]>("SELECT * FROM projects WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at DESC", [companyId]),

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

    listAllStages: () =>
      db.select<ProjectStage[]>("SELECT * FROM project_stages WHERE company_id=? AND deleted_at IS NULL ORDER BY position ASC", [companyId]),

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
    },

    /** Troca a posição da etapa com a vizinha (direction -1 = para trás no plano, +1 = para frente). */
    async moveStage(projectId: string, id: string, direction: -1 | 1): Promise<void> {
      const stages = await listStages(projectId);
      const index = stages.findIndex((stage) => stage.id === id);
      const other = stages[index + direction];
      if (index === -1 || !other) return;
      const current = stages[index];
      await db.execute("UPDATE project_stages SET position=?, updated_at=datetime('now') WHERE id=? AND company_id=?", [other.position, current.id, companyId]);
      await db.execute("UPDATE project_stages SET position=?, updated_at=datetime('now') WHERE id=? AND company_id=?", [current.position, other.id, companyId]);
    },

    /** Soft delete da etapa; as tarefas dela ficam sem etapa (não são apagadas). */
    async deleteStage(id: string): Promise<void> {
      await db.execute("UPDATE tasks SET stage_id=NULL, updated_at=datetime('now') WHERE stage_id=? AND company_id=?", [id, companyId]);
      await db.execute("UPDATE project_stages SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND company_id=?", [id, companyId]);
    },

    // ── Tarefas ───────────────────────────────────────────────
    listTasks: (projectId: string) =>
      db.select<Task[]>(
        "SELECT * FROM tasks WHERE company_id=? AND project_id=? AND deleted_at IS NULL ORDER BY created_at ASC",
        [companyId, projectId],
      ),

    listAllTasks: () =>
      db.select<Task[]>("SELECT * FROM tasks WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at ASC", [companyId]),

    async createTask(projectId: string, input: TaskInput): Promise<string> {
      const id = uuidv4();
      await db.execute(
        "INSERT INTO tasks (id, company_id, project_id, stage_id, title, description, status, priority, due_date, estimate_hours) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [id, companyId, projectId, input.stage_id, input.title, input.description, input.status, input.priority, input.due_date, input.estimate_hours],
      );
      return id;
    },

    async updateTask(id: string, input: TaskInput): Promise<void> {
      await db.execute(
        "UPDATE tasks SET title=?, description=?, stage_id=?, status=?, priority=?, due_date=?, estimate_hours=?, updated_at=datetime('now') WHERE id=? AND company_id=?",
        [input.title, input.description, input.stage_id, input.status, input.priority, input.due_date, input.estimate_hours, id, companyId],
      );
    },

    async moveTask(id: string, status: TaskStatus): Promise<void> {
      await db.execute("UPDATE tasks SET status=?, updated_at=datetime('now') WHERE id=? AND company_id=?", [status, id, companyId]);
    },

    /** Soft delete (convenção do Company Manager: nunca DELETE no fluxo normal). */
    async deleteTask(id: string): Promise<void> {
      await db.execute("UPDATE tasks SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND company_id=?", [id, companyId]);
    },
  };
}

export type ProjectRepository = ReturnType<typeof createProjectRepository>;
