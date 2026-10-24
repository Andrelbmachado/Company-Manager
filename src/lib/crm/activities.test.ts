// Atividades de CRM (linha do tempo e follow-ups): SQLite real.
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { activityState, completeActivity, createActivity, deleteActivity, fetchActivities, fetchOverdueFollowUps, reopenActivity, updateActivity } from "./activities";

type Row = Record<string, unknown>;

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

async function setup() {
  db = await createTestDb();
  const { companyId, userIds } = await insertTestCompany(db, { roles: ["ceo", "comercial", "atendimento"] });
  await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?,?,?)", ["cust-1", companyId, "Clínica Vida"]);
  await db.execute("INSERT INTO contacts (id, company_id, customer_id, name) VALUES (?,?,?,?)", ["ct-1", companyId, "cust-1", "Ana"]);
  await db.execute("INSERT INTO opportunities (id, company_id, customer_id, title) VALUES (?,?,?,?)", ["opp-1", companyId, "cust-1", "Site"]);
  return { db, companyId, seller: userIds.comercial!, service: userIds.atendimento! };
}

const NOW = new Date("2026-10-24T15:00:00.000Z");

describe("createActivity", () => {
  it("liga ao cliente da oportunidade ou do contato e usa o autor como responsável por padrão", async () => {
    const { db, companyId, seller } = await setup();
    const a = await createActivity(db, companyId, seller, { entity_type: "opportunity", entity_id: "opp-1", kind: "ligacao", subject: "Retornar", due_at: "2026-10-25T13:00:00.000Z" });
    const b = await createActivity(db, companyId, seller, { entity_type: "contact", entity_id: "ct-1", kind: "email", subject: "Mandar catálogo" });
    const rows = await db.select<Row[]>("SELECT * FROM crm_activities ORDER BY subject");
    expect(rows.find((row) => row.id === a)).toMatchObject({ customer_id: "cust-1", contact_id: null, user_id: seller, created_by: seller, done_at: null });
    expect(rows.find((row) => row.id === b)).toMatchObject({ customer_id: "cust-1", contact_id: "ct-1" });
  });

  it("nota nasce feita; assunto e corpo vazios são recusados", async () => {
    const { db, companyId, seller } = await setup();
    const id = await createActivity(db, companyId, seller, { entity_type: "customer", entity_id: "cust-1", kind: "nota", body: "Prefere WhatsApp." });
    const [row] = await db.select<Row[]>("SELECT * FROM crm_activities WHERE id=?", [id]);
    expect(row.customer_id).toBe("cust-1");
    expect(row.done_at).toBeTruthy();
    await expect(createActivity(db, companyId, seller, { entity_type: "customer", entity_id: "cust-1", kind: "tarefa", subject: " ", body: "" })).rejects.toThrow(/assunto/i);
  });
});

