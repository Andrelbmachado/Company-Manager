// Contas editadas na tabela de Configurações: regras de CEO/Administração conferidas na camada de dados. SQLite real.
import { describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { verifyPassword } from "@/lib/auth/hash";
import { generateTemporaryPassword, listUsersAccess, resetAccountPassword, saveUserAccessChanges } from "./usersAccess";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const C = "test-company";
const testDb = useTestDb();
const ceo = { role: "ceo" as const, userId: "test-user-ceo" };
const admin = { role: "admin" as const, userId: "test-user-admin" };

const row = async (userId: string) => (await listUsersAccess(C)).find((item) => item.id === userId);

describe("contas da empresa na tabela", () => {
  it("cria conta com senha temporária gerada e troca obrigatória no primeiro acesso", async () => {
    await insertTestCompany(testDb());
    const { created } = await saveUserAccessChanges(C, admin, { created: [{ name: " Ana Souza ", email: "Ana@Empresa.com", role: "financeiro" }], updated: [] });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: "Ana Souza", email: "ana@empresa.com", mustChange: true });
    expect(created[0].password.length).toBeGreaterThanOrEqual(10);
    const account = await row(created[0].userId);
    expect(account).toMatchObject({ role: "financeiro", must_change_password: 1 });
    const [stored] = await testDb().select<{ password_hash: string }[]>("SELECT password_hash FROM users WHERE id=?", [created[0].userId]);
    expect(stored.password_hash).not.toContain(created[0].password);
    expect((await verifyPassword(created[0].password, stored.password_hash)).ok).toBe(true);
  });

  it("altera nome, e-mail, papel e a troca de senha de outra pessoa", async () => {
    await insertTestCompany(testDb());
    await saveUserAccessChanges(C, admin, { created: [], updated: [{ id: "test-user-comercial", name: "Carla Vendas", email: "carla@empresa.com", role: "gerente", must_change_password: 1 }] });
    expect(await row("test-user-comercial")).toMatchObject({ name: "Carla Vendas", email: "carla@empresa.com", role: "gerente", must_change_password: 1 });
    const [membership] = await testDb().select<{ scope: string }[]>("SELECT scope FROM memberships WHERE user_id=? AND company_id=?", ["test-user-comercial", C]);
    expect(membership.scope).toBe("empresa");
    await saveUserAccessChanges(C, admin, { created: [], updated: [{ id: "test-user-comercial", must_change_password: 0 }] });
    expect((await row("test-user-comercial"))?.must_change_password).toBe(0);
  });

  it("só o CEO mexe em conta de CEO ou concede o papel; ninguém muda o próprio papel", async () => {
    await insertTestCompany(testDb());
    await expect(saveUserAccessChanges(C, admin, { created: [], updated: [{ id: "test-user-ceo", name: "Outro" }] })).rejects.toThrow(/CEO/);
    await expect(saveUserAccessChanges(C, admin, { created: [], updated: [{ id: "test-user-comercial", role: "ceo" }] })).rejects.toThrow(/CEO/);
    await expect(saveUserAccessChanges(C, admin, { created: [{ name: "Novo", email: "novo@empresa.com", role: "ceo" }], updated: [] })).rejects.toThrow(/CEO/);
    await expect(saveUserAccessChanges(C, admin, { created: [], updated: [{ id: "test-user-admin", role: "comercial" }] })).rejects.toThrow(/próprio papel/);
    await expect(saveUserAccessChanges(C, admin, { created: [], updated: [{ id: "test-user-admin", must_change_password: 1 }] })).rejects.toThrow(/própria senha/);
    await saveUserAccessChanges(C, ceo, { created: [], updated: [{ id: "test-user-admin", role: "gerente" }] });
    expect((await row("test-user-admin"))?.role).toBe("gerente");
    expect((await row("test-user-ceo"))?.name).toBe("Teste ceo");
  });

  it("sem permissão de usuários não cria nem altera; e-mail repetido ou inválido é recusado", async () => {
    await insertTestCompany(testDb());
    await expect(saveUserAccessChanges(C, { role: "gerente", userId: "test-user-gerente" }, { created: [{ name: "X", email: "x@empresa.com" }], updated: [] })).rejects.toThrow(/permissão/);
    await expect(saveUserAccessChanges(C, { role: "rh", userId: "test-user-rh" }, { created: [], updated: [{ id: "test-user-comercial", name: "Y" }] })).rejects.toThrow(/permissão/);
    await expect(saveUserAccessChanges(C, admin, { created: [], updated: [{ id: "test-user-comercial", email: "financeiro@teste.local" }] })).rejects.toThrow(/Já existe/);
    await expect(saveUserAccessChanges(C, admin, { created: [{ name: "Z", email: "sem-arroba" }], updated: [] })).rejects.toThrow(/E-mail inválido/);
    await expect(saveUserAccessChanges(C, admin, { created: [], updated: [{ id: "nao-existe", name: "W" }] })).rejects.toThrow(/não encontrada/);
  });

  it("linha nova com e-mail inválido, repetido ou já usado não cria nenhuma conta do lote (senha que ninguém veria)", async () => {
    await insertTestCompany(testDb());
    const accounts = async () => (await testDb().select<{ n: number }[]>("SELECT COUNT(*) AS n FROM users"))[0].n;
    const before = await accounts();
    const ana = { name: "Ana", email: "ana@empresa.com" };
    await expect(saveUserAccessChanges(C, admin, { created: [ana, { name: "Bia", email: "sem-arroba" }], updated: [] })).rejects.toThrow(/E-mail inválido/);
    await expect(saveUserAccessChanges(C, admin, { created: [ana, { name: "Ana Souza", email: " ANA@empresa.com" }], updated: [] })).rejects.toThrow(/ana@empresa.com está em mais de uma linha/);
    await expect(saveUserAccessChanges(C, admin, { created: [ana, { name: "Outra", email: "financeiro@teste.local" }], updated: [] })).rejects.toThrow(/financeiro@teste.local: Já existe/);
    await expect(saveUserAccessChanges(C, admin, { created: [ana], updated: [{ id: "test-user-comercial", email: "ana@empresa.com" }] })).rejects.toThrow(/mais de uma linha/);
    expect(await accounts()).toBe(before);
    expect((await row("test-user-comercial"))?.email).not.toBe("ana@empresa.com");
  });

  it("redefine a senha de outra pessoa (com troca) e a própria (sem troca)", async () => {
    await insertTestCompany(testDb());
    expect(await resetAccountPassword(C, admin, "test-user-comercial", "nova-senha-1", true)).toMatchObject({ mustChange: true, self: false });
    expect((await row("test-user-comercial"))?.must_change_password).toBe(1);
    expect(await resetAccountPassword(C, admin, "test-user-admin", "nova-senha-2", true)).toMatchObject({ mustChange: false, self: true });
    await expect(resetAccountPassword(C, admin, "test-user-ceo", "nova-senha-3", true)).rejects.toThrow(/CEO/);
    await expect(resetAccountPassword(C, { role: "comercial", userId: "test-user-comercial" }, "test-user-rh", "nova-senha-4", true)).rejects.toThrow(/permissão/);
  });

  it("senha temporária usa só caracteres fáceis de ditar", () => {
    const password = generateTemporaryPassword();
    expect(password).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{10}$/);
    expect(generateTemporaryPassword()).not.toBe(password);
  });
});
