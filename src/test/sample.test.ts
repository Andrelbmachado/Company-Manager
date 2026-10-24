import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, listMigrations, MIGRATIONS_DIR, toTauriBind, type TestDb } from "@/test/sqlite";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

describe("createTestDb", () => {
  it("aplica todas as migrations num banco vazio", async () => {
    db = await createTestDb();
    const [row] = await db.select<{ n: number }[]>("SELECT count(*) AS n FROM companies");
    expect(row.n).toBe(0);
    expect(db.appliedVersions).toEqual(listMigrations().map((m) => m.version));
    const tables = await db.select<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type='table'");
    const names = tables.map((t) => t.name);
    for (const table of ["companies", "users", "memberships", "leads", "project_stages", "employees", "employee_compensation"]) {
      expect(names).toContain(table);
    }
  });

  it("lista as migrations em ordem numérica, sem versões repetidas nem buracos", () => {
    const versions = listMigrations().map((m) => m.version);
    expect(versions.length).toBeGreaterThanOrEqual(7);
    expect(versions).toEqual(versions.map((_, i) => i + 1));
  });

  it("cada arquivo de migration está registrado no lib.rs com a versão do prefixo", () => {
    const libRs = readFileSync(path.resolve(MIGRATIONS_DIR, "../src/lib.rs"), "utf8");
    const registered = [...libRs.matchAll(/version:\s*(\d+)[\s\S]*?include_str!\("\.\.\/migrations\/([^"]+)"\)/g)].map((m) => ({
      version: Number(m[1]),
      file: m[2],
    }));
    expect(registered).toEqual(listMigrations().map((m) => ({ version: m.version, file: m.file })));
  });

  it("liga as chaves estrangeiras (como o sqlx do app desktop)", async () => {
    db = await createTestDb();
    const [fk] = await db.select<{ foreign_keys: number }[]>("PRAGMA foreign_keys");
    expect(fk.foreign_keys).toBe(1);
    await expect(
      db.execute("INSERT INTO settings (id, company_id, key) VALUES (?, ?, ?)", ["s1", "empresa-que-nao-existe", "x"]),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("execute devolve rowsAffected e lastInsertId; select devolve linhas", async () => {
    db = await createTestDb();
    const insert = await db.execute("INSERT INTO companies (id, name) VALUES (?, ?)", ["c1", "Empresa Teste"]);
    expect(insert.rowsAffected).toBe(1);
    expect(typeof insert.lastInsertId).toBe("number");
    const ignored = await db.execute("INSERT OR IGNORE INTO companies (id, name) VALUES (?, ?)", ["c1", "Outra"]);
    expect(ignored.rowsAffected).toBe(0);
    const update = await db.execute("UPDATE companies SET name = ? WHERE id = ?", ["Empresa Nova", "c1"]);
    expect(update.rowsAffected).toBe(1);
    const rows = await db.select<{ id: string; name: string; deleted_at: string | null }[]>("SELECT * FROM companies WHERE id = ?", ["c1"]);
    expect(rows).toEqual([expect.objectContaining({ id: "c1", name: "Empresa Nova", deleted_at: null })]);
  });

  it("converte binds como o tauri-plugin-sql (undefined → NULL, objeto → JSON, data → ISO, número → REAL)", async () => {
    db = await createTestDb();
    const when = new Date("2026-10-24T12:00:00.000Z");
    const [row] = await db.select<Record<string, unknown>[]>("SELECT ? AS u, ? AS o, ? AS d, ? AS n, typeof(?) AS tn, ? AS nan", [
      undefined,
      { tema: "escuro" },
      when,
      1234.56,
      5,
      Number.NaN,
    ]);
    expect(row).toEqual({ u: null, o: '{"tema":"escuro"}', d: "2026-10-24T12:00:00.000Z", n: 1234.56, tn: "real", nan: null });

    await db.execute("INSERT INTO companies (id, name, document, settings_json) VALUES (?, ?, ?, ?)", ["c1", "Empresa", undefined, { tema: "escuro" }]);
    const [company] = await db.select<{ document: string | null; settings_json: string }[]>("SELECT * FROM companies WHERE id = ?", ["c1"]);
    expect(company.document).toBeNull();
    expect(JSON.parse(company.settings_json)).toEqual({ tema: "escuro" });
  });

  it("booleano vira o texto 'true'/'false' (como no app desktop): colunas 0/1 precisam de número", async () => {
    db = await createTestDb();
    const [row] = await db.select<Record<string, unknown>[]>("SELECT ? AS t, ? AS f, typeof(?) AS tt", [true, false, true]);
    expect(row).toEqual({ t: "true", f: "false", tt: "text" });
    expect(toTauriBind(1)).toBe(1);
    expect(toTauriBind([1, "a"])).toBe('[1,"a"]');
  });

  it("recusa binds que o plugin do Tauri não grava (BigInt, binário)", () => {
    expect(() => toTauriBind(10n)).toThrow(/BigInt/);
    expect(() => toTauriBind(new Uint8Array([1, 2]))).toThrow(/binários/);
  });

  it("insertTestCompany cria a empresa e uma conta por papel", async () => {
    db = await createTestDb();
    const { companyId, userIds } = await insertTestCompany(db);
    expect(Object.keys(userIds)).toHaveLength(11);
    const members = await db.select<{ role: string; user_id: string }[]>("SELECT role, user_id FROM memberships WHERE company_id = ? ORDER BY role", [companyId]);
    expect(members).toHaveLength(11);
    expect(members).toContainEqual({ role: "ceo", user_id: userIds.ceo });

    const other = await insertTestCompany(db, { companyId: "outra", roles: ["financeiro"] });
    expect(other.userIds).toEqual({ financeiro: "test-user-financeiro" });
  });

  it("aceita vários comandos sem binds num só execute", async () => {
    db = await createTestDb();
    await db.execute("INSERT INTO companies (id, name) VALUES ('a', 'A'); INSERT INTO companies (id, name) VALUES ('b', 'B');");
    const [row] = await db.select<{ n: number }[]>("SELECT count(*) AS n FROM companies");
    expect(row.n).toBe(2);
  });

  it("aplica só até a versão pedida e completa depois (teste de upgrade de schema)", async () => {
    db = await createTestDb({ upTo: 6 });
    expect(db.appliedVersions.at(-1)).toBe(6);
    await expect(db.select("SELECT * FROM employee_compensation")).rejects.toThrow(/no such table/);
    await db.execute("INSERT INTO companies (id, name) VALUES (?, ?)", ["c1", "Empresa antiga"]);
    await db.migrate();
    expect(db.appliedVersions).toEqual(listMigrations().map((m) => m.version));
    const [row] = await db.select<{ n: number }[]>("SELECT count(*) AS n FROM employee_compensation");
    expect(row.n).toBe(0);
    const companies = await db.select<{ id: string }[]>("SELECT id FROM companies");
    expect(companies).toEqual([{ id: "c1" }]);
  });

  it("cada banco é isolado", async () => {
    db = await createTestDb();
    await db.execute("INSERT INTO companies (id, name) VALUES (?, ?)", ["c1", "Empresa"]);
    const other = await createTestDb();
    try {
      const [row] = await other.select<{ n: number }[]>("SELECT count(*) AS n FROM companies");
      expect(row.n).toBe(0);
    } finally {
      other.close();
    }
  });
});
