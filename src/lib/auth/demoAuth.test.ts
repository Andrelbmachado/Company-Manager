// Os mesmos fluxos de conta no banco demo do navegador (lib/db/demo.ts), que emula SQL por padrões de texto:
// garante que o SQL de login, contas e senha cabe nos padrões que o demo entende.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", async () => {
  const { getDemoDb } = await import("@/lib/db/demo");
  return { getDb: async () => getDemoDb(), isTauriRuntime: () => false };
});

beforeAll(() => {
  for (const name of ["localStorage", "sessionStorage"]) {
    const data = new Map<string, string>();
    vi.stubGlobal(name, {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    });
  }
});

describe("contas e senhas no banco demo", () => {
  it("login, rehash, conta nova com troca obrigatória, contas por setor, troca e redefinição de senha", async () => {
    const { getDemoDb, DEMO_ACCOUNTS } = await import("@/lib/db/demo");
    const { login, mustChangePassword, revalidateSession } = await import("./login");
    const { createUserAccount } = await import("./accounts");
    const { changePassword, resetUserPassword, setPasswordChangeRequired } = await import("./password");
    const { seedRoleAccounts } = await import("./seedRoleAccounts");
    const db = getDemoDb();
    const hashOf = async (email: string) =>
      (await db.select<{ id: string; password_hash: string; must_change_password?: number }[]>("SELECT * FROM users WHERE lower(email) = ? AND deleted_at IS NULL LIMIT 1", [email]))[0];

    const ceo = DEMO_ACCOUNTS.find((account) => account.role === "ceo")!;
    expect((await hashOf(ceo.email)).password_hash).toBe(`plain:${ceo.password}`);
    const session = await login(ceo.email, ceo.password);
    expect(session.membership.role).toBe("ceo");
    expect((await hashOf(ceo.email)).password_hash.startsWith("pbkdf2$")).toBe(true);
    await expect(login(ceo.email, ceo.password)).resolves.toMatchObject({ membership: { role: "ceo" } });
    await expect(login(ceo.email, "errada")).rejects.toThrow("Credenciais inválidas");

    const created = await createUserAccount({ companyId: session.company.id, name: "Nova Pessoa", email: "Nova@TechFlow.com", password: "inicial123", role: "comercial", mustChangePassword: true });
    expect(created.email).toBe("nova@techflow.com");
    const first = await login("nova@techflow.com", "inicial123");
    expect(first.membership.role).toBe("comercial");
    expect(mustChangePassword(first)).toBe(true);
    await changePassword(created.userId, "minha-senha-1");
    expect(mustChangePassword(await login("nova@techflow.com", "minha-senha-1"))).toBe(false);

    await setPasswordChangeRequired(created.userId, true);
    const forced = await revalidateSession(first);
    expect(forced && mustChangePassword(forced)).toBe(true);
    await resetUserPassword(created.userId, "temporaria1", { mustChange: false });
    expect(mustChangePassword(await login("nova@techflow.com", "temporaria1"))).toBe(false);

    // Na empresa demo todo papel já tem conta: nada é criado. Numa empresa nova, uma conta por papel pedido.
    await expect(seedRoleAccounts(session.company.id, "setores123", { domain: "demo.local" })).resolves.toEqual([]);
    await db.execute("INSERT INTO companies (id, name, document) VALUES (?, ?, ?)", ["demo-nova", "Empresa Nova", null]);
    const sectors = await seedRoleAccounts("demo-nova", "setores123", { domain: "demo.local", roles: ["rh", "auditor"] });
    expect(sectors.map((account) => account.email)).toEqual(["rh@demo.local", "auditor@demo.local"]);
    const rh = await login("rh@demo.local", "setores123");
    expect(rh.membership).toMatchObject({ role: "rh", scope: "setor", company_id: "demo-nova" });
    expect(mustChangePassword(rh)).toBe(true);
    await expect(seedRoleAccounts("demo-nova", "setores123", { domain: "demo.local", roles: ["rh", "auditor"] })).resolves.toEqual([]);
  });
});
