// Gravação da tabela de projetos (permissão e regras na camada de dados) e o cronograma no calendário. SQLite real.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { createProjectRepository, type Project, type ProjectStage, type Task } from "@/modules/project-manager";
import { projectCalendarItems, projectRows, saveProjectRows } from "./projectRows";

const C = "test-company";
const gerente = { role: "gerente" as const, userId: "test-user-gerente" };
let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await insertTestCompany(db);
});
afterEach(() => db.close());

const one = async (id: string) => (await db.select<Project[]>("SELECT * FROM projects WHERE id=?", [id]))[0];

describe("saveProjectRows", () => {
  it("cria com status planejado por padrão e altera só os campos enviados", async () => {
    const { created } = await saveProjectRows(db, C, gerente, { created: [{ name: "  Portal B2B ", budget: 12000, start_date: "2026-11-01", end_date: "2026-12-15" }], updated: [] });
    expect(await one(created[0])).toMatchObject({ name: "Portal B2B", status: "planejado", budget: 12000, start_date: "2026-11-01", end_date: "2026-12-15", owner_id: "test-user-gerente" });

    await saveProjectRows(db, C, gerente, { created: [], updated: [{ id: created[0], status: "andamento" }] });
    expect(await one(created[0])).toMatchObject({ name: "Portal B2B", status: "andamento", budget: 12000, end_date: "2026-12-15" });
  });

  it("aceita orçamento digitado como texto e limpa datas vazias", async () => {
    const { created } = await saveProjectRows(db, C, gerente, { created: [{ name: "App", budget: "2500" as unknown as number, start_date: "", end_date: null }], updated: [] });
    expect(await one(created[0])).toMatchObject({ budget: 2500, start_date: null, end_date: null });
  });

  it("recusa nome vazio, prazo antes do início, orçamento negativo e status inválido sem gravar nada", async () => {
    await expect(saveProjectRows(db, C, gerente, { created: [{ name: "Ok" }, { name: "  " }], updated: [] })).rejects.toThrow("Informe o nome do projeto.");
    await expect(saveProjectRows(db, C, gerente, { created: [{ name: "X", start_date: "2026-12-01", end_date: "2026-11-01" }], updated: [] })).rejects.toThrow("O prazo não pode ser anterior ao início.");
    await expect(saveProjectRows(db, C, gerente, { created: [{ name: "X", budget: -1 }], updated: [] })).rejects.toThrow("O orçamento não pode ser negativo.");
    await expect(saveProjectRows(db, C, gerente, { created: [{ name: "X", status: "feito" as never }], updated: [] })).rejects.toThrow("Status de projeto inválido.");
    expect(await db.select("SELECT * FROM projects WHERE company_id=?", [C])).toHaveLength(0);
  });

  it("confere a permissão: técnico só vê; projeto de outra empresa não é encontrado", async () => {
    await expect(saveProjectRows(db, C, { role: "tecnico", userId: "test-user-tecnico" }, { created: [{ name: "X" }], updated: [] })).rejects.toThrow("permissão");
    const id = await createProjectRepository(db, C, "test-user-gerente").createProject({ name: "Base", status: "planejado", budget: 0, start_date: null, end_date: null });
    await expect(saveProjectRows(db, C, { role: "tecnico", userId: "test-user-tecnico" }, { created: [], updated: [{ id, name: "Y" }] })).rejects.toThrow("permissão");
    await expect(saveProjectRows(db, "outra", gerente, { created: [], updated: [{ id, name: "Y" }] })).rejects.toThrow("Projeto não encontrado.");
    expect((await one(id)).name).toBe("Base");
  });
});

describe("linhas e cronograma", () => {
  const stamp = "2026-10-01 00:00:00";
  const project = (patch: Partial<Project>): Project => ({ id: "p1", company_id: C, name: "Portal", status: "andamento", budget: 0, start_date: "2026-11-02", end_date: "2026-11-20", created_at: stamp, updated_at: stamp, ...patch });
  const stage = (patch: Partial<ProjectStage>): ProjectStage => ({ id: "s1", company_id: C, project_id: "p1", name: "Desenho", position: 1, status: "a_seguir", start_date: "2026-11-02", end_date: "2026-11-06", created_at: stamp, updated_at: stamp, ...patch });
  const task = (patch: Partial<Task>): Task => ({ id: "t1", company_id: C, project_id: "p1", stage_id: "s1", title: "Wireframes", status: "aberta", priority: "media", due_date: "2026-11-05", created_at: stamp, updated_at: stamp, ...patch });

  it("cada linha traz o progresso e a etapa atual", () => {
    const [row] = projectRows([project({})], [stage({}), stage({ id: "s2", name: "Build", position: 2 })], [task({}), task({ id: "t2", status: "concluida" })]);
    expect(row).toMatchObject({ id: "p1", progress: "1 de 2 tarefas (50%)", stage: "Desenho" });
    expect(projectRows([project({})], [], [])[0]).toMatchObject({ progress: "Sem tarefas", stage: "Sem etapas" });
  });

  it("projeto, etapas e tarefas abertas viram dias inteiros com fim exclusivo; cancelado fica de fora", () => {
    const items = projectCalendarItems(
      [project({}), project({ id: "p2", name: "Antigo", status: "cancelado" })],
      [stage({}), stage({ id: "s9", project_id: "p2" })],
      [task({}), task({ id: "t2", status: "concluida" }), task({ id: "t3", due_date: null })],
    );
    expect(items).toEqual([
      { id: "project-p1", title: "Portal", start: "2026-11-02", end: "2026-11-21", allDay: true, sourceLabel: "Projeto" },
      { id: "stage-s1", title: "Portal: Desenho", start: "2026-11-02", end: "2026-11-07", allDay: true, sourceLabel: "Etapa" },
      { id: "task-t1", title: "Wireframes (Portal)", start: "2026-11-05", end: "2026-11-06", allDay: true, sourceLabel: "Tarefa" },
    ]);
  });

  it("projeto só com prazo aparece no dia do prazo", () => {
    expect(projectCalendarItems([project({ start_date: null, end_date: "2026-12-01" })], [], [])).toEqual([
      { id: "project-p1", title: "Prazo: Portal", start: "2026-12-01", end: "2026-12-02", allDay: true, sourceLabel: "Projeto" },
    ]);
  });
});
