// Consultas e gravações do CRM: clientes, contatos, oportunidades, funil e resumo financeiro (SQLite real).
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import {
  customerFinance,
  deleteContact,
  fetchCompanyUsers,
  fetchContacts,
  fetchCustomers,
  fetchOpportunities,
  pipelineSummary,
  saveContact,
  saveCustomer,
  saveOpportunity,
  setPrimaryContact,
  STAGE_PROBABILITY,
} from "./queries";
import type { Opportunity } from "@/types";

type Row = Record<string, unknown>;

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

async function setup() {
  db = await createTestDb();
  const { companyId, userIds } = await insertTestCompany(db, { roles: ["ceo", "comercial"] });
  return { db, companyId, seller: userIds.comercial! };
}

describe("clientes", () => {
  it("cria e edita com e-mail em minúsculas, campos vazios como NULL e limite de crédito em centavos", async () => {
    const { db, companyId, seller } = await setup();
    const id = await saveCustomer(db, companyId, { name: "  Clínica Vida ", type: "PJ", email: " Contato@Vida.COM ", phone: "", document: "12.345.678/0001-90", segment: "Saúde", owner_id: seller, credit_limit: "1.234,567" });
    const [row] = await db.select<Row[]>("SELECT * FROM customers WHERE id=?", [id]);
    expect(row).toMatchObject({ name: "Clínica Vida", email: "contato@vida.com", phone: null, segment: "Saúde", owner_id: seller, credit_limit: 1234.57, status: "active", address_json: "{}" });

    await saveCustomer(db, companyId, { name: "Clínica Vida Ltda", type: "PJ", status: "inactive", credit_limit: "" }, id);
    const [edited] = await db.select<Row[]>("SELECT * FROM customers WHERE id=?", [id]);
    expect(edited).toMatchObject({ name: "Clínica Vida Ltda", status: "inactive", credit_limit: null, email: null });
    await expect(saveCustomer(db, companyId, { name: " ", type: "PJ" })).rejects.toThrow(/nome/i);
    expect((await fetchCustomers(db, companyId)).map((c) => c.name)).toEqual(["Clínica Vida Ltda"]);
  });
});

describe("contatos", () => {
  it("o primeiro contato do cliente vira principal; trocar o principal desmarca o anterior; excluir é soft delete", async () => {
    const { db, companyId } = await setup();
    await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?,?,?)", ["cust-1", companyId, "Clínica"]);
    const ana = await saveContact(db, companyId, { customer_id: "cust-1", name: "Ana", email: "ANA@vida.com", role: "Compras" });
    const bruno = await saveContact(db, companyId, { customer_id: "cust-1", name: "Bruno" });
    let contacts = await fetchContacts(db, companyId, "cust-1");
    expect(contacts.map((c) => [c.name, c.is_primary, c.email])).toEqual([["Ana", 1, "ana@vida.com"], ["Bruno", 0, null]]);

    await setPrimaryContact(db, companyId, bruno);
    contacts = await fetchContacts(db, companyId, "cust-1");
    expect(contacts.map((c) => [c.name, c.is_primary])).toEqual([["Bruno", 1], ["Ana", 0]]);

    await deleteContact(db, companyId, ana);
    expect((await fetchContacts(db, companyId, "cust-1")).map((c) => c.name)).toEqual(["Bruno"]);
    expect((await fetchContacts(db, companyId)).map((c) => c.name)).toEqual(["Bruno"]);
  });
});

describe("oportunidades e funil", () => {
  it("salva com a probabilidade padrão da etapa e status coerente", async () => {
    const { db, companyId, seller } = await setup();
    const id = await saveOpportunity(db, companyId, seller, { title: "Site", value: "1.500,50", stage: "proposta" });
    const [row] = await db.select<Row[]>("SELECT * FROM opportunities WHERE id=?", [id]);
    expect(row).toMatchObject({ title: "Site", value: 1500.5, stage: "proposta", probability: STAGE_PROBABILITY.proposta, status: "open", owner_id: seller });
    await saveOpportunity(db, companyId, seller, { title: "Site novo", value: 2000, stage: "negociacao", probability: 90, expected_close_date: "2026-11-30" }, id);
    expect((await fetchOpportunities(db, companyId))[0]).toMatchObject({ title: "Site novo", probability: 90, expected_close_date: "2026-11-30" });
    await expect(saveOpportunity(db, companyId, seller, { title: "X", stage: "ganho" })).rejects.toThrow();
  });

  it("resumo do funil: total e valor ponderado por etapa (abertas), em centavos", () => {
    const opp = (stage: Opportunity["stage"], value: number, probability: number) => ({ stage, value, probability }) as Opportunity;
    const summary = pipelineSummary([opp("novo", 1000, 10), opp("novo", 333.33, 10), opp("proposta", 2000, 50), opp("ganho", 5000, 100), opp("perdido", 700, 0)]);
    expect(summary.byStage.novo).toEqual({ count: 2, total: 1333.33, weighted: 133.33 });
    expect(summary.byStage.proposta).toEqual({ count: 1, total: 2000, weighted: 1000 });
    expect(summary.byStage.ganho).toEqual({ count: 1, total: 5000, weighted: 5000 });
    expect(summary.open).toEqual({ count: 3, total: 3333.33, weighted: 1133.33 });
    expect(summary.winRate).toBe(0.5);
  });
});

describe("resumo financeiro do cliente e usuários", () => {
  it("soma faturado, em aberto e vencido pelas parcelas a receber", async () => {
    const { db, companyId } = await setup();
    await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?,?,?)", ["cust-1", companyId, "Clínica"]);
    await db.execute("INSERT INTO invoices (id, company_id, number, customer_id, total, status) VALUES (?,?,?,?,?,?)", ["inv-1", companyId, 1, "cust-1", 900, "emitida"]);
    await db.execute("INSERT INTO invoices (id, company_id, number, customer_id, total, status) VALUES (?,?,?,?,?,?)", ["inv-2", companyId, 2, "cust-1", 100, "cancelada"]);
    await db.execute("INSERT INTO receivables (id, company_id, customer_id, amount, due_date, status, received_amount) VALUES (?,?,?,?,?,?,?)", ["r1", companyId, "cust-1", 300, "2026-10-01", "recebida", 300]);
    await db.execute("INSERT INTO receivables (id, company_id, customer_id, amount, due_date, status, received_amount) VALUES (?,?,?,?,?,?,?)", ["r2", companyId, "cust-1", 300, "2026-10-10", "recebida_parcial", 100.1]);
    await db.execute("INSERT INTO receivables (id, company_id, customer_id, amount, due_date, status, received_amount) VALUES (?,?,?,?,?,?,?)", ["r3", companyId, "cust-1", 300, "2026-11-10", "aberta", 0]);
    await db.execute("INSERT INTO receivables (id, company_id, customer_id, amount, due_date, status) VALUES (?,?,?,?,?,?)", ["r4", companyId, "cust-1", 50, "2026-09-10", "cancelada"]);

    const summary = await customerFinance(db, companyId, "cust-1", "2026-10-24");
    expect(summary).toEqual({ invoiced: 900, received: 400.1, open: 499.9, overdue: 199.9 });
  });

  it("lista as contas ativas da empresa com o papel", async () => {
    const { db, companyId, seller } = await setup();
    const users = await fetchCompanyUsers(db, companyId);
    expect(users.map((user) => [user.id, user.role])).toEqual(expect.arrayContaining([[seller, "comercial"]]));
    expect(users.every((user) => user.name)).toBe(true);
  });
});
