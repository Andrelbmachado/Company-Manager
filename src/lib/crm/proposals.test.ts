// Propostas: itens, totais, numeração, fluxo de status e preço da tabela do cliente (SQLite real).
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { displayProposalStatus, fetchProposalItems, priceFor, proposalPriceList, saveProposal, setProposalStatus } from "./proposals";

type Row = Record<string, unknown>;

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

async function setup() {
  db = await createTestDb();
  const { companyId, userIds } = await insertTestCompany(db, { roles: ["ceo", "comercial"] });
  await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?,?,?)", ["cust-1", companyId, "Clínica Vida"]);
  await db.execute("INSERT INTO products (id, company_id, sku, name, price, unit) VALUES (?,?,?,?,?,?)", ["prod-1", companyId, "AP", "Access point", 899.9, "un"]);
  return { db, companyId, userId: userIds.comercial! };
}

const one = async (target: TestDb, sql: string, binds: unknown[]) => (await target.select<Row[]>(sql, binds))[0];

describe("saveProposal", () => {
  it("cria rascunho numerado com itens e totais em centavos", async () => {
    const { db, companyId, userId } = await setup();
    const id = await saveProposal(db, companyId, userId, {
      title: "Wi-Fi da filial",
      customer_id: "cust-1",
      valid_until: "2026-11-30",
      payment_terms: "30/60 dias",
      discount: 50,
      items: [
        { product_id: "prod-1", description: "Access point", qty: 3, unit_price: 899.9, discount: 0.1, tax_rate: 0 },
        { description: "Instalação", unit: "h", qty: 2.5, unit_price: 120, tax_rate: 5 },
      ],
    });
    const proposal = await one(db, "SELECT * FROM proposals WHERE id=?", [id]);
    // 3 × 899,90 − 0,10 = 2.699,60; 2,5 × 120 = 300; subtotal 2.999,60; imposto 5% de 300 = 15; total = 2.999,60 − 50 + 15.
    expect(proposal).toMatchObject({
      company_id: companyId,
      number: 1,
      title: "Wi-Fi da filial",
      customer_id: "cust-1",
      status: "rascunho",
      version: 1,
      subtotal: 2999.6,
      discount: 50,
      value: 2964.6,
      valid_until: "2026-11-30",
      payment_terms: "30/60 dias",
      created_by: userId,
    });
    const items = await fetchProposalItems(db, companyId, id);
    expect(items.map((item) => [item.position, item.description, item.unit, item.qty, item.total])).toEqual([
      [1, "Access point", "un", 3, 2699.6],
      [2, "Instalação", "h", 2.5, 300],
    ]);
    const second = await saveProposal(db, companyId, userId, { customer_id: "cust-1", items: [{ description: "Visita", qty: 1, unit_price: 100 }] });
    expect((await one(db, "SELECT number FROM proposals WHERE id=?", [second])).number).toBe(2);
  });

  it("editar o rascunho troca os itens (os antigos ficam excluídos) e recalcula; herda o cliente da oportunidade", async () => {
    const { db, companyId, userId } = await setup();
    await db.execute("INSERT INTO opportunities (id, company_id, customer_id, title) VALUES (?,?,?,?)", ["opp-1", companyId, "cust-1", "Site"]);
    const id = await saveProposal(db, companyId, userId, { opportunity_id: "opp-1", items: [{ description: "A", qty: 1, unit_price: 10 }] });
    expect((await one(db, "SELECT customer_id FROM proposals WHERE id=?", [id])).customer_id).toBe("cust-1");
    await saveProposal(db, companyId, userId, { opportunity_id: "opp-1", customer_id: "cust-1", items: [{ description: "B", qty: 2, unit_price: 15 }] }, id);
    expect(await fetchProposalItems(db, companyId, id)).toEqual([expect.objectContaining({ description: "B", total: 30 })]);
    expect(await db.select("SELECT count(*) AS n FROM proposal_items WHERE proposal_id=? AND deleted_at IS NOT NULL", [id])).toEqual([{ n: 1 }]);
    expect((await one(db, "SELECT value FROM proposals WHERE id=?", [id])).value).toBe(30);
  });

  it("recusa proposta sem itens, quantidade zero, preço negativo ou edição fora do rascunho", async () => {
    const { db, companyId, userId } = await setup();
    await expect(saveProposal(db, companyId, userId, { items: [] })).rejects.toThrow(/item/i);
    await expect(saveProposal(db, companyId, userId, { items: [{ description: "A", qty: 0, unit_price: 1 }] })).rejects.toThrow(/quantidade/i);
    await expect(saveProposal(db, companyId, userId, { items: [{ description: "A", qty: 1, unit_price: -1 }] })).rejects.toThrow(/preço/i);
    await expect(saveProposal(db, companyId, userId, { items: [{ description: " ", qty: 1, unit_price: 1 }] })).rejects.toThrow(/descrição/i);
    const id = await saveProposal(db, companyId, userId, { items: [{ description: "A", qty: 1, unit_price: 10 }] });
    await setProposalStatus(db, companyId, id, "send", userId);
    await expect(saveProposal(db, companyId, userId, { items: [{ description: "A", qty: 1, unit_price: 20 }] }, id)).rejects.toThrow(/rascunho/i);
  });

  it("recusa desconto maior que o valor do item ou que o subtotal (o total não fica zerado em silêncio)", async () => {
    const { db, companyId, userId } = await setup();
    await expect(saveProposal(db, companyId, userId, { items: [{ description: "A", qty: 2, unit_price: 10, discount: 20.01 }] })).rejects.toThrow(/Item 1: o desconto não pode ser maior que o valor do item/);
    await expect(saveProposal(db, companyId, userId, { discount: "30,01", items: [{ description: "A", qty: 3, unit_price: 10, tax_rate: 10 }] })).rejects.toThrow(/desconto geral não pode ser maior que o subtotal/);
    expect(await db.select("SELECT count(*) AS n FROM proposals", [])).toEqual([{ n: 0 }]);
    // No limite vale: item 2 × 10 com desconto 20 = 0; desconto geral igual ao subtotal deixa só os impostos.
    const id = await saveProposal(db, companyId, userId, { discount: 30, items: [{ description: "A", qty: 2, unit_price: 10, discount: 20 }, { description: "B", qty: 3, unit_price: 10, tax_rate: 10 }] });
    expect(await one(db, "SELECT subtotal, discount, value FROM proposals WHERE id=?", [id])).toEqual({ subtotal: 30, discount: 30, value: 3 });
  });
});

