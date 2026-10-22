// Contrato de troca com o Project Manager (~/Documents/Trabalho/Sites/Project-Manager):
// arquivo JSON "company-manager.project-bundle" v1 com linhas de `projects` e `tasks`.
// Espelho de src/module/integration/bundle.ts no Project Manager — mantenha os dois sincronizados.
import { z } from "zod";
import type { DatabaseLike } from "@/lib/db/demo";
import type { Project, Session, Task } from "@/types";

export const BUNDLE_FORMAT = "company-manager.project-bundle";
export const BUNDLE_VERSION = 1;

const PROJECT_STATUSES = ["planejado", "andamento", "pausado", "concluido", "cancelado"] as const;
const TASK_STATUSES = ["aberta", "em_andamento", "concluida", "bloqueada"] as const;
const PRIORITIES = ["baixa", "media", "alta", "urgente"] as const;

const nullableString = z.string().nullish().transform((value) => value ?? null);

const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(PROJECT_STATUSES),
  budget: z.number().nullish().transform((value) => value ?? 0),
  start_date: nullableString,
  end_date: nullableString,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: nullableString,
});

const taskSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  parent_task_id: nullableString,
  title: z.string().min(1),
  description: nullableString,
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITIES),
  due_date: nullableString,
  estimate_hours: z.number().nullish().transform((value) => value ?? null),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: nullableString,
});

const bundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.literal(BUNDLE_VERSION),
  exportedAt: z.string(),
  source: z.enum(["company-manager", "project-manager"]),
  projects: z.array(projectSchema),
  tasks: z.array(taskSchema),
});

export type ProjectBundle = z.infer<typeof bundleSchema>;

export interface ImportCounts {
  created: number;
  updated: number;
  skipped: number;
}

export interface ImportSummary {
  projects: ImportCounts;
  tasks: ImportCounts;
}

export function parseBundle(json: string): ProjectBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Arquivo inválido: não é um JSON.");
  }
  const parsed = bundleSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Arquivo inválido: ${first.path.join(".") || "raiz"} — ${first.message}`);
  }
  return parsed.data;
}

export async function exportProjectBundle(db: DatabaseLike, companyId: string): Promise<ProjectBundle> {
  const [projects, tasks] = await Promise.all([
    db.select<Project[]>("SELECT * FROM projects WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at ASC", [companyId]),
    db.select<Task[]>("SELECT * FROM tasks WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at ASC", [companyId]),
  ]);
  return bundleSchema.parse({
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    source: "company-manager",
    projects,
    tasks: tasks.filter((task) => task.project_id),
  });
}

/** Timestamps vêm como ISO (demo/Project Manager) ou "YYYY-MM-DD HH:MM:SS" UTC (SQLite datetime('now')). */
export function toMillis(timestamp: string): number {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp) ? `${timestamp.replace(" ", "T")}Z` : timestamp;
  const millis = Date.parse(normalized);
  return Number.isNaN(millis) ? 0 : millis;
}

/**
 * Importa o bundle para a empresa da sessão. Upsert por id: só atualiza se o registro do bundle for mais novo;
 * linhas de outra empresa são ignoradas. Colunas que o bundle não carrega (cliente, contrato, responsável) não são alteradas;
 * projetos novos ficam com o usuário atual como responsável. parent_task_id só é mantido se a tarefa pai existir.
 */
export async function importProjectBundle(db: DatabaseLike, session: Session, bundle: ProjectBundle): Promise<ImportSummary> {
  const companyId = session.company.id;
  const summary: ImportSummary = {
    projects: { created: 0, updated: 0, skipped: 0 },
    tasks: { created: 0, updated: 0, skipped: 0 },
  };

  const knownProjects = new Set<string>();
  for (const project of bundle.projects) {
    const existing = (await db.select<Project[]>("SELECT * FROM projects WHERE id=?", [project.id]))[0];
    if (existing && existing.company_id !== companyId) { summary.projects.skipped += 1; continue; }
    knownProjects.add(project.id);
    if (!existing) {
      await db.execute(
        "INSERT OR IGNORE INTO projects (id, company_id, name, status, budget, start_date, end_date, owner_id, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [project.id, companyId, project.name, project.status, project.budget, project.start_date, project.end_date, session.user.id, project.created_at, project.updated_at, project.deleted_at],
      );
      summary.projects.created += 1;
    } else if (toMillis(project.updated_at) > toMillis(existing.updated_at)) {
      await db.execute(
        "UPDATE projects SET name=?, status=?, budget=?, start_date=?, end_date=?, updated_at=?, deleted_at=? WHERE id=?",
        [project.name, project.status, project.budget, project.start_date, project.end_date, project.updated_at, project.deleted_at, project.id],
      );
      summary.projects.updated += 1;
    } else {
      summary.projects.skipped += 1;
    }
  }

  for (const task of bundle.tasks) {
    const projectExists = knownProjects.has(task.project_id)
      || (await db.select<Project[]>("SELECT * FROM projects WHERE id=? AND company_id=?", [task.project_id, companyId])).length > 0;
    if (!projectExists) { summary.tasks.skipped += 1; continue; }
    const existing = (await db.select<Task[]>("SELECT * FROM tasks WHERE id=?", [task.id]))[0];
    if (existing && existing.company_id !== companyId) { summary.tasks.skipped += 1; continue; }
    if (!existing) {
      const parentId = task.parent_task_id && (await db.select<Task[]>("SELECT * FROM tasks WHERE id=?", [task.parent_task_id])).length ? task.parent_task_id : null;
      await db.execute(
        "INSERT OR IGNORE INTO tasks (id, company_id, project_id, parent_task_id, title, description, status, priority, due_date, estimate_hours, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [task.id, companyId, task.project_id, parentId, task.title, task.description, task.status, task.priority, task.due_date, task.estimate_hours, task.created_at, task.updated_at, task.deleted_at],
      );
      summary.tasks.created += 1;
    } else if (toMillis(task.updated_at) > toMillis(existing.updated_at)) {
      await db.execute(
        "UPDATE tasks SET title=?, description=?, status=?, priority=?, due_date=?, estimate_hours=?, updated_at=?, deleted_at=? WHERE id=?",
        [task.title, task.description, task.status, task.priority, task.due_date, task.estimate_hours, task.updated_at, task.deleted_at, task.id],
      );
      summary.tasks.updated += 1;
    } else {
      summary.tasks.skipped += 1;
    }
  }
  return summary;
}
