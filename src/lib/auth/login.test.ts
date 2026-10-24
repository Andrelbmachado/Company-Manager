import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { verifyPassword } from "./hash";
import { login, mustChangePassword, revalidateSession } from "./login";
import { changePassword, resetUserPassword, setPasswordChangeRequired } from "./password";
import { getSession } from "./session";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();

// A sessão vive no sessionStorage do webview; no Node, um armazenamento em memória faz o papel.
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
});

interface UserRow {
  password_hash: string;
  must_change_password: number;
  password_changed_at: string | null;
}

async function userRow(db: TestDb, id: string): Promise<UserRow> {
  const [row] = await db.select<UserRow[]>("SELECT password_hash, must_change_password, password_changed_at FROM users WHERE id = ?", [id]);
  return row;
}

describe("verifyPassword (contrato do plano)", () => {
  it("plain: confere e pede rehash; senha errada não", async () => {
    await expect(verifyPassword("x", "plain:x")).resolves.toEqual({ ok: true, needsRehash: true });
    expect((await verifyPassword("y", "plain:x")).ok).toBe(false);
  });
});

describe("login", () => {
  it("conta legada plain: entra e o hash vira PBKDF2 sem a pessoa perceber", async () => {
    const db = testDb();
    await insertTestCompany(db, { roles: ["financeiro"] });
    expect((await userRow(db, "test-user-financeiro")).password_hash).toBe("plain:teste");

    const session = await login("financeiro@teste.local", "teste");
    expect(session.membership.role).toBe("financeiro");
    expect(getSession()?.user.id).toBe("test-user-financeiro");
    expect(JSON.stringify(session)).not.toContain("password_hash");

    const migrated = await userRow(db, "test-user-financeiro");
    expect(migrated.password_hash.startsWith("pbkdf2$")).toBe(true);
    expect(migrated.password_changed_at).toBeNull();

    // Com o hash novo: a mesma senha continua entrando, e não há novo rehash.
    await login("FINANCEIRO@teste.local", "teste");
    expect((await userRow(db, "test-user-financeiro")).password_hash).toBe(migrated.password_hash);
    await expect(login("financeiro@teste.local", "errada")).rejects.toThrow("Credenciais inválidas");
  });

  it("e-mail inexistente ou senha errada dão a mesma mensagem", async () => {
    const db = testDb();
    await insertTestCompany(db, { roles: ["comercial"] });
    await expect(login("ninguem@teste.local", "teste")).rejects.toThrow("Credenciais inválidas");
    await expect(login("comercial@teste.local", "")).rejects.toThrow("Credenciais inválidas");
    expect((await userRow(db, "test-user-comercial")).password_hash).toBe("plain:teste");
  });

  it("se a gravação do hash novo falhar, a pessoa entra assim mesmo (rehash fica para o próximo login)", async () => {
    const db = testDb();
    await insertTestCompany(db, { roles: ["rh"] });
    await db.execute("CREATE TRIGGER bloqueia_hash BEFORE UPDATE OF password_hash ON users BEGIN SELECT RAISE(ABORT, 'disco cheio'); END");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const session = await login("rh@teste.local", "teste");
    expect(session.membership.role).toBe("rh");
    expect((await userRow(db, "test-user-rh")).password_hash).toBe("plain:teste");
    warn.mockRestore();
  });

  it("conta suspensa não entra", async () => {
    const db = testDb();
    await insertTestCompany(db, { roles: ["estoquista"] });
    await db.execute("UPDATE users SET status = 'suspended' WHERE id = ?", ["test-user-estoquista"]);
    await expect(login("estoquista@teste.local", "teste")).rejects.toThrow(/suspensa/);
  });

  it("troca de senha obrigatória vai na sessão", async () => {
    const db = testDb();
    await insertTestCompany(db, { roles: ["comercial"] });
    expect(mustChangePassword(await login("comercial@teste.local", "teste"))).toBe(false);
    await setPasswordChangeRequired("test-user-comercial", true);
    const session = await login("comercial@teste.local", "teste");
    expect(mustChangePassword(session)).toBe(true);
  });
});

describe("revalidateSession", () => {
  it("passa a exigir a troca de senha sem sair e entrar (CEO forçou a troca com a sessão aberta)", async () => {
    const db = testDb();
    await insertTestCompany(db, { roles: ["atendimento"] });
    const session = await login("atendimento@teste.local", "teste");
    await expect(revalidateSession(session)).resolves.toBe(session);

    await setPasswordChangeRequired("test-user-atendimento", true);
    const next = await revalidateSession(session);
    expect(next).not.toBeNull();
    expect(mustChangePassword(next!)).toBe(true);
    expect(next!.membership.role).toBe("atendimento");
    expect(getSession()?.user.must_change_password).toBe(1);
  });

  it("papel trocado e conta removida continuam valendo", async () => {
    const db = testDb();
    await insertTestCompany(db, { roles: ["produtos"] });
    const session = await login("produtos@teste.local", "teste");
    await db.execute("UPDATE memberships SET role = 'auditor' WHERE user_id = ?", ["test-user-produtos"]);
    expect((await revalidateSession(session))?.membership.role).toBe("auditor");
    await db.execute("UPDATE users SET deleted_at = datetime('now') WHERE id = ?", ["test-user-produtos"]);
    await expect(revalidateSession(session)).resolves.toBeNull();
  });
});

