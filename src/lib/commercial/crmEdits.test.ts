// Gravação das tabelas editáveis do CRM (clientes, contatos, oportunidades, atividades e propostas) em SQLite real:
// só os campos alterados mudam, a permissão é conferida aqui (não só nos botões) e regra de negócio continua valendo.
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { saveProposal, setProposalStatus } from "@/lib/crm/proposals";
import { activityRowFrom, saveActivityRows, saveContactRows, saveCustomerRows, saveOpportunityRows, saveProposalRows } from "./crmEdits";

type Row = Record<string, unknown>;

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

async function setup() {
  db = await createTestDb();
  const { companyId } = await insertTestCompany(db, { roles: ["ceo", "comercial", "atendimento", "auditor"] });
  return { db, companyId, seller: { role: "comercial" as const, userId: "test-user-comercial" } };
}

const one = async (sql: string, binds: unknown[]) => (await db!.select<Row[]>(sql, binds))[0];

describe("saveCustomerRows", () => {
  it("altera só o campo editado e mantém o resto do cadastro", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO customers (id, company_id, name, email, segment, address_json, credit_limit) VALUES (?,?,?,?,?,?,?)", ["c1", companyId, "Clínica Vida", "a@vida.com", "Saúde", '{"cidade":"Sorocaba"}', 500]);
    await saveCustomerRows(db, companyId, seller, { updated: [{ id: "c1", phone: "(15) 99999-0000", credit_limit: 1234.56 }], created: [] });
    expect(await one("SELECT * FROM customers WHERE id=?", ["c1"])).toMatchObject({ name: "Clínica Vida", email: "a@vida.com", segment: "Saúde", phone: "(15) 99999-0000", credit_limit: 1234.56, address_json: '{"cidade":"Sorocaba"}' });
  });

  it("cria cliente com quem cadastra como responsável", async () => {
    const { db, companyId, seller } = await setup();
    const { created } = await saveCustomerRows(db, companyId, seller, { updated: [], created: [{ name: "Pet Amigo", type: "PF" }] });
    expect(created).toHaveLength(1);
    expect(await one("SELECT * FROM customers WHERE id=?", [created[0]])).toMatchObject({ name: "Pet Amigo", type: "PF", status: "active", owner_id: "test-user-comercial", address_json: "{}" });
  });

  it("barra quem não pode editar nem criar clientes, sem gravar nada", async () => {
    const { db, companyId } = await setup();
    await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?,?,?)", ["c1", companyId, "Clínica Vida"]);
    const reader = { role: "atendimento" as const, userId: "test-user-atendimento" };
    await expect(saveCustomerRows(db, companyId, reader, { updated: [{ id: "c1", name: "Outro" }], created: [] })).rejects.toThrow(/permissão/);
    await expect(saveCustomerRows(db, companyId, reader, { updated: [], created: [{ name: "Novo" }] })).rejects.toThrow(/permissão/);
    expect(await one("SELECT name FROM customers WHERE id=?", ["c1"])).toEqual({ name: "Clínica Vida" });
    expect(await db.select("SELECT id FROM customers WHERE company_id=?", [companyId])).toHaveLength(1);
  });

  it("não grava em cliente excluído nem de outra empresa", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO companies (id, name) VALUES (?,?)", ["outra", "Outra"]);
    await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?,?,?)", ["x1", "outra", "De fora"]);
    await db.execute("INSERT INTO customers (id, company_id, name, deleted_at) VALUES (?,?,?,?)", ["c9", companyId, "Excluído", "2026-01-01"]);
    await expect(saveCustomerRows(db, companyId, seller, { updated: [{ id: "x1", name: "Invadido" }], created: [] })).rejects.toThrow(/não encontrado/);
    await expect(saveCustomerRows(db, companyId, seller, { updated: [{ id: "c9", name: "Voltou" }], created: [] })).rejects.toThrow(/não encontrado/);
    expect(await one("SELECT name FROM customers WHERE id=?", ["x1"])).toEqual({ name: "De fora" });
  });

  it("confere todas as linhas antes de gravar: uma inválida não deixa a outra gravada pela metade", async () => {
    const { db, companyId, seller } = await setup();
    await expect(saveCustomerRows(db, companyId, seller, { updated: [], created: [{ name: "Bom" }, { name: "  " }] })).rejects.toThrow(/nome/);
    expect(await db.select("SELECT id FROM customers WHERE company_id=?", [companyId])).toHaveLength(0);
  });
});

