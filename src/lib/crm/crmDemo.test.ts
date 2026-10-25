// @vitest-environment jsdom
// O CRM também roda no banco demo do navegador: todo SQL de src/lib/crm cabe nos padrões do demo (sem JOIN, IN, LIKE...).
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID } from "@/lib/db/demo";
import { completeActivity, createActivity, fetchActivities, fetchOverdueFollowUps } from "./activities";
import { convertLeadToOpportunity, loseOpportunity, moveOpportunityStage, winOpportunity } from "./convert";
import { findDuplicateCustomers, mergeCustomers } from "./dedupe";
import { loadProposalDocument, buildProposalPdf } from "./proposalPdf";
import { fetchProposalItems, saveProposal, setProposalStatus } from "./proposals";
import { customerFinance, fetchCompanyUsers, fetchContacts, fetchCustomers, fetchOpportunities, fetchProducts, fetchProposals, saveContact, saveCustomer, saveOpportunity, setPrimaryContact } from "./queries";
import { addTag, createTag, fetchEntityTags, fetchSavedViews, removeTag, saveView } from "./segments";

const C = DEMO_COMPANY_ID;
const USER = "demo-comercial";
type Row = Record<string, unknown>;

beforeEach(() => localStorage.clear());

describe("CRM no banco demo", () => {
  it("clientes, contatos, tags, segmentos, atividades e resumo financeiro", async () => {
    const db = createDemoDb();
    const before = await fetchCustomers(db, C);
    expect(before.length).toBeGreaterThan(0);
    const id = await saveCustomer(db, C, { name: "Clínica Demo", type: "PJ", email: "Demo@Clinica.com", owner_id: USER, credit_limit: "1.000,00" });
    await saveCustomer(db, C, { name: "Clínica Demo Ltda", type: "PJ", email: "demo@clinica.com" }, id);
    expect((await fetchCustomers(db, C)).find((c) => c.id === id)?.name).toBe("Clínica Demo Ltda");

    const ana = await saveContact(db, C, { customer_id: id, name: "Ana" });
    const bia = await saveContact(db, C, { customer_id: id, name: "Bia" });
    await setPrimaryContact(db, C, bia);
    expect((await fetchContacts(db, C, id)).map((c) => [c.id, c.is_primary])).toEqual([[bia, 1], [ana, 0]]);

    const tag = await createTag(db, C, "VIP", "success");
    await addTag(db, C, tag, "customer", id, USER);
    await addTag(db, C, tag, "customer", id, USER);
    expect((await fetchEntityTags(db, C, "customer")).filter((row) => row.entity_id === id)).toHaveLength(1);
    await removeTag(db, C, tag, "customer", id);
    await saveView(db, C, USER, "customer", "Meus", { ownerId: "me" });
    expect((await fetchSavedViews(db, C, "customer", USER)).map((view) => view.name)).toContain("Meus");

    const activity = await createActivity(db, C, USER, { entity_type: "customer", entity_id: id, kind: "ligacao", subject: "Ligar", due_at: "2020-01-01T12:00:00.000Z" });
    expect((await fetchOverdueFollowUps(db, C, USER)).map((row) => row.id)).toContain(activity);
    await completeActivity(db, C, activity, "Feito");
    expect((await fetchActivities(db, C, { customerId: id }))[0].outcome).toBe("Feito");

    expect(await customerFinance(db, C, id, "2026-10-24")).toEqual({ invoiced: 0, received: 0, open: 0, overdue: 0 });
    expect((await fetchCompanyUsers(db, C)).some((user) => user.id === USER)).toBe(true);
  });

  it("lead → oportunidade → proposta → ganho com pedido, perda e PDF", async () => {
    const db = createDemoDb();
    await db.execute("INSERT INTO leads (id, company_id, name, email, phone, status, estimated_revenue) VALUES (?,?,?,?,?,?,?)", ["lead-demo", C, "Pet Demo", "pet@demo.com", "(15) 99999-1111", "interessado", 4000]);
    const { opportunityId } = await convertLeadToOpportunity(db, "lead-demo", USER);
    expect((await convertLeadToOpportunity(db, "lead-demo", USER)).opportunityId).toBe(opportunityId);

    await db.execute("INSERT INTO products (id, company_id, sku, name, price) VALUES (?,?,?,?,?)", ["prod-demo", C, "DEMO", "Site", 2500]);
    expect((await fetchProducts(db, C)).some((product) => product.id === "prod-demo")).toBe(true);
    const proposalId = await saveProposal(db, C, USER, { opportunity_id: opportunityId, title: "Site", items: [{ product_id: "prod-demo", description: "Site", qty: 1, unit_price: 2500 }] });
    expect(await fetchProposalItems(db, C, proposalId)).toHaveLength(1);
    await setProposalStatus(db, C, proposalId, "send", USER);
    await setProposalStatus(db, C, proposalId, "accept", USER);
    expect((await fetchProposals(db, C)).find((p) => p.id === proposalId)?.status).toBe("aceita");

    const doc = await loadProposalDocument(db, C, proposalId);
    expect(buildProposalPdf(doc).length).toBeGreaterThan(500);

    const won = await winOpportunity(db, opportunityId, USER);
    expect(won.salesOrderId).toBeTruthy();
    const [order] = await db.select<Row[]>("SELECT * FROM sales_orders WHERE company_id=? AND id=?", [C, won.salesOrderId]);
    expect(order).toMatchObject({ customer_id: won.customerId, total: 2500, status: "rascunho" });
    const [lead] = await db.select<Row[]>("SELECT * FROM leads WHERE company_id=? AND id=?", [C, "lead-demo"]);
    expect(lead).toMatchObject({ status: "fechado", customer_id: won.customerId });

    const other = await saveOpportunity(db, C, USER, { title: "Outra", value: 100, stage: "novo" });
    await moveOpportunityStage(db, other, "negociacao", USER);
    await loseOpportunity(db, other, USER, "Sem orçamento");
    expect((await fetchOpportunities(db, C)).find((opp) => opp.id === other)).toMatchObject({ stage: "perdido", status: "lost" });
  });

  it("duplicados e mesclagem", async () => {
    const db = createDemoDb();
    const a = await saveCustomer(db, C, { name: "Dup A", type: "PJ", email: "dup@x.com" });
    const b = await saveCustomer(db, C, { name: "Dup B", type: "PJ", email: "DUP@x.com", phone: "(11) 91234-5678" });
    await saveContact(db, C, { customer_id: b, name: "Carla" });
    const group = (await findDuplicateCustomers(db, C)).find((item) => item.keep === a || item.merge.includes(a));
    expect(group).toBeTruthy();
    await mergeCustomers(db, a, [b], USER);
    expect((await fetchContacts(db, C, a)).map((contact) => contact.name)).toContain("Carla");
    expect((await fetchCustomers(db, C)).some((customer) => customer.id === b)).toBe(false);
    const [merged] = await db.select<Row[]>("SELECT * FROM customers WHERE company_id=? AND id=?", [C, b]);
    expect(merged.merged_into_id).toBe(a);
  });
});
