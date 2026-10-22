// Contrato de troca entre o Project Manager (app) e o Company Manager: arquivo JSON "company-manager.project-bundle"
// com linhas de `projects`, `project_stages` e `tasks`. v1 (sem etapas) ainda é aceito na importação; a exportação é v2.
//
// Exclusões NÃO viajam: o arquivo leva só linhas ativas (o schema aceita deleted_at, mas a exportação não gera tombstones).
import { z } from "zod";
import type { DatabaseLike } from "../db";
import { syncStageStatus } from "../repository";
import { PRIORITIES, PROJECT_STATUSES, STAGE_STATUSES, TASK_STATUSES, type Project, type ProjectStage, type Task } from "../types";

export const BUNDLE_FORMAT = "company-manager.project-bundle";
export const BUNDLE_VERSION = 2;

/**
 * Timestamps vêm como ISO com offset, ISO sem offset ou "YYYY-MM-DD HH:MM:SS[.sss]" do SQLite — todos em UTC.
 * Sem offset é tratado como UTC (nunca como fuso local), senão o mesmo instante teria dois valores.
 */
export function toMillis(timestamp: string): number {
  let normalized = timestamp.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(normalized)) normalized = `${normalized.replace(" ", "T")}Z`;
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(normalized)) normalized = `${normalized}Z`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized = `${normalized}T00:00:00Z`;
  const millis = Date.parse(normalized);
  return Number.isNaN(millis) ? 0 : millis;
}

const nullableString = z.string().nullish().transform((value) => value ?? null);
const timestamp = z.string().refine((value) => toMillis(value) > 0, "data e hora inválidas");
/** Ausente (bundle v1) é diferente de null explícito (v2: "sem etapa"): na atualização, ausente não mexe no que já existe. */
const optionalLink = z.string().nullable().optional();

const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(PROJECT_STATUSES as [string, ...string[]]),
  budget: z.number().nullish().transform((value) => value ?? 0),
  start_date: nullableString,
  end_date: nullableString,
  created_at: timestamp,
  updated_at: timestamp,
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
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: nullableString,
});

const taskSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  stage_id: optionalLink,
  parent_task_id: optionalLink,
  title: z.string().min(1),
  description: nullableString,
  status: z.enum(TASK_STATUSES as [string, ...string[]]),
  priority: z.enum(PRIORITIES as [string, ...string[]]),
  due_date: nullableString,
  estimate_hours: z.number().nullish().transform((value) => value ?? null),
  created_at: timestamp,
  updated_at: timestamp,
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
  /** O registro local já é igual ou mais novo que o do arquivo. */
  unchanged: number;
  /** Rejeitado: pertence a outra empresa, ou não tem projeto/etapa válido. */
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

export interface ExportReport {
  bundle: ProjectBundle;
  /** Linhas que não couberam no contrato (ex.: status desconhecido) e ficaram de fora do arquivo. */
  skipped: { projects: number; stages: number; tasks: number };
}

/** Exporta o que é válido e conta o que ficou de fora, em vez de falhar o arquivo inteiro por uma linha ruim. */
export async function exportBundleReport(db: DatabaseLike, companyId: string, source: ProjectBundle["source"] = "project-manager"): Promise<ExportReport> {
  const [projects, stages, tasks] = await Promise.all([
    db.select<Project[]>("SELECT * FROM projects WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at ASC", [companyId]),
    db.select<ProjectStage[]>("SELECT * FROM project_stages WHERE company_id=? AND deleted_at IS NULL ORDER BY position ASC", [companyId]),
    db.select<Task[]>("SELECT * FROM tasks WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at ASC", [companyId]),
  ]);
  const skipped = { projects: 0, stages: 0, tasks: 0 };
  const keep = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, rows: unknown[], kind: keyof typeof skipped): T[] =>
    rows.flatMap((row) => {
      const parsed = schema.safeParse(row);
      if (parsed.success) return [parsed.data];
      skipped[kind] += 1;
      return [];
    });
  const bundle: ProjectBundle = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    source,
    projects: keep(projectSchema, projects, "projects"),
    stages: keep(stageSchema, stages, "stages"),
    // v2 grava stage_id e parent_task_id sempre (null = sem etapa / sem pai), para a importação saber que são intencionais.
    tasks: keep(taskSchema, tasks.filter((task) => task.project_id).map((task) => ({ ...task, stage_id: task.stage_id ?? null, parent_task_id: task.parent_task_id ?? null })), "tasks"),
  };
  return { bundle, skipped };
}

