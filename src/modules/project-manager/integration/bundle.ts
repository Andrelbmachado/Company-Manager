// Contrato de troca entre o Project Manager (app) e o Company Manager: arquivo JSON "company-manager.project-bundle"
// com linhas de `projects`, `project_stages` e `tasks`. v1 (sem etapas) ainda é aceito na importação; a exportação é v2.
import { z } from "zod";
import type { DatabaseLike } from "../db";
import { PRIORITIES, PROJECT_STATUSES, STAGE_STATUSES, TASK_STATUSES, type Project, type ProjectStage, type Task } from "../types";

export const BUNDLE_FORMAT = "company-manager.project-bundle";
export const BUNDLE_VERSION = 2;

const nullableString = z.string().nullish().transform((value) => value ?? null);

const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(PROJECT_STATUSES as [string, ...string[]]),
  budget: z.number().nullish().transform((value) => value ?? 0),
  start_date: nullableString,
  end_date: nullableString,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: nullableString,
});

const stageSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  name: z.string().min(1),
  description: nullableString,
  position: z.number().int(),
  status: z.enum(STAGE_STATUSES as [string, ...string[]]),
  start_date: nullableString,
  end_date: nullableString,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: nullableString,
});

const taskSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  stage_id: nullableString,
  parent_task_id: nullableString,
  title: z.string().min(1),
  description: nullableString,
  status: z.enum(TASK_STATUSES as [string, ...string[]]),
  priority: z.enum(PRIORITIES as [string, ...string[]]),
  due_date: nullableString,
  estimate_hours: z.number().nullish().transform((value) => value ?? null),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: nullableString,
});

const bundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.string(),
  source: z.enum(["company-manager", "project-manager"]),
  projects: z.array(projectSchema),
  stages: z.array(stageSchema).default([]),
  tasks: z.array(taskSchema),
});

export type ProjectBundle = z.infer<typeof bundleSchema>;
type BundleProject = ProjectBundle["projects"][number];
type BundleStage = ProjectBundle["stages"][number];
type BundleTask = ProjectBundle["tasks"][number];

export interface ImportCounts {
  created: number;
  updated: number;
  skipped: number;
}

export interface ImportSummary {
  projects: ImportCounts;
  stages: ImportCounts;
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

export async function exportBundle(db: DatabaseLike, companyId: string, source: ProjectBundle["source"] = "project-manager"): Promise<ProjectBundle> {
  const [projects, stages, tasks] = await Promise.all([
    db.select<Project[]>("SELECT * FROM projects WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at ASC", [companyId]),
    db.select<ProjectStage[]>("SELECT * FROM project_stages WHERE company_id=? AND deleted_at IS NULL ORDER BY position ASC", [companyId]),
    db.select<Task[]>("SELECT * FROM tasks WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at ASC", [companyId]),
  ]);
  // Passa pelo schema para garantir o formato exato do contrato (descarta colunas extras).
  return bundleSchema.parse({
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    source,
    projects,
    stages,
    tasks: tasks.filter((task) => task.project_id),
  });
}

/** Timestamps vêm como ISO (demo) ou "YYYY-MM-DD HH:MM:SS" UTC (SQLite datetime('now')). */
export function toMillis(timestamp: string): number {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp) ? `${timestamp.replace(" ", "T")}Z` : timestamp;
  const millis = Date.parse(normalized);
  return Number.isNaN(millis) ? 0 : millis;
}

const emptyCounts = (): ImportCounts => ({ created: 0, updated: 0, skipped: 0 });

/**
 * Importa o bundle para a empresa `companyId` (company_id das linhas é reescrito).
 * Upsert por id: só atualiza quando o registro do bundle é mais novo; nunca mexe em linha de outra empresa.
 * Tarefas só entram se o projeto existir; stage_id e parent_task_id desconhecidos viram NULL (evita violar FK).
 */
