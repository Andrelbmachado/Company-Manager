// Login rápido no app desktop: cria a empresa e as contas de cada área, mas não semeia mais dados de exemplo
// (Tarefa 10 do redesign: dados de exemplo só pelo modo demonstração, em Configurações).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import type { TestDb } from "@/test/sqlite";
import { hashPassword, login } from "@/lib/auth/login";
import { DEV_AREAS, DISABLED_PASSWORD_HASH, devEmail, ensureDevAccounts } from "./devAccounts";
import { DEV_PASSWORD, devQuickLogin } from "./quickLogin";
import type { Session } from "@/types";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
// Sem o hash de verdade (PBKDF2 lento no Node): o que importa aqui é o que o login rápido grava no banco.
vi.mock("@/lib/auth/login", () => ({
  hashPassword: vi.fn(async (password: string) => `plain:${password}`),
  login: vi.fn(async (email: string) => ({ user: { email } }) as unknown as Session),
}));

const testDb = useTestDb();

async function count(db: TestDb, sql: string): Promise<number> {
  const [row] = await db.select<{ n: number }[]>(sql);
  return row.n;
}

beforeEach(() => {
  vi.mocked(login).mockClear();
  vi.mocked(hashPassword).mockClear();
});

describe("devQuickLogin no desktop", () => {
  it("cria empresa, contas e vínculos de cada área e entra, sem gravar dados de exemplo", async () => {
    const db = testDb();

    await devQuickLogin("ceo");

    expect(login).toHaveBeenCalledWith(devEmail("ceo"), DEV_PASSWORD);
    expect(await count(db, "SELECT count(*) AS n FROM companies")).toBe(1);
    expect(await count(db, "SELECT count(*) AS n FROM users WHERE id LIKE 'dev-user-%'")).toBe(DEV_AREAS.length);
    expect(await count(db, "SELECT count(*) AS n FROM memberships WHERE id LIKE 'dev-member-%'")).toBe(DEV_AREAS.length);
    for (const table of ["customers", "payables", "receivables", "inventory_items", "projects", "employees", "products", "sales_orders", "finance_categories"]) {
      expect(await count(db, `SELECT count(*) AS n FROM ${table}`), table).toBe(0);
    }
    expect(await count(db, "SELECT count(*) AS n FROM settings WHERE key LIKE 'seed.dev%'")).toBe(0);
  });

  it("libera a senha das contas que o modo demonstração criou sem senha", async () => {
    const db = testDb();
    await db.execute("INSERT INTO companies (id, name) VALUES ('empresa-real', 'Empresa Real')");
    await ensureDevAccounts(db, "empresa-real", DISABLED_PASSWORD_HASH);

    await devQuickLogin("financeiro");

    const hashes = await db.select<{ password_hash: string }[]>("SELECT password_hash FROM users WHERE id LIKE 'dev-user-%'");
    expect(hashes).toHaveLength(DEV_AREAS.length);
    expect(hashes.every((row) => row.password_hash === `plain:${DEV_PASSWORD}`)).toBe(true);
    expect(login).toHaveBeenCalledWith(devEmail("financeiro"), DEV_PASSWORD);
  });

  it("não troca a senha de uma conta de exemplo que já tem senha", async () => {
    const db = testDb();
    await db.execute("INSERT INTO companies (id, name) VALUES ('empresa-real', 'Empresa Real')");
    await ensureDevAccounts(db, "empresa-real", "plain:outra-senha");

    await ensureDevAccounts(db, "empresa-real", DISABLED_PASSWORD_HASH);

    const hashes = await db.select<{ password_hash: string }[]>("SELECT DISTINCT password_hash FROM users WHERE id LIKE 'dev-user-%'");
    expect(hashes).toEqual([{ password_hash: "plain:outra-senha" }]);
  });
});