describe("changePassword", () => {
  it("troca a própria senha conferindo a atual; a antiga deixa de entrar", async () => {
    const db = testDb();
    await insertTestCompany(db, { roles: ["gerente"] });
    await expect(changePassword("test-user-gerente", "nova-senha-1", { currentPassword: "errada" })).rejects.toThrow("A senha atual não confere.");
    await changePassword("test-user-gerente", "nova-senha-1", { currentPassword: "teste" });

    const row = await userRow(db, "test-user-gerente");
    expect(row.password_hash.startsWith("pbkdf2$")).toBe(true);
    expect(row.password_changed_at).not.toBeNull();
    await expect(login("gerente@teste.local", "teste")).rejects.toThrow("Credenciais inválidas");
    await expect(login("gerente@teste.local", "nova-senha-1")).resolves.toMatchObject({ membership: { role: "gerente" } });
  });

  it("troca obrigatória: grava a senha nova e libera o acesso", async () => {
    const db = testDb();
    await insertTestCompany(db, { roles: ["tecnico"] });
    await setPasswordChangeRequired("test-user-tecnico", true);
    await changePassword("test-user-tecnico", "minha-senha-nova");
    expect((await userRow(db, "test-user-tecnico")).must_change_password).toBe(0);
    expect(mustChangePassword(await login("tecnico@teste.local", "minha-senha-nova"))).toBe(false);
  });

  it("recusa senha curta, igual à atual ou de conta inexistente", async () => {
    const db = testDb();
    await insertTestCompany(db, { roles: ["auditor"] });
    await expect(changePassword("test-user-auditor", "123")).rejects.toThrow("pelo menos 6 caracteres");
    await expect(changePassword("test-user-auditor", "      ")).rejects.toThrow("só espaços");
    await expect(changePassword("nao-existe", "senha-nova-1")).rejects.toThrow("Conta não encontrada");
    expect((await userRow(db, "test-user-auditor")).password_hash).toBe("plain:teste");

    await resetUserPassword("test-user-auditor", "senha-atual-1", { mustChange: true });
    await expect(changePassword("test-user-auditor", "senha-atual-1")).rejects.toThrow("diferente da atual");
    expect((await userRow(db, "test-user-auditor")).must_change_password).toBe(1);
  });
});

describe("migration 0010_auth_hash", () => {
  it("contas de antes da migration ganham must_change_password = 0 e o hash legado continua", async () => {
    const old = await createTestDb({ upTo: 7 });
    try {
      await insertTestCompany(old, { roles: ["ceo"] });
      await old.migrate();
      expect(await userRow(old, "test-user-ceo")).toEqual({ password_hash: "plain:teste", must_change_password: 0, password_changed_at: null });
    } finally {
      old.close();
    }
  });
});

describe("resetUserPassword e setPasswordChangeRequired", () => {
  it("redefinição pelo CEO/Administração pede troca no próximo acesso (padrão)", async () => {
    const db = testDb();
    await insertTestCompany(db, { roles: ["financeiro"] });
    await resetUserPassword("test-user-financeiro", "temporaria1");
    const row = await userRow(db, "test-user-financeiro");
    expect(row.must_change_password).toBe(1);
    expect(row.password_hash.startsWith("pbkdf2$")).toBe(true);
    const session = await login("financeiro@teste.local", "temporaria1");
    expect(mustChangePassword(session)).toBe(true);
  });

  it("redefinição sem troca obrigatória e dispensa da troca", async () => {
    const db = testDb();
    await insertTestCompany(db, { roles: ["rh"] });
    await resetUserPassword("test-user-rh", "definitiva1", { mustChange: false });
    expect((await userRow(db, "test-user-rh")).must_change_password).toBe(0);
    await setPasswordChangeRequired("test-user-rh", true);
    expect((await userRow(db, "test-user-rh")).must_change_password).toBe(1);
    await setPasswordChangeRequired("test-user-rh", false);
    expect((await userRow(db, "test-user-rh")).must_change_password).toBe(0);
    await expect(resetUserPassword("test-user-rh", "curta")).rejects.toThrow("pelo menos 6 caracteres");
  });
});
