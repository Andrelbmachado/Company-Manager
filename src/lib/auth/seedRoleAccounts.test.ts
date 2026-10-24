import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany, TEST_ROLES, type TestDb } from "@/test/sqlite";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
import { createUserAccount } from "./accounts";
import { login, mustChangePassword } from "./login";
import { roleAccountEmail, seedRoleAccounts } from "./seedRoleAccounts";

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

async function newCompany(db: TestDb, id = "empresa-1"): Promise<string> {
  await db.execute("INSERT INTO companies (id, name) VALUES (?, ?)", [id, "Empresa Nova"]);
  return id;
}

interface AccountRow {
  email: string;
  name: string;
  password_hash: string;
  must_change_password: number;
  role: string;
  scope: string;
}

async function accounts(db: TestDb, companyId: string): Promise<AccountRow[]> {
  return db.select<AccountRow[]>(
    "SELECT u.email, u.name, u.password_hash, u.must_change_password, m.role, m.scope FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.company_id = ? ORDER BY u.email",
    [companyId],
  );
}

describe("seedRoleAccounts", () => {
  it("cria uma conta por papel (11), <papel>@empresa.local, com troca de senha obrigatória", async () => {
    const db = testDb();
    const companyId = await newCompany(db);
    const created = await seedRoleAccounts(companyId, "inicial123");

    expect(created).toHaveLength(11);
    expect(created.map((account) => account.role).sort()).toEqual([...TEST_ROLES].sort());
    const rows = await accounts(db, companyId);
    expect(rows).toHaveLength(11);
    for (const role of TEST_ROLES) {
      const row = rows.find((item) => item.role === role);
      expect(row, role).toBeDefined();
      expect(row!.email).toBe(`${role}@empresa.local`);
      expect(row!.name).toBe(ROLE_LABELS[role]);
      expect(row!.must_change_password).toBe(1);
      expect(row!.password_hash.startsWith("plain:")).toBe(false);
      expect(row!.scope).toBe(["ceo", "admin", "gerente"].includes(role) ? "empresa" : "setor");
    }
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("a conta do setor entra com a senha inicial e cai na troca obrigatória", async () => {
    const db = testDb();
    const companyId = await newCompany(db);
    await seedRoleAccounts(companyId, "inicial123");
    const session = await login(roleAccountEmail("financeiro"), "inicial123");
    expect(session.membership.role).toBe("financeiro");
    expect(session.company.id).toBe(companyId);
    expect(mustChangePassword(session)).toBe(true);
  });

  it("não duplica: papel que já tem conta na empresa (o CEO do setup) fica de fora, e rodar de novo não cria nada", async () => {
    const db = testDb();
    const companyId = await newCompany(db);
    await createUserAccount({ companyId, name: "André", email: "andre@minhaempresa.com", password: "senha-do-ceo", role: "ceo" });

    const created = await seedRoleAccounts(companyId, "inicial123");
    expect(created).toHaveLength(10);
    expect(created.some((account) => account.role === "ceo")).toBe(false);
    const ceos = (await accounts(db, companyId)).filter((row) => row.role === "ceo");
    expect(ceos.map((row) => row.email)).toEqual(["andre@minhaempresa.com"]);

    await expect(seedRoleAccounts(companyId, "inicial123")).resolves.toEqual([]);
    expect(await accounts(db, companyId)).toHaveLength(11);
  });

  it("usa outro domínio e pula e-mail que já pertence a alguém", async () => {
    const db = testDb();
    const companyId = await newCompany(db);
    await insertTestCompany(db, { companyId: "outra", roles: ["comercial"] });
    await db.execute("UPDATE users SET email = ? WHERE id = ?", ["comercial@loja.com.br", "test-user-comercial"]);

    const created = await seedRoleAccounts(companyId, "inicial123", { domain: "Loja.com.br", roles: ["comercial", "rh"] });
    expect(created.map((account) => account.email)).toEqual(["rh@loja.com.br"]);
  });

  it("recusa senha inicial curta e domínio inválido", async () => {
    const db = testDb();
    const companyId = await newCompany(db);
    await expect(seedRoleAccounts(companyId, "123")).rejects.toThrow("pelo menos 6 caracteres");
    await expect(seedRoleAccounts(companyId, "inicial123", { domain: "sem ponto" })).rejects.toThrow("Domínio");
    expect(await accounts(db, companyId)).toHaveLength(0);
  });
});

describe("createUserAccount", () => {
  it("grava o e-mail em minúsculas, o hash (nunca a senha) e o papel", async () => {
    const db = testDb();
    const companyId = await newCompany(db);
    const { userId } = await createUserAccount({ companyId, name: "  Camila  ", email: " Camila@Empresa.COM ", password: "senha-forte", role: "comercial", mustChangePassword: true });
    const [row] = await accounts(db, companyId);
    expect(row).toMatchObject({ email: "camila@empresa.com", name: "Camila", role: "comercial", scope: "setor", must_change_password: 1 });
    expect(row.password_hash).not.toContain("senha-forte");
    expect(userId).toBeTruthy();
  });

  it("recusa e-mail repetido (sem diferença de caixa), e-mail inválido, nome vazio e senha curta", async () => {
    const db = testDb();
    const companyId = await newCompany(db);
    await createUserAccount({ companyId, name: "Camila", email: "camila@empresa.com", password: "senha-forte", role: "comercial" });
    await expect(createUserAccount({ companyId, name: "Outra", email: "CAMILA@empresa.com", password: "senha-forte", role: "rh" })).rejects.toThrow("Já existe uma conta com este e-mail.");
    await expect(createUserAccount({ companyId, name: "Outra", email: "camila", password: "senha-forte", role: "rh" })).rejects.toThrow("E-mail inválido");
    await expect(createUserAccount({ companyId, name: "  ", email: "x@empresa.com", password: "senha-forte", role: "rh" })).rejects.toThrow("nome");
    await expect(createUserAccount({ companyId, name: "Outra", email: "x@empresa.com", password: "123", role: "rh" })).rejects.toThrow("pelo menos 6 caracteres");
    expect(await accounts(db, companyId)).toHaveLength(1);
  });
});