describe("ciclo de vida e consultas", () => {
  it("concluir com resultado, reabrir, editar e excluir (soft delete)", async () => {
    const { db, companyId, seller, service } = await setup();
    const id = await createActivity(db, companyId, seller, { entity_type: "customer", entity_id: "cust-1", kind: "tarefa", subject: "Conferir CNPJ", due_at: "2026-10-20T12:00:00.000Z" });

    await completeActivity(db, companyId, id, "Conferido");
    let [row] = await db.select<Row[]>("SELECT * FROM crm_activities WHERE id=?", [id]);
    expect(row.outcome).toBe("Conferido");
    expect(row.done_at).toBeTruthy();

    await reopenActivity(db, companyId, id);
    [row] = await db.select<Row[]>("SELECT * FROM crm_activities WHERE id=?", [id]);
    expect(row.done_at).toBeNull();

    await updateActivity(db, companyId, id, { subject: "Conferir CNPJ e endereço", user_id: service, due_at: "2026-10-30T12:00:00.000Z", kind: "ligacao", body: null });
    [row] = await db.select<Row[]>("SELECT * FROM crm_activities WHERE id=?", [id]);
    expect(row).toMatchObject({ subject: "Conferir CNPJ e endereço", user_id: service, kind: "ligacao", due_at: "2026-10-30T12:00:00.000Z" });

    await deleteActivity(db, companyId, id);
    expect(await fetchActivities(db, companyId, { customerId: "cust-1" })).toEqual([]);
  });

  it("linha do tempo do cliente traz as atividades das oportunidades dele, mais recentes primeiro", async () => {
    const { db, companyId, seller } = await setup();
    await createActivity(db, companyId, seller, { entity_type: "customer", entity_id: "cust-1", kind: "nota", body: "Primeira" });
    await createActivity(db, companyId, seller, { entity_type: "opportunity", entity_id: "opp-1", kind: "reuniao", subject: "Visita" });
    const timeline = await fetchActivities(db, companyId, { customerId: "cust-1" });
    expect(timeline).toHaveLength(2);
    const onlyOpp = await fetchActivities(db, companyId, { entityType: "opportunity", entityId: "opp-1" });
    expect(onlyOpp.map((row) => row.subject)).toEqual(["Visita"]);
  });

  it("follow-ups atrasados: pendentes com prazo no passado, do responsável (ou de todos), mais antigos primeiro", async () => {
    const { db, companyId, seller, service } = await setup();
    await createActivity(db, companyId, seller, { entity_type: "customer", entity_id: "cust-1", kind: "ligacao", subject: "Atrasada 2", due_at: "2026-10-23T12:00:00.000Z" });
    await createActivity(db, companyId, seller, { entity_type: "customer", entity_id: "cust-1", kind: "ligacao", subject: "Atrasada 1", due_at: "2026-10-20T12:00:00.000Z" });
    await createActivity(db, companyId, seller, { entity_type: "customer", entity_id: "cust-1", kind: "tarefa", subject: "Futura", due_at: "2026-10-30T12:00:00.000Z" });
    await createActivity(db, companyId, service, { entity_type: "customer", entity_id: "cust-1", kind: "tarefa", subject: "Do atendimento", due_at: "2026-10-21T12:00:00.000Z" });
    const done = await createActivity(db, companyId, seller, { entity_type: "customer", entity_id: "cust-1", kind: "tarefa", subject: "Feita", due_at: "2026-10-19T12:00:00.000Z" });
    await completeActivity(db, companyId, done, null);

    expect((await fetchOverdueFollowUps(db, companyId, seller, NOW)).map((row) => row.subject)).toEqual(["Atrasada 1", "Atrasada 2"]);
    expect((await fetchOverdueFollowUps(db, companyId, null, NOW)).map((row) => row.subject)).toEqual(["Atrasada 1", "Do atendimento", "Atrasada 2"]);
  });
});

describe("activityState", () => {
  it("feita, atrasada, hoje (dia local) ou pendente", () => {
    const local = new Date(2026, 9, 24, 10, 0);
    const todayLater = new Date(2026, 9, 24, 18, 0).toISOString();
    const yesterday = new Date(2026, 9, 23, 18, 0).toISOString();
    const earlierToday = new Date(2026, 9, 24, 8, 0).toISOString();
    const tomorrow = new Date(2026, 9, 25, 9, 0).toISOString();
    expect(activityState({ done_at: "2026-10-01T00:00:00Z", due_at: yesterday }, local)).toBe("feita");
    expect(activityState({ done_at: null, due_at: yesterday }, local)).toBe("atrasada");
    expect(activityState({ done_at: null, due_at: earlierToday }, local)).toBe("atrasada");
    expect(activityState({ done_at: null, due_at: todayLater }, local)).toBe("hoje");
    expect(activityState({ done_at: null, due_at: tomorrow }, local)).toBe("pendente");
    expect(activityState({ done_at: null, due_at: null }, local)).toBe("pendente");
  });
});