describe("saveContactRows", () => {
  it("contato novo de um cliente sem contatos vira o principal; marcar outro troca o principal", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?,?,?)", ["c1", companyId, "Clínica Vida"]);
    const first = await saveContactRows(db, companyId, seller, { updated: [], created: [{ name: "Ana", role: "Gerente" }] }, { customerId: "c1" });
    const second = await saveContactRows(db, companyId, seller, { updated: [], created: [{ name: "Bruno", customer_id: "c1" }] });
    expect(await one("SELECT * FROM contacts WHERE id=?", [first.created[0]])).toMatchObject({ name: "Ana", role: "Gerente", customer_id: "c1", is_primary: 1 });
    await saveContactRows(db, companyId, seller, { updated: [{ id: second.created[0]!, is_primary: 1, email: "BRUNO@vida.com" }], created: [] });
    expect(await one("SELECT is_primary FROM contacts WHERE id=?", [first.created[0]])).toEqual({ is_primary: 0 });
    expect(await one("SELECT is_primary, email FROM contacts WHERE id=?", [second.created[0]])).toEqual({ is_primary: 1, email: "bruno@vida.com" });
  });

  it("desmarcar o principal sem escolher outro é recusado", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO contacts (id, company_id, customer_id, name, is_primary) VALUES (?,?,?,?,?)", ["k1", companyId, null, "Ana", 1]);
    await expect(saveContactRows(db, companyId, seller, { updated: [{ id: "k1", is_primary: 0 }], created: [] })).rejects.toThrow(/principal/);
  });
});

describe("saveOpportunityRows", () => {
  it("trocar a etapa volta para a probabilidade padrão dela; criar começa em Novo com quem cadastra", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO opportunities (id, company_id, title, value, stage, probability, status) VALUES (?,?,?,?,?,?,?)", ["o1", companyId, "Site", 1000, "novo", 10, "open"]);
    await saveOpportunityRows(db, companyId, seller, { updated: [{ id: "o1", stage: "negociacao", value: 2500.5 }], created: [{ title: "Loja virtual", value: 800 }] });
    expect(await one("SELECT * FROM opportunities WHERE id=?", ["o1"])).toMatchObject({ title: "Site", stage: "negociacao", probability: 75, value: 2500.5, status: "open" });
    expect(await one("SELECT * FROM opportunities WHERE title=?", ["Loja virtual"])).toMatchObject({ stage: "novo", probability: 10, owner_id: "test-user-comercial", status: "open" });
  });

  it("não fecha pela tabela: Ganho e Perdido têm fluxo próprio", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO opportunities (id, company_id, title, value, stage, probability, status) VALUES (?,?,?,?,?,?,?)", ["o1", companyId, "Site", 1000, "proposta", 50, "open"]);
    await expect(saveOpportunityRows(db, companyId, seller, { updated: [{ id: "o1", stage: "ganho" }], created: [] })).rejects.toThrow(/Ganhar ou Perder/);
    expect(await one("SELECT stage, status FROM opportunities WHERE id=?", ["o1"])).toEqual({ stage: "proposta", status: "open" });
  });

  it("papel só de consulta não grava", async () => {
    const { db, companyId } = await setup();
    await expect(saveOpportunityRows(db, companyId, { role: "auditor", userId: "test-user-auditor" }, { updated: [], created: [{ title: "X" }] })).rejects.toThrow(/permissão/);
  });
});