describe("setProposalStatus", () => {
  it("enviar marca a data e leva a oportunidade para a etapa Proposta; aceitar e revisar seguem o fluxo", async () => {
    const { db, companyId, userId } = await setup();
    await db.execute("INSERT INTO opportunities (id, company_id, customer_id, title, stage, probability) VALUES (?,?,?,?,?,?)", ["opp-1", companyId, "cust-1", "Site", "qualificacao", 25]);
    const id = await saveProposal(db, companyId, userId, { opportunity_id: "opp-1", items: [{ description: "A", qty: 1, unit_price: 10 }] });

    await setProposalStatus(db, companyId, id, "send", userId);
    let proposal = await one(db, "SELECT * FROM proposals WHERE id=?", [id]);
    expect(proposal.status).toBe("enviada");
    expect(proposal.sent_at).toBeTruthy();
    expect(await one(db, "SELECT stage, probability FROM opportunities WHERE id=?", ["opp-1"])).toEqual({ stage: "proposta", probability: 50 });

    await setProposalStatus(db, companyId, id, "decline", userId);
    proposal = await one(db, "SELECT * FROM proposals WHERE id=?", [id]);
    expect(proposal.status).toBe("recusada");
    expect(proposal.decided_at).toBeTruthy();

    await setProposalStatus(db, companyId, id, "revise", userId);
    proposal = await one(db, "SELECT * FROM proposals WHERE id=?", [id]);
    expect(proposal).toMatchObject({ status: "rascunho", version: 2, sent_at: null, decided_at: null, number: 1 });

    await setProposalStatus(db, companyId, id, "send", userId);
    await setProposalStatus(db, companyId, id, "accept", userId);
    expect((await one(db, "SELECT status FROM proposals WHERE id=?", [id])).status).toBe("aceita");
    await expect(setProposalStatus(db, companyId, id, "send", userId)).rejects.toThrow();

    const log = await db.select<Row[]>("SELECT subject FROM crm_activities WHERE entity_type='proposal' AND entity_id=? ORDER BY created_at", [id]);
    expect(log.map((row) => row.subject)).toEqual(expect.arrayContaining(["Proposta enviada", "Proposta recusada", "Proposta aceita"]));
  });

  it("não volta a oportunidade que já está em negociação", async () => {
    const { db, companyId, userId } = await setup();
    await db.execute("INSERT INTO opportunities (id, company_id, title, stage, probability) VALUES (?,?,?,?,?)", ["opp-1", companyId, "Site", "negociacao", 80]);
    const id = await saveProposal(db, companyId, userId, { opportunity_id: "opp-1", items: [{ description: "A", qty: 1, unit_price: 10 }] });
    await setProposalStatus(db, companyId, id, "send", userId);
    expect(await one(db, "SELECT stage, probability FROM opportunities WHERE id=?", ["opp-1"])).toEqual({ stage: "negociacao", probability: 80 });
  });
});

