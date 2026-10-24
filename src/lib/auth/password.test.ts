import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany, type TestDb } from "@/test/sqlite";
import { verifyPassword } from "./hash";
import { login } from "./login";
import { passwordProblem, resetUserPassword, upgradeLegacyPasswords } from "./password";
import { seedRoleAccounts } from "./seedRoleAccounts";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
});

async function hashOf(db: TestDb, id: string): Promise<{ password_hash: string; password_algo: string }> {
  const [row] = await db.select<{ password_hash: string; password_algo: string }[]>("SELECT password_hash, password_algo FROM users WHERE id = ?", [id]);
  return row;
}

describe("passwordProblem", () => {
  it("exige 6 caracteres e algo além de espaços", () => {
    expect(passwordProblem("12345")).toMatch(/pelo menos 6/);
    expect(passwordProblem("      ")).toMatch(/só espaços/);
    expect(passwordProblem("senha boa")).toBeNull();
  });
});

describe("users.password_algo (gatilhos da migration 0010)", () => {
  it("acompanha o formato do hash em INSERT e UPDATE, sem o app gravar a coluna", async () => {
    const db = testDb();
    await insertTestCompany(db, { roles: ["comercial"] });
    expect((await hashOf(db, "test-user-comercial")).password_algo).toBe("plain");

    await login("comercial@teste.local", "teste");
    expect(await hashOf(db, "test-user-comercial")).toMatchObject({ password_algo: "pbkdf2" });

    await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", ["$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA", "test-user-comercial"]);
    expect((await hashOf(db, "test-user-comercial")).password_algo).toBe("argon2id");
    await db.execute("INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)", ["u-x", "X", "x@teste.local", "md5$abc"]);
    expect((await hashOf(db, "u-x")).password_algo).toBe("unknown");
    // "PLAIN:" não é o prefixo legado (o login também não aceita).
    await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", ["PLAIN:x", "u-x"]);
    expect((await hashOf(db, "u-x")).password_algo).toBe("unknown");
  });
});

describe("upgradeLegacyPasswords", () => {
  it("troca todo plain: pelo hash sem mudar a senha (inclusive de conta removida) e não mexe no resto", async () => {
    const db = testDb();
    await insertTestCompany(db, { roles: ["rh", "auditor", "produtos"] });
    await resetUserPassword("test-user-auditor", "auditoria1", { mustChange: false });
    const auditorHash = (await hashOf(db, "test-user-auditor")).password_hash;
    await db.execute("UPDATE users SET deleted_at = datetime('now') WHERE id = ?", ["test-user-produtos"]);

    await expect(upgradeLegacyPasswords()).resolves.toBe(2);

    for (const id of ["test-user-rh", "test-user-produtos"]) {
      const row = await hashOf(db, id);
      expect(row.password_algo, id).toBe("pbkdf2");
      expect(row.password_hash, id).not.toContain("teste");
      await expect(verifyPassword("teste", row.password_hash)).resolves.toEqual({ ok: true, needsRehash: false });
    }
    expect((await hashOf(db, "test-user-auditor")).password_hash).toBe(auditorHash);
    await expect(login("rh@teste.local", "teste")).resolves.toMatchObject({ membership: { role: "rh" } });
    await expect(upgradeLegacyPasswords()).resolves.toBe(0);
  });

  it("não sobrescreve a senha trocada enquanto o hash era calculado", async () => {
    const db = testDb();
    await insertTestCompany(db, { roles: ["rh"] });
    // A troca acontece entre a leitura e a gravação: o UPDATE condicionado ao hash antigo não pega nada.
    const select = db.select.bind(db);
    vi.spyOn(db, "select").mockImplementationOnce(async (sql, binds) => {
      const rows = await select(sql, binds);
      await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", ["plain:nova-senha", "test-user-rh"]);
      return rows;
    });
    await expect(upgradeLegacyPasswords()).resolves.toBe(0);
    expect((await hashOf(db, "test-user-rh")).password_hash).toBe("plain:nova-senha");
  });
});

describe("seedRoleAccounts", () => {
  it("cada conta tem o próprio sal (hashes diferentes para a mesma senha inicial)", async () => {
    const db = testDb();
    await db.execute("INSERT INTO companies (id, name) VALUES (?, ?)", ["empresa-1", "Empresa"]);
    const created = await seedRoleAccounts("empresa-1", "inicial123", { roles: ["rh", "comercial", "financeiro"] });
    const hashes = await Promise.all(created.map(async (account) => (await hashOf(db, account.userId)).password_hash));
    expect(new Set(hashes).size).toBe(3);
    for (const hash of hashes) await expect(verifyPassword("inicial123", hash)).resolves.toMatchObject({ ok: true });
  });
});