describe("saveActivityRows", () => {
  it("cria follow-up com dia e hora, conclui e reabre pela coluna Feita", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?,?,?)", ["c1", companyId, "Clínica Vida"]);
    const { created } = await saveActivityRows(db, companyId, seller, { updated: [], created: [{ kind: "ligacao", subject: "Retornar", due_day: "2026-11-03", due_time: "14:30", done: 0 }] }, { entity: { type: "customer", id: "c1", customerId: "c1" } });
    const saved = await one("SELECT * FROM crm_activities WHERE id=?", [created[0]]);
    expect(saved).toMatchObject({ entity_type: "customer", entity_id: "c1", customer_id: "c1", kind: "ligacao", subject: "Retornar", user_id: "test-user-comercial", done_at: null });
    expect(saved!.due_at).toBe(new Date("2026-11-03T14:30").toISOString());
    const row = activityRowFrom(saved as never);
    expect(row).toMatchObject({ due_day: "2026-11-03", due_time: "14:30", done: 0 });

    await saveActivityRows(db, companyId, seller, { updated: [{ id: created[0]!, done: 1, outcome: "Pediu proposta" }], created: [] });
    expect(await one("SELECT outcome FROM crm_activities WHERE id=?", [created[0]])).toEqual({ outcome: "Pediu proposta" });
    expect((await one("SELECT done_at FROM crm_activities WHERE id=?", [created[0]]))!.done_at).not.toBeNull();
    await saveActivityRows(db, companyId, seller, { updated: [{ id: created[0]!, done: 0, due_time: "09:00" }], created: [] });
    const reopened = await one("SELECT * FROM crm_activities WHERE id=?", [created[0]]);
    expect(reopened).toMatchObject({ done_at: null, due_at: new Date("2026-11-03T09:00").toISOString() });
  });

  it("sem registro fixo, a atividade nova precisa do cliente; hora inválida é recusada", async () => {
    const { db, companyId, seller } = await setup();
    await expect(saveActivityRows(db, companyId, seller, { updated: [], created: [{ kind: "tarefa", subject: "Enviar contrato" }] })).rejects.toThrow(/cliente/);
    await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?,?,?)", ["c1", companyId, "Clínica Vida"]);
    await expect(saveActivityRows(db, companyId, seller, { updated: [], created: [{ kind: "tarefa", subject: "Enviar", customer_id: "c1", due_day: "2026-11-03", due_time: "25h" }] })).rejects.toThrow(/Hora/);
    const ok = await saveActivityRows(db, companyId, seller, { updated: [], created: [{ kind: "tarefa", subject: "Enviar", customer_id: "c1", due_day: "2026-11-03" }] });
    expect((await one("SELECT due_at FROM crm_activities WHERE id=?", [ok.created[0]]))!.due_at).toBe(new Date("2026-11-03T09:00").toISOString());
  });
});

describe("saveProposalRows", () => {
  it("cria rascunho com um item avulso e muda cabeçalho só de rascunho", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO customers (id, company_id, name, payment_terms) VALUES (?,?,?,?)", ["c1", companyId, "Clínica Vida", "30 dias"]);
    const { created } = await saveProposalRows(db, companyId, seller, { updated: [], created: [{ title: "Site institucional", customer_id: "c1", value: 3200 }] });
    expect(await one("SELECT * FROM proposals WHERE id=?", [created[0]])).toMatchObject({ number: 1, status: "rascunho", title: "Site institucional", customer_id: "c1", value: 3200, payment_terms: "30 dias" });
    expect(await one("SELECT description, qty, unit_price FROM proposal_items WHERE proposal_id=?", [created[0]])).toEqual({ description: "Site institucional", qty: 1, unit_price: 3200 });

    await saveProposalRows(db, companyId, seller, { updated: [{ id: created[0]!, valid_until: "2026-12-31" }], created: [] });
    expect(await one("SELECT valid_until, value FROM proposals WHERE id=?", [created[0]])).toEqual({ valid_until: "2026-12-31", value: 3200 });
    await expect(saveProposalRows(db, companyId, seller, { updated: [{ id: created[0]!, value: 10 }], created: [] })).rejects.toThrow(/itens/);
  });

  it("proposta enviada não muda pela tabela", async () => {
    const { db, companyId, seller } = await setup();
    const id = await saveProposal(db, companyId, seller.userId, { title: "Site", items: [{ description: "Site", qty: 1, unit_price: 100 }] });
    await setProposalStatus(db, companyId, id, "send", seller.userId);
    await expect(saveProposalRows(db, companyId, seller, { updated: [{ id, title: "Outro" }], created: [] })).rejects.toThrow(/Revisar/);
  });
});
