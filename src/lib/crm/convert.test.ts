// Conversão lead → oportunidade → cliente (SQLite real com as migrations).
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { convertLeadToOpportunity, loseOpportunity, moveOpportunityStage, winOpportunity } from "./convert";

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

async function insertLead(target: TestDb, companyId: string, extra: Row = {}) {
  const lead = {
    id: "lead-1",
    company_id: companyId,
    name: "Pet Shop Bom Amigo",
    email: "Contato@BomAmigo.com.br",
    phone: "(15) 99876-5432",
    source: "Google Maps",
    status: "interessado",
    category: "Pet shop",
    address: "Rua das Flores, 10",
    notes: "Quer agendamento online.",
    estimated_revenue: 5400,
    referred_by: null,
    ...extra,
  };
  const cols = Object.keys(lead);
  await target.execute(`INSERT INTO leads (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((col) => (lead as Row)[col]));
  return lead;
}

const one = async (target: TestDb, sql: string, binds: unknown[]) => (await target.select<Row[]>(sql, binds))[0];

describe("convertLeadToOpportunity", () => {
  it("cria a oportunidade ligada ao lead e marca o lead como convertido", async () => {
    const { db, companyId, seller } = await setup();
    await insertLead(db, companyId, { referred_by: "Clínica Vida" });

    const { opportunityId } = await convertLeadToOpportunity(db, "lead-1", seller);

    const opp = await one(db, "SELECT * FROM opportunities WHERE id=?", [opportunityId]);
    expect(opp).toMatchObject({
      company_id: companyId,
      lead_id: "lead-1",
      title: "Pet Shop Bom Amigo",
      value: 5400,
      stage: "qualificacao",
      probability: 25,
      status: "open",
      owner_id: seller,
      source: "Google Maps",
      customer_id: null,
    });
    const lead = await one(db, "SELECT * FROM leads WHERE id=?", ["lead-1"]);
    // Indicação só vira "concedido" quando o indicado fecha.
    expect(lead).toMatchObject({ status: "convertido", referral_status: "pendente" });
    const activities = await db.select<Row[]>("SELECT * FROM crm_activities WHERE entity_type='opportunity' AND entity_id=?", [opportunityId]);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ kind: "nota", user_id: seller });
    expect(activities[0].done_at).toBeTruthy();
  });

  it("converter de novo devolve a mesma oportunidade (não duplica)", async () => {
    const { db, companyId, seller } = await setup();
    await insertLead(db, companyId);
    const first = await convertLeadToOpportunity(db, "lead-1", seller);
    const second = await convertLeadToOpportunity(db, "lead-1", seller);
    expect(second.opportunityId).toBe(first.opportunityId);
    expect(await db.select("SELECT count(*) AS n FROM opportunities WHERE lead_id=?", ["lead-1"])).toEqual([{ n: 1 }]);
  });

  it("recusa lead inexistente ou excluído", async () => {
    const { db, companyId, seller } = await setup();
    await insertLead(db, companyId, { deleted_at: "2026-01-01T00:00:00.000Z" });
    await expect(convertLeadToOpportunity(db, "lead-1", seller)).rejects.toThrow(/lead/i);
    await expect(convertLeadToOpportunity(db, "nao-existe", seller)).rejects.toThrow(/lead/i);
  });
});

describe("winOpportunity", () => {
  it("cria o cliente a partir do lead, fecha a oportunidade e o lead e registra atividade", async () => {
    const { db, companyId, seller } = await setup();
    await insertLead(db, companyId, { referred_by: "Clínica Vida" });
    const { opportunityId } = await convertLeadToOpportunity(db, "lead-1", seller);

    const result = await winOpportunity(db, opportunityId, seller);

    expect(result.salesOrderId).toBeNull();
    const customer = await one(db, "SELECT * FROM customers WHERE id=?", [result.customerId]);
    expect(customer).toMatchObject({
      company_id: companyId,
      name: "Pet Shop Bom Amigo",
      email: "contato@bomamigo.com.br",
      phone: "(15) 99876-5432",
      type: "PJ",
      status: "active",
      segment: "Pet shop",
      source: "Google Maps",
      owner_id: seller,
    });
    expect(JSON.parse(String(customer.address_json))).toEqual({ logradouro: "Rua das Flores, 10" });
    const opp = await one(db, "SELECT * FROM opportunities WHERE id=?", [opportunityId]);
    expect(opp).toMatchObject({ stage: "ganho", status: "won", probability: 100, customer_id: result.customerId });
    expect(opp.closed_at).toBeTruthy();
    const lead = await one(db, "SELECT * FROM leads WHERE id=?", ["lead-1"]);
    expect(lead).toMatchObject({ status: "fechado", customer_id: result.customerId, referral_status: "concedido" });
    const activities = await db.select<Row[]>("SELECT * FROM crm_activities WHERE entity_type='opportunity' AND entity_id=? ORDER BY created_at", [opportunityId]);
    expect(activities.map((row) => row.subject)).toContain("Oportunidade ganha");
    expect(activities.find((row) => row.subject === "Oportunidade ganha")).toMatchObject({ customer_id: result.customerId, user_id: seller });
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("usa o cliente que já existe (mesmo e-mail ou telefone) em vez de duplicar", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO customers (id, company_id, name, email) VALUES (?,?,?,?)", ["cust-1", companyId, "Bom Amigo Ltda", "contato@bomamigo.com.br"]);
    await insertLead(db, companyId);
    const { opportunityId } = await convertLeadToOpportunity(db, "lead-1", seller);
    const result = await winOpportunity(db, opportunityId, seller);
    expect(result.customerId).toBe("cust-1");
    expect(await db.select("SELECT count(*) AS n FROM customers")).toEqual([{ n: 1 }]);
  });

  it("oportunidade com cliente: mantém o cliente e gera o pedido de venda da proposta aceita", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?,?,?)", ["cust-1", companyId, "Clínica Vida"]);
    await db.execute("INSERT INTO products (id, company_id, sku, name, price) VALUES (?,?,?,?,?)", ["prod-1", companyId, "SITE-PREMIUM", "Site Premium", 3000]);
    await db.execute("INSERT INTO opportunities (id, company_id, customer_id, title, value, stage, probability, owner_id) VALUES (?,?,?,?,?,?,?,?)", ["opp-1", companyId, "cust-1", "Site da clínica", 3600, "negociacao", 75, seller]);
    await db.execute(
      "INSERT INTO proposals (id, company_id, opportunity_id, customer_id, number, title, status, subtotal, discount, value, payment_terms) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      ["prop-1", companyId, "opp-1", "cust-1", 1, "Site da clínica", "aceita", 3600, 100, 3500, "3x no boleto"],
    );
    await db.execute("INSERT INTO proposal_items (id, company_id, proposal_id, product_id, description, qty, unit_price, discount, total, position) VALUES (?,?,?,?,?,?,?,?,?,?)", ["pi-1", companyId, "prop-1", "prod-1", "Site Premium", 1, 3000, 0, 3000, 1]);
    await db.execute("INSERT INTO proposal_items (id, company_id, proposal_id, description, unit, qty, unit_price, discount, total, position) VALUES (?,?,?,?,?,?,?,?,?,?)", ["pi-2", companyId, "prop-1", "Mensalidade", "mês", 2, 300, 0, 600, 2]);

    const result = await winOpportunity(db, "opp-1", seller);

    expect(result.customerId).toBe("cust-1");
    expect(result.salesOrderId).toBeTruthy();
    const order = await one(db, "SELECT * FROM sales_orders WHERE id=?", [result.salesOrderId]);
    expect(order).toMatchObject({
      company_id: companyId,
      number: 1,
      customer_id: "cust-1",
      opportunity_id: "opp-1",
      proposal_id: "prop-1",
      seller_id: seller,
      status: "rascunho",
      payment_terms: "3x no boleto",
      subtotal: 3600,
      discount: 100,
      total: 3500,
      created_by: seller,
    });
    expect(String(order.order_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const items = await db.select<Row[]>("SELECT * FROM sales_order_items WHERE order_id=? ORDER BY position", [result.salesOrderId]);
    expect(items.map((row) => [row.description, row.qty, row.unit_price, row.total, row.unit])).toEqual([
      ["Site Premium", 1, 3000, 3000, "un"],
      ["Mensalidade", 2, 300, 600, "mês"],
    ]);

    // Ganhar de novo não gera outro pedido.
    const again = await winOpportunity(db, "opp-1", seller);
    expect(again.salesOrderId).toBe(result.salesOrderId);
    expect(await db.select("SELECT count(*) AS n FROM sales_orders")).toEqual([{ n: 1 }]);
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("proposta escolhida na hora vira aceita; sem permissão de pedido, não gera pedido", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?,?,?)", ["cust-1", companyId, "Clínica Vida"]);
    await db.execute("INSERT INTO opportunities (id, company_id, customer_id, title, value) VALUES (?,?,?,?,?)", ["opp-1", companyId, "cust-1", "Site", 1000]);
    await db.execute("INSERT INTO proposals (id, company_id, opportunity_id, customer_id, number, status, subtotal, value) VALUES (?,?,?,?,?,?,?,?)", ["prop-1", companyId, "opp-1", "cust-1", 1, "enviada", 1000, 1000]);
    await db.execute("INSERT INTO proposal_items (id, company_id, proposal_id, description, qty, unit_price, total) VALUES (?,?,?,?,?,?,?)", ["pi-1", companyId, "prop-1", "Site", 1, 1000, 1000]);

    const result = await winOpportunity(db, "opp-1", seller, { proposalId: "prop-1", createSalesOrder: false });
    expect(result.salesOrderId).toBeNull();
    const proposal = await one(db, "SELECT * FROM proposals WHERE id=?", ["prop-1"]);
    expect(proposal.status).toBe("aceita");
    expect(proposal.decided_at).toBeTruthy();
  });

  it("sem lead nem cliente: cria o cliente com o nome informado", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO opportunities (id, company_id, title, value) VALUES (?,?,?,?)", ["opp-1", companyId, "Contrato de suporte", 1200]);
    const result = await winOpportunity(db, "opp-1", seller, { customerName: "Padaria Pão Quente" });
    expect(await one(db, "SELECT name, company_id FROM customers WHERE id=?", [result.customerId])).toEqual({ name: "Padaria Pão Quente", company_id: companyId });
  });
});

describe("loseOpportunity e moveOpportunityStage", () => {
  it("perder grava o motivo, fecha e registra atividade; mover reabre com a probabilidade da etapa", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO opportunities (id, company_id, title, value, stage, probability) VALUES (?,?,?,?,?,?)", ["opp-1", companyId, "Site", 1000, "proposta", 50]);

    await loseOpportunity(db, "opp-1", seller, "Preço acima do orçamento");
    expect(await one(db, "SELECT stage, status, probability, lost_reason FROM opportunities WHERE id=?", ["opp-1"])).toEqual({
      stage: "perdido",
      status: "lost",
      probability: 0,
      lost_reason: "Preço acima do orçamento",
    });
    const [activity] = await db.select<Row[]>("SELECT * FROM crm_activities WHERE entity_id=?", ["opp-1"]);
    expect(activity).toMatchObject({ subject: "Oportunidade perdida", body: "Preço acima do orçamento" });

    await moveOpportunityStage(db, "opp-1", "negociacao", seller);
    const reopened = await one(db, "SELECT * FROM opportunities WHERE id=?", ["opp-1"]);
    expect(reopened).toMatchObject({ stage: "negociacao", status: "open", probability: 75, closed_at: null, lost_reason: null });
  });

  it("mover para ganho ou perdido exige o fluxo próprio", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO opportunities (id, company_id, title) VALUES (?,?,?)", ["opp-1", companyId, "Site"]);
    await expect(moveOpportunityStage(db, "opp-1", "ganho", seller)).rejects.toThrow(/winOpportunity|ganh/i);
    await expect(moveOpportunityStage(db, "opp-1", "perdido", seller)).rejects.toThrow(/loseOpportunity|perd/i);
  });
});
