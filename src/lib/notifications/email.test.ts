// Fila de e-mails das notificações importantes: agrupa por assunto num mailto com os destinatários em Cco.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { buildMailto, discardEmails, markEmailsSent, pendingEmailGroups } from "./email";
import { notifyUsers } from "./notifications";

const C = "test-company";
let db: TestDb;
let users: Record<string, string>;

beforeEach(async () => {
  db = await createTestDb();
  users = (await insertTestCompany(db, { companyId: C, roles: ["ceo", "rh", "tecnico"] })).userIds as Record<string, string>;
});
afterEach(() => db.close());

describe("fila de e-mail", () => {
  it("agrupa os pendentes do mesmo aviso num mailto com Cco e marca enviados", async () => {
    await notifyUsers(db, C, { userIds: Object.values(users), type: "x", title: "Plano de saúde", message: "Confirme os dependentes & assine.", important: true });
    await notifyUsers(db, C, { userIds: [users.ceo], type: "x", title: "Treinamento", message: "Até sexta", important: true });

    const groups = await pendingEmailGroups(db, C);
    expect(groups.map((group) => group.subject).sort()).toEqual(["Plano de saúde", "Treinamento"]);
    const plano = groups.find((group) => group.subject === "Plano de saúde")!;
    expect(plano.recipients).toHaveLength(3);

    const href = buildMailto(plano);
    expect(href.startsWith("mailto:?bcc=")).toBe(true);
    expect(href).toContain(encodeURIComponent("rh@teste.local"));
    expect(href).toContain(`subject=${encodeURIComponent("Plano de saúde")}`);
    expect(href).toContain(`body=${encodeURIComponent("Confirme os dependentes & assine.")}`);

    await markEmailsSent(db, C, plano.ids);
    expect((await pendingEmailGroups(db, C)).map((group) => group.subject)).toEqual(["Treinamento"]);
    await discardEmails(db, C, (await pendingEmailGroups(db, C))[0].ids);
    expect(await pendingEmailGroups(db, C)).toEqual([]);
  });
});