export async function importBundle(db: DatabaseLike, companyId: string, actorId: string | null, bundle: ProjectBundle): Promise<ImportSummary> {
  const summary: ImportSummary = { projects: emptyCounts(), stages: emptyCounts(), tasks: emptyCounts() };

  const knownProjects = new Set<string>();
  for (const project of bundle.projects) {
    const existing = (await db.select<Project[]>("SELECT * FROM projects WHERE id=?", [project.id]))[0];
    if (existing && existing.company_id !== companyId) { summary.projects.skipped += 1; continue; }
    knownProjects.add(project.id);
    if (!existing) {
      await insertProject(db, companyId, actorId, project);
      summary.projects.created += 1;
    } else if (toMillis(project.updated_at) > toMillis(existing.updated_at)) {
      await updateProject(db, project);
      summary.projects.updated += 1;
    } else {
      summary.projects.skipped += 1;
    }
  }

  const knownStages = new Set<string>();
  for (const stage of bundle.stages) {
    const projectExists = knownProjects.has(stage.project_id) || (await db.select<Project[]>("SELECT * FROM projects WHERE id=? AND company_id=?", [stage.project_id, companyId])).length > 0;
    if (!projectExists) { summary.stages.skipped += 1; continue; }
    const existing = (await db.select<ProjectStage[]>("SELECT * FROM project_stages WHERE id=?", [stage.id]))[0];
    if (existing && existing.company_id !== companyId) { summary.stages.skipped += 1; continue; }
    knownStages.add(stage.id);
    if (!existing) {
      await insertStage(db, companyId, stage);
      summary.stages.created += 1;
    } else if (toMillis(stage.updated_at) > toMillis(existing.updated_at)) {
      await updateStage(db, stage);
      summary.stages.updated += 1;
    } else {
      summary.stages.skipped += 1;
    }
  }

  for (const task of bundle.tasks) {
    const projectExists = knownProjects.has(task.project_id)
      || (await db.select<Project[]>("SELECT * FROM projects WHERE id=? AND company_id=?", [task.project_id, companyId])).length > 0;
    if (!projectExists) { summary.tasks.skipped += 1; continue; }
    const existing = (await db.select<Task[]>("SELECT * FROM tasks WHERE id=?", [task.id]))[0];
    if (existing && existing.company_id !== companyId) { summary.tasks.skipped += 1; continue; }
    const stageId = task.stage_id && (knownStages.has(task.stage_id) || (await db.select<ProjectStage[]>("SELECT * FROM project_stages WHERE id=? AND company_id=?", [task.stage_id, companyId])).length > 0) ? task.stage_id : null;
    if (!existing) {
      const parentId = task.parent_task_id && (await db.select<Task[]>("SELECT * FROM tasks WHERE id=?", [task.parent_task_id])).length ? task.parent_task_id : null;
      await insertTask(db, companyId, task, stageId, parentId);
      summary.tasks.created += 1;
    } else if (toMillis(task.updated_at) > toMillis(existing.updated_at)) {
      await updateTask(db, task, stageId);
      summary.tasks.updated += 1;
    } else {
      summary.tasks.skipped += 1;
    }
  }
  return summary;
}

function insertProject(db: DatabaseLike, companyId: string, actorId: string | null, p: BundleProject) {
  return db.execute(
    "INSERT OR IGNORE INTO projects (id, company_id, name, status, budget, start_date, end_date, owner_id, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [p.id, companyId, p.name, p.status, p.budget, p.start_date, p.end_date, actorId, p.created_at, p.updated_at, p.deleted_at],
  );
}

function updateProject(db: DatabaseLike, p: BundleProject) {
  return db.execute(
    "UPDATE projects SET name=?, status=?, budget=?, start_date=?, end_date=?, updated_at=?, deleted_at=? WHERE id=?",
    [p.name, p.status, p.budget, p.start_date, p.end_date, p.updated_at, p.deleted_at, p.id],
  );
}

function insertStage(db: DatabaseLike, companyId: string, s: BundleStage) {
  return db.execute(
    "INSERT OR IGNORE INTO project_stages (id, company_id, project_id, name, description, position, status, start_date, end_date, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [s.id, companyId, s.project_id, s.name, s.description, s.position, s.status, s.start_date, s.end_date, s.created_at, s.updated_at, s.deleted_at],
  );
}

function updateStage(db: DatabaseLike, s: BundleStage) {
  return db.execute(
    "UPDATE project_stages SET name=?, description=?, position=?, status=?, start_date=?, end_date=?, updated_at=?, deleted_at=? WHERE id=?",
    [s.name, s.description, s.position, s.status, s.start_date, s.end_date, s.updated_at, s.deleted_at, s.id],
  );
}

function insertTask(db: DatabaseLike, companyId: string, t: BundleTask, stageId: string | null, parentId: string | null) {
  return db.execute(
    "INSERT OR IGNORE INTO tasks (id, company_id, project_id, stage_id, parent_task_id, title, description, status, priority, due_date, estimate_hours, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [t.id, companyId, t.project_id, stageId, parentId, t.title, t.description, t.status, t.priority, t.due_date, t.estimate_hours, t.created_at, t.updated_at, t.deleted_at],
  );
}

function updateTask(db: DatabaseLike, t: BundleTask, stageId: string | null) {
  return db.execute(
    "UPDATE tasks SET title=?, description=?, stage_id=?, status=?, priority=?, due_date=?, estimate_hours=?, updated_at=?, deleted_at=? WHERE id=?",
    [t.title, t.description, stageId, t.status, t.priority, t.due_date, t.estimate_hours, t.updated_at, t.deleted_at, t.id],
  );
}
