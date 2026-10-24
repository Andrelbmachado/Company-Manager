// O schema que o banco demo lê das migrations tem de bater com o do SQLite real (mesmas tabelas, colunas e DEFAULT).
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, listMigrations, type TestDb } from "@/test/sqlite";
import { parseDefault, parseMigrations, splitTopLevel } from "./demoSchema";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

interface PragmaColumn {
  name: string;
  dflt_value: string | null;
}

describe("schema do banco demo", () => {
  it("tem as mesmas tabelas, colunas e valores padrão do SQLite com as migrations", async () => {
    db = await createTestDb();
    const schema = parseMigrations(listMigrations().map((migration) => migration.sql));
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'")
      .all() as { name: string }[];
    expect([...schema.keys()].sort()).toEqual(tables.map((table) => table.name).sort());

    for (const { name } of tables) {
      const columns = db.raw.prepare(`PRAGMA table_info(${name})`).all() as PragmaColumn[];
      const demo = schema.get(name)!;
      expect([...demo.keys()].sort(), name).toEqual(columns.map((column) => column.name).sort());
      for (const column of columns) {
        const expected = column.dflt_value === null ? null : parseDefault(column.dflt_value)();
        const actual = demo.get(column.name)!();
        if (typeof expected === "string" && /^\d{4}-\d{2}-\d{2}/.test(expected)) expect(String(actual), `${name}.${column.name}`).toMatch(/^\d{4}-\d{2}-\d{2}/);
        else expect(actual, `${name}.${column.name}`).toEqual(expected);
      }
    }
  });

  it("DEFAULT de expressão: datetime/date('now'), número e texto com aspas", () => {
    expect(parseDefault("(datetime('now'))")()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parseDefault("(date('now'))")()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parseDefault("480")()).toBe(480);
    expect(parseDefault("'it''s'")()).toBe("it's");
    expect(parseDefault("NULL")()).toBeNull();
  });

  it("divide por vírgula fora de parênteses e de aspas", () => {
    expect(splitTopLevel("?, datetime('now'), 'a, b', (1, 2)")).toEqual(["?", "datetime('now')", "'a, b'", "(1, 2)"]);
    expect(splitTopLevel("a=? and b='x and y'", " and ")).toEqual(["a=?", "b='x and y'"]);
  });
});
