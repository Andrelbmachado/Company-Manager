// @vitest-environment jsdom
// Iniciativas de desenvolvimento de produtos: gravadas por empresa em `settings` (sem tabela própria), com permissão
// conferida na camada de dados. SQLite real e banco demo.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { createDemoDb, DEMO_COMPANY_ID } from "@/lib/db/demo";
import { deleteInitiative, INITIATIVES_SETTING, loadInitiatives, milestoneItems, saveInitiativeChanges } from "./initiatives";

const C = "test-company";
let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await insertTestCompany(db);
});

afterEach(() => db.close());

describe("iniciativas de produto", () => {
  it("começa vazia, cria, altera só o que mudou e mantém a ordem", async () => {
    expect(await loadInitiatives(db, C)).toEqual([]);
    const { created } = await saveInitiativeChanges(db, C, "produtos", {
      created: [
        { name: " Sensor Edge ", type: "fisico", status: "em_validacao", owner: "Equipe Hardware", next_milestone: "Lote piloto", milestone_date: "2026-11-18" },
        { name: "Portal", type: "digital" },
      ],
      updated: [],
    });
    expect(created).toHaveLength(2);
    let list = await loadInitiatives(db, C);
    expect(list.map((item) => item.name)).toEqual(["Sensor Edge", "Portal"]);
    expect(list[1]).toMatchObject({ status: "planejado", owner: null, milestone_date: null });

    await saveInitiativeChanges(db, C, "produtos", { created: [], updated: [{ id: created[1], status: "em_desenvolvimento", milestone_date: "2026-12-01" }] });
    list = await loadInitiatives(db, C);
    expect(list[1]).toMatchObject({ name: "Portal", type: "digital", status: "em_desenvolvimento", milestone_date: "2026-12-01" });
    expect(list[0].name).toBe("Sensor Edge");
  });

  it("só quem tem permissão cria, edita e exclui (conferido aqui, não só na tela)", async () => {
    const { created } = await saveInitiativeChanges(db, C, "ceo", { created: [{ name: "Gateway", type: "fisico" }], updated: [] });
    await expect(saveInitiativeChanges(db, C, "gerente", { created: [{ name: "Outro", type: "digital" }], updated: [] })).rejects.toThrow(/permissão/);
    await expect(saveInitiativeChanges(db, C, "auditor", { created: [], updated: [{ id: created[0], name: "X" }] })).rejects.toThrow(/permissão/);
    await expect(deleteInitiative(db, C, "produtos", created[0])).rejects.toThrow(/permissão/);
    await deleteInitiative(db, C, "admin", created[0]);
    expect(await loadInitiatives(db, C)).toEqual([]);
  });

  it("recusa nome vazio, tipo e status desconhecidos, data inválida e id que não existe", async () => {
    await expect(saveInitiativeChanges(db, C, "produtos", { created: [{ name: "  ", type: "fisico" }], updated: [] })).rejects.toThrow(/nome/i);
    await expect(saveInitiativeChanges(db, C, "produtos", { created: [{ name: "A", type: "outro" as never }], updated: [] })).rejects.toThrow(/tipo/i);
    await expect(saveInitiativeChanges(db, C, "produtos", { created: [{ name: "A", type: "digital", status: "x" as never }], updated: [] })).rejects.toThrow(/status/i);
    await expect(saveInitiativeChanges(db, C, "produtos", { created: [{ name: "A", type: "digital", milestone_date: "31/12/2026" }], updated: [] })).rejects.toThrow(/data/i);
    await expect(saveInitiativeChanges(db, C, "produtos", { created: [], updated: [{ id: "nao-existe", name: "B" }] })).rejects.toThrow(/não encontrada/);
  });

  it("JSON quebrado ou itens inválidos no settings não derrubam a tela", async () => {
    await db.execute("INSERT INTO settings (id, company_id, key, value_json) VALUES (?,?,?,?)", ["s1", C, INITIATIVES_SETTING, "[{\"id\":\"a\",\"name\":\"Ok\",\"type\":\"digital\",\"status\":\"planejado\"},{\"foo\":1},3]"]);
    expect((await loadInitiatives(db, C)).map((item) => item.name)).toEqual(["Ok"]);
    await db.execute("UPDATE settings SET value_json=? WHERE id=?", ["{quebrado", "s1"]);
    expect(await loadInitiatives(db, C)).toEqual([]);
  });

  it("marcos com data viram itens de dia inteiro no calendário", () => {
    const items = milestoneItems([
      { id: "a", name: "Sensor", type: "fisico", status: "planejado", owner: null, next_milestone: "Protótipo", milestone_date: "2026-11-05", created_at: "", updated_at: "" },
      { id: "b", name: "Portal", type: "digital", status: "planejado", owner: null, next_milestone: null, milestone_date: null, created_at: "", updated_at: "" },
    ]);
    expect(items).toEqual([{ id: "a", title: "Sensor: Protótipo", start: "2026-11-05", allDay: true, sourceLabel: "Físico" }]);
  });

  it("funciona no banco demo do navegador", async () => {
    localStorage.clear();
    const demo = createDemoDb();
    const { created } = await saveInitiativeChanges(demo, DEMO_COMPANY_ID, "ceo", { created: [{ name: "App", type: "digital" }], updated: [] });
    await saveInitiativeChanges(demo, DEMO_COMPANY_ID, "ceo", { created: [], updated: [{ id: created[0], owner: "Equipe Experiência" }] });
    expect(await loadInitiatives(demo, DEMO_COMPANY_ID)).toMatchObject([{ name: "App", owner: "Equipe Experiência" }]);
  });
});
