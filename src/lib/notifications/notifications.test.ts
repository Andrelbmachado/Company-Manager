// Notificações do menu da conta: comunicados do RH, decisões de solicitação e pendências novas. SQLite real.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { listNotifications, markRead, notifyAnnouncement, notifyEmployees, notifyUsers, unreadCount } from "./notifications";

const C = "test-company";
let db: TestDb;
let users: Record<string, string>;

beforeEach(async () => {
  db = await createTestDb();
  users = (await insertTestCompany(db, { companyId: C, roles: ["ceo", "rh", "tecnico"] })).userIds as Record<string, string>;
});
afterEach(() => db.close());

const count = async (sql: string, binds: unknown[] = []) => (await db.select<{ n: number }[]>(sql, binds))[0].n;

describe("notificações", () => {
  it("comunicado notifica todas as contas ativas da empresa, com link para o Meu RH", async () => {
    await notifyAnnouncement(db, C, { id: "a1", title: "Feriado municipal", body: "Sem expediente na sexta.", important: 0 });

    for (const userId of Object.values(users)) {
      const [item] = await listNotifications(db, C, userId);
      expect(item).toMatchObject({ title: "Feriado municipal", message: "Sem expediente na sexta.", link: "/hr", is_read: 0, important: 0, ref_type: "hr_announcement", ref_id: "a1" });
    }
    expect(await count("SELECT count(*) AS n FROM email_outbox")).toBe(0);
  });

  it("comunicado importante põe um e-mail na fila para cada conta com e-mail", async () => {
    await db.execute("UPDATE users SET email = '' WHERE id = ?", [users.tecnico]);

    await notifyAnnouncement(db, C, { id: "a2", title: "Mudança no plano de saúde", body: "Leia até sexta.", important: 1 });

    const outbox = await db.select<{ to_email: string; subject: string; status: string }[]>("SELECT to_email, subject, status FROM email_outbox ORDER BY to_email");
    expect(outbox.map((row) => row.to_email)).toEqual(["ceo@teste.local", "rh@teste.local"].sort());
    expect(outbox.every((row) => row.subject === "Mudança no plano de saúde" && row.status === "pendente")).toBe(true);
  });

  it("notifica o colaborador pela conta ligada ao cadastro e ignora quem não tem conta", async () => {
    await db.execute("INSERT INTO employees (id, company_id, user_id, name, status) VALUES ('e1', ?, ?, 'Técnico', 'ativo')", [C, users.tecnico]);
    await db.execute("INSERT INTO employees (id, company_id, user_id, name, status) VALUES ('e2', ?, NULL, 'Sem conta', 'ativo')", [C]);

    const ids = await notifyEmployees(db, C, ["e1", "e2"], { type: "hr_task", title: "Nova pendência do RH", message: "Enviar exame periódico" });

    expect(ids).toHaveLength(1);
    expect((await listNotifications(db, C, users.tecnico))[0]).toMatchObject({ title: "Nova pendência do RH", link: "/hr" });
  });

  it("marcar como lida zera o contador só da pessoa", async () => {
    await notifyUsers(db, C, { userIds: [users.ceo, users.rh], type: "teste", title: "Um", message: "1" });
    await notifyUsers(db, C, { userIds: [users.ceo], type: "teste", title: "Dois", message: "2" });
    expect(await unreadCount(db, C, users.ceo)).toBe(2);

    const [first] = await listNotifications(db, C, users.ceo);
    await markRead(db, C, users.ceo, first.id);
    expect(await unreadCount(db, C, users.ceo)).toBe(1);
    await markRead(db, C, users.ceo);
    expect(await unreadCount(db, C, users.ceo)).toBe(0);
    expect(await unreadCount(db, C, users.rh)).toBe(1);
  });
});