export async function exportBundle(db: DatabaseLike, companyId: string, source: ProjectBundle["source"] = "project-manager"): Promise<ProjectBundle> {
  return (await exportBundleReport(db, companyId, source)).bundle;
}

const counts = (): ImportCounts => ({ created: 0, updated: 0, unchanged: 0, skipped: 0 });

/**
 * Importa o bundle para a empresa `companyId` (company_id das linhas é reescrito).
 * - Upsert por id: só atualiza quando o registro do arquivo é mais novo; nunca mexe em linha de outra empresa.
 * - Tarefas só entram se o projeto existir na empresa. `stage_id` precisa ser uma etapa ativa da empresa, senão vira NULL.
 * - `stage_id`/`parent_task_id` ausentes (bundle v1) NÃO alteram o que já existe; NULL explícito (v2) limpa.
 * - `parent_task_id` é ligado depois que todas as tarefas entraram (a ordem do arquivo não importa) e só a tarefas da mesma empresa.
 * - Não é transacional: o tauri-plugin-sql usa conexões em pool. Se falhar no meio, o que já foi gravado fica (rodar de novo completa).
 */
export async function importBundle(db: DatabaseLike, companyId: string, actorId: string | null, bundle: ProjectBundle): Promise<ImportSummary> {
  const summary: ImportSummary = { projects: counts(), stages: counts(), tasks: counts() };

  const companyProject = async (id: string) => (await db.select<Project[]>("SELECT * FROM projects WHERE id=? AND company_id=? AND deleted_at IS NULL", [id, companyId])).length > 0;
  const knownProjects = new Set<string>();

  for (const project of bundle.projects) {
    const existing = (await db.select<Project[]>("SELECT * FROM projects WHERE id=?", [project.id]))[0];
    if (existing && existing.company_id !== companyId) { summary.projects.skipped += 1; continue; }
    knownProjects.add(project.id);
    if (!existing) {
      await insertProject(db, companyId, actorId, project);
      summary.projects.created += 1;
    } else if (toMillis(project.updated_at) > toMillis(existing.updated_at)) {
      await updateProject(db, companyId, project);
      summary.projects.updated += 1;
    } else {
      summary.projects.unchanged += 1;
    }
  }

  const knownStages = new Set<string>();
  const touchedStages = new Set<string>();
  for (const stage of bundle.stages) {
    if (!(knownProjects.has(stage.project_id) || await companyProject(stage.project_id))) { summary.stages.skipped += 1; continue; }
    const existing = (await db.select<ProjectStage[]>("SELECT * FROM project_stages WHERE id=?", [stage.id]))[0];
    if (existing && existing.company_id !== companyId) { summary.stages.skipped += 1; continue; }
    knownStages.add(stage.id);
    if (!existing) {
      await insertStage(db, companyId, stage);
      summary.stages.created += 1;
    } else if (toMillis(stage.updated_at) > toMillis(existing.updated_at)) {
      await updateStage(db, companyId, stage);
      summary.stages.updated += 1;
    } else {
      summary.stages.unchanged += 1;
    }
  }

  const activeStage = async (id: string) => knownStages.has(id) || (await db.select<ProjectStage[]>("SELECT * FROM project_stages WHERE id=? AND company_id=? AND deleted_at IS NULL", [id, companyId])).length > 0;
  const applied: BundleTask[] = [];
  for (const task of bundle.tasks) {
    if (!(knownProjects.has(task.project_id) || await companyProject(task.project_id))) { summary.tasks.skipped += 1; continue; }
    const existing = (await db.select<Task[]>("SELECT * FROM tasks WHERE id=?", [task.id]))[0];
    if (existing && existing.company_id !== companyId) { summary.tasks.skipped += 1; continue; }
    const stageId = task.stage_id && await activeStage(task.stage_id) ? task.stage_id : null;
    if (!existing) {
      await insertTask(db, companyId, task, stageId);
      summary.tasks.created += 1;
      applied.push(task);
    } else if (toMillis(task.updated_at) > toMillis(existing.updated_at)) {
      await updateTask(db, companyId, task, task.stage_id === undefined ? undefined : stageId);
      summary.tasks.updated += 1;
      applied.push(task);
    } else {
      summary.tasks.unchanged += 1;
    }
    if (stageId) touchedStages.add(stageId);
  }

  // Segunda passada: pais das tarefas, já com todas gravadas (a ordem no arquivo não importa) e só dentro da empresa.
  for (const task of applied) {
    if (task.parent_task_id === undefined) continue;
    const parentOk = task.parent_task_id !== null && task.parent_task_id !== task.id
      && (await db.select<Task[]>("SELECT * FROM tasks WHERE id=? AND company_id=? AND deleted_at IS NULL", [task.parent_task_id, companyId])).length > 0;
    await db.execute("UPDATE tasks SET parent_task_id=? WHERE id=? AND company_id=?", [parentOk ? task.parent_task_id : null, task.id, companyId]);
  }

  for (const stageId of touchedStages) await syncStageStatus(db, companyId, stageId);
  return summary;
}