describe("regras puras", () => {
  it("proposta enviada com validade vencida aparece como expirada", () => {
    expect(displayProposalStatus({ status: "enviada", valid_until: "2026-10-23" }, "2026-10-24")).toBe("expirada");
    expect(displayProposalStatus({ status: "enviada", valid_until: "2026-10-24" }, "2026-10-24")).toBe("enviada");
    expect(displayProposalStatus({ status: "aceita", valid_until: "2026-01-01" }, "2026-10-24")).toBe("aceita");
    expect(displayProposalStatus({ status: "rascunho", valid_until: null }, "2026-10-24")).toBe("rascunho");
  });

  it("preço da tabela do cliente: maior quantidade mínima atingida; sem tabela, o preço do produto", () => {
    const list = [
      { product_id: "p1", price: 90, min_qty: 1 },
      { product_id: "p1", price: 80, min_qty: 10 },
      { product_id: "p2", price: 5, min_qty: 1 },
    ];
    expect(priceFor("p1", 100, 1, list)).toBe(90);
    expect(priceFor("p1", 100, 12, list)).toBe(80);
    expect(priceFor("p3", 100, 12, list)).toBe(100);
    expect(priceFor("p1", 100, 12, [])).toBe(100);
  });

  it("tabela da proposta pela regra de Vendas: a do cliente se estiver valendo, senão a padrão da empresa", async () => {
    const { db, companyId } = await setup();
    await db.execute("INSERT INTO price_lists (id, company_id, name, is_default, active) VALUES (?,?,?,?,?)", ["pl-padrao", companyId, "Tabela padrão", 1, 1]);
    await db.execute("INSERT INTO price_lists (id, company_id, name, is_default, active, valid_to) VALUES (?,?,?,?,?,?)", ["pl-vencida", companyId, "Promoção de setembro", 0, 1, "2026-09-30"]);
    await db.execute("INSERT INTO price_list_items (id, company_id, price_list_id, product_id, price, min_qty) VALUES (?,?,?,?,?,?)", ["pli-1", companyId, "pl-padrao", "prod-1", 850, 1]);
    await db.execute("INSERT INTO price_list_items (id, company_id, price_list_id, product_id, price, min_qty) VALUES (?,?,?,?,?,?)", ["pli-2", companyId, "pl-vencida", "prod-1", 700, 1]);

    const noList = await proposalPriceList(db, companyId, "cust-1", "2026-10-25");
    expect(noList.list?.id).toBe("pl-padrao");
    expect(priceFor("prod-1", 899.9, 1, noList.items)).toBe(850);

    await db.execute("UPDATE customers SET price_list_id='pl-vencida' WHERE id='cust-1'");
    expect((await proposalPriceList(db, companyId, "cust-1", "2026-10-25")).list?.id).toBe("pl-padrao");
    expect((await proposalPriceList(db, companyId, "cust-1", "2026-09-15")).list?.id).toBe("pl-vencida");

    await db.execute("UPDATE price_lists SET active=0 WHERE id='pl-padrao'");
    expect(await proposalPriceList(db, companyId, null, "2026-10-25")).toEqual({ list: null, items: [] });
  });
});