function insertProject(db: DatabaseLike, companyId: string, actorId: string | null, p: BundleProject) {
  return db.execute(
    "INSERT OR IGNORE INTO projects (id, company_id, name, status, budget, start_date, end_date, owner_id, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [p.id, companyId, p.name, p.status, p.budget, p.start_date, p.end_date, actorId, p.created_at, p.updated_at, p.deleted_at],
  );
}

function updateProject(db: DatabaseLike, companyId: string, p: BundleProject) {
  return db.execute(
    "UPDATE projects SET name=?, status=?, budget=?, start_date=?, end_date=?, updated_at=?, deleted_at=? WHERE id=? AND company_id=?",
    [p.name, p.status, p.budget, p.start_date, p.end_date, p.updated_at, p.deleted_at, p.id, companyId],
  );
}

function insertStage(db: DatabaseLike, companyId: string, s: BundleStage) {
  return db.execute(
    "INSERT OR IGNORE INTO project_stages (id, company_id, project_id, name, description, position, status, start_date, end_date, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [s.id, companyId, s.project_id, s.name, s.description, s.position, s.status, s.start_date, s.end_date, s.created_at, s.updated_at, s.deleted_at],
  );
}

function updateStage(db: DatabaseLike, companyId: string, s: BundleStage) {
  return db.execute(
    "UPDATE project_stages SET project_id=?, name=?, description=?, position=?, status=?, start_date=?, end_date=?, updated_at=?, deleted_at=? WHERE id=? AND company_id=?",
    [s.project_id, s.name, s.description, s.position, s.status, s.start_date, s.end_date, s.updated_at, s.deleted_at, s.id, companyId],
  );
}

/** parent_task_id entra sempre NULL aqui; a segunda passada liga os pais. */
function insertTask(db: DatabaseLike, companyId: string, t: BundleTask, stageId: string | null) {
  return db.execute(
    "INSERT OR IGNORE INTO tasks (id, company_id, project_id, stage_id, parent_task_id, title, description, status, priority, due_date, estimate_hours, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [t.id, companyId, t.project_id, stageId, null, t.title, t.description, t.status, t.priority, t.due_date, t.estimate_hours, t.created_at, t.updated_at, t.deleted_at],
  );
}

/** `stageId === undefined`: o arquivo não trouxe etapa (v1), então a etapa atual da tarefa fica como está. */
async function updateTask(db: DatabaseLike, companyId: string, t: BundleTask, stageId: string | null | undefined) {
  await db.execute(
    "UPDATE tasks SET project_id=?, title=?, description=?, status=?, priority=?, due_date=?, estimate_hours=?, updated_at=?, deleted_at=? WHERE id=? AND company_id=?",
    [t.project_id, t.title, t.description, t.status, t.priority, t.due_date, t.estimate_hours, t.updated_at, t.deleted_at, t.id, companyId],
  );
  if (stageId !== undefined) await db.execute("UPDATE tasks SET stage_id=? WHERE id=? AND company_id=?", [stageId, t.id, companyId]);
}
