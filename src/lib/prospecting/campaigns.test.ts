// @vitest-environment jsdom
// Campanha padrão da prospecção ("Prospecção 1"): leads sem campanha vão para ela, no SQLite e no banco demo.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID, type DatabaseLike } from "@/lib/db/demo";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import type { Lead, ProspectingCampaign } from "@/types";
import {
  assignLeadsWithoutCampaign,
  campaignNameProblem,
  campaignStats,
  createCampaign,
  DEFAULT_CAMPAIGN_NAME,
  defaultCampaignId,
  ensureDefaultCampaign,
  listCampaigns,
  nextCampaignName,
  renameCampaign,
} from "./campaigns";

let sqlite: TestDb | null = null;
beforeEach(() => localStorage.clear());
afterEach(() => {
  sqlite?.close();
  sqlite = null;
});

async function sqliteDb(): Promise<{ db: DatabaseLike; companyId: string }> {
  sqlite = await createTestDb();
  const { companyId } = await insertTestCompany(sqlite, { roles: ["comercial"] });
  await insertTestCompany(sqlite, { companyId: "outra", roles: ["comercial"] });
  return { db: sqlite, companyId };
}

const campaigns = (db: DatabaseLike, companyId: string) =>
  db.select<ProspectingCampaign[]>("SELECT * FROM prospecting_campaigns WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at ASC", [companyId]);
const leads = (db: DatabaseLike, companyId: string) => db.select<Lead[]>("SELECT * FROM leads WHERE company_id=? ORDER BY name ASC", [companyId]);

describe.each([
  ["SQLite", sqliteDb],
  ["demo", async () => ({ db: createDemoDb() as DatabaseLike, companyId: DEMO_COMPANY_ID })],
] as const)("campanha padrão da prospecção (%s)", (_name, open) => {
  it("empresa sem campanha ganha a \"Prospecção 1\" e os leads sem campanha vão para ela; rodar de novo não duplica", async () => {
    const { db, companyId } = await open();
    await db.execute("INSERT INTO leads (id, company_id, name) VALUES (?, ?, ?)", ["lead-a", companyId, "A Pet Shop"]);
    await db.execute("INSERT INTO leads (id, company_id, name) VALUES (?, ?, ?)", ["dev-lead-b", companyId, "B Clínica"]);

    const id = await ensureDefaultCampaign(db, companyId);
    expect(id).toBe(defaultCampaignId(companyId));
    expect(id).not.toMatch(/^(dev|demo)-/);
    expect((await campaigns(db, companyId)).map((campaign) => campaign.name)).toEqual([DEFAULT_CAMPAIGN_NAME]);
    expect((await leads(db, companyId)).map((lead) => lead.campaign_id)).toEqual([id, id]);

    expect(await ensureDefaultCampaign(db, companyId)).toBe(id);
    expect(await campaigns(db, companyId)).toHaveLength(1);
  });

  it("com campanhas já criadas, lead sem campanha vai para a mais antiga e lead com campanha não muda", async () => {
    const { db, companyId } = await open();
    await db.execute("INSERT INTO prospecting_campaigns (id, company_id, name, created_at) VALUES (?, ?, ?, ?)", ["camp-nova", companyId, "Advogados", "2026-10-20T10:00:00.000Z"]);
    await db.execute("INSERT INTO prospecting_campaigns (id, company_id, name, created_at) VALUES (?, ?, ?, ?)", ["camp-velha", companyId, "Clínicas", "2026-09-01T10:00:00.000Z"]);
    await db.execute("INSERT INTO leads (id, company_id, name, campaign_id) VALUES (?, ?, ?, ?)", ["lead-a", companyId, "A Escritório", "camp-nova"]);
    await db.execute("INSERT INTO leads (id, company_id, name) VALUES (?, ?, ?)", ["lead-b", companyId, "B Sem campanha"]);

    expect(await ensureDefaultCampaign(db, companyId)).toBe("camp-velha");
    expect((await leads(db, companyId)).map((lead) => lead.campaign_id)).toEqual(["camp-nova", "camp-velha"]);
    expect(await campaigns(db, companyId)).toHaveLength(2);
  });

  it("campanha padrão excluída volta quando não sobra nenhuma ativa", async () => {
    const { db, companyId } = await open();
    const id = await ensureDefaultCampaign(db, companyId);
    await db.execute("UPDATE prospecting_campaigns SET deleted_at=? WHERE id=?", ["2026-10-25T10:00:00.000Z", id]);
    expect(await ensureDefaultCampaign(db, companyId)).toBe(id);
    expect((await campaigns(db, companyId)).map((campaign) => campaign.id)).toEqual([id]);
  });
});

describe("nome sugerido e validação do nome da prospecção", () => {
  const camp = (id: string, name: string) => ({ id, name });

  it("sugere \"Prospecção N\" depois da maior numeração e da quantidade de campanhas", () => {
    expect(nextCampaignName([])).toBe("Prospecção 1");
    expect(nextCampaignName([camp("a", "Prospecção 1")])).toBe("Prospecção 2");
    expect(nextCampaignName([camp("a", "Prospecção 1"), camp("b", "Prospecção 7")])).toBe("Prospecção 8");
    expect(nextCampaignName([camp("a", "Advogados"), camp("b", "Clínicas")])).toBe("Prospecção 3");
  });

  it("recusa nome vazio, comprido demais ou repetido (sem diferenciar maiúsculas e espaços), mas aceita o próprio nome", () => {
    const list = [camp("a", "Prospecção 1"), camp("b", "Advogados")];
    expect(campaignNameProblem("   ", list)).toMatch(/nome/i);
    expect(campaignNameProblem("x".repeat(81), list)).toMatch(/80/);
    expect(campaignNameProblem("  advogados ", list)).toMatch(/já existe/i);
    expect(campaignNameProblem("ADVOGADOS", list, "b")).toBeNull();
    expect(campaignNameProblem("Clínicas", list)).toBeNull();
  });
});

const insertLead = (db: DatabaseLike, companyId: string, id: string, campaignId: string | null, status: string, revenue: number) =>
  db.execute("INSERT INTO leads (id, company_id, name, status, estimated_revenue, campaign_id) VALUES (?, ?, ?, ?, ?, ?)", [id, companyId, `Lead ${id}`, status, revenue, campaignId]);

describe.each([
  ["SQLite", sqliteDb],
  ["demo", async () => ({ db: createDemoDb() as DatabaseLike, companyId: DEMO_COMPANY_ID })],
] as const)("várias prospecções nomeadas (%s)", (_name, open) => {
  it("nova campanha começa vazia, aparece na lista e não usa os prefixos do modo demonstração", async () => {
    const { db, companyId } = await open();
    const defaultId = await ensureDefaultCampaign(db, companyId);
    await insertLead(db, companyId, "lead-1", defaultId, "abordado", 1000);

    const id = await createCampaign(db, companyId, "  Advogados de Sorocaba  ");
    expect(id).not.toMatch(/^(dev|demo)-/);
    expect(await campaignStats(db, id)).toEqual({ leads: 0, contacted: 0, won: 0, potential: 0 });
    const list = await listCampaigns(db, companyId);
    expect(list.map((campaign) => campaign.name)).toContain("Advogados de Sorocaba");
    expect(list.find((campaign) => campaign.id === id)?.company_id).toBe(companyId);
  });

  it("os leads de uma campanha não entram nos números da outra", async () => {
    const { db, companyId } = await open();
    const a = await createCampaign(db, companyId, "Clínicas");
    const b = await createCampaign(db, companyId, "Advogados");
    await insertLead(db, companyId, "a-1", a, "novo", 1000.1);
    await insertLead(db, companyId, "a-2", a, "abordado", 2000.2);
    await insertLead(db, companyId, "a-3", a, "fechado", 3000);
    await insertLead(db, companyId, "a-4", a, "interessado", 0);
    await insertLead(db, companyId, "b-1", b, "fechado", 5000);
    await insertLead(db, companyId, "b-2", b, "novo", 700);
    await db.execute("UPDATE leads SET deleted_at=? WHERE id=?", ["2026-10-25T10:00:00.000Z", "b-2"]);

    expect(await campaignStats(db, a)).toEqual({ leads: 4, contacted: 3, won: 1, potential: 6000.3 });
    expect(await campaignStats(db, b)).toEqual({ leads: 1, contacted: 1, won: 1, potential: 5000 });
  });

  it("renomear muda só o nome: os leads continuam na mesma campanha", async () => {
    const { db, companyId } = await open();
    const id = await createCampaign(db, companyId, "Clínicas");
    await insertLead(db, companyId, "a-1", id, "novo", 100);
    await insertLead(db, companyId, "a-2", id, "fechado", 200);
    const before = await campaignStats(db, id);

    await renameCampaign(db, id, "Clínicas veterinárias", { companyId });

    expect((await listCampaigns(db, companyId)).find((campaign) => campaign.id === id)?.name).toBe("Clínicas veterinárias");
    expect((await leads(db, companyId)).map((lead) => lead.campaign_id)).toEqual([id, id]);
    expect(await campaignStats(db, id)).toEqual(before);
  });

  it("recusa nome repetido ao criar e ao renomear, sem gravar nada", async () => {
    const { db, companyId } = await open();
    const a = await createCampaign(db, companyId, "Clínicas");
    await createCampaign(db, companyId, "Advogados");
    await expect(createCampaign(db, companyId, "clínicas")).rejects.toThrow(/já existe/i);
    await expect(renameCampaign(db, a, " ADVOGADOS ", { companyId })).rejects.toThrow(/já existe/i);
    await expect(renameCampaign(db, a, "", { companyId })).rejects.toThrow(/nome/i);
    expect((await listCampaigns(db, companyId)).map((campaign) => campaign.name).sort()).toEqual(["Advogados", "Clínicas"]);
  });

  it("papel sem permissão em leads não cria nem renomeia (conferido na camada de dados)", async () => {
    const { db, companyId } = await open();
    const id = await createCampaign(db, companyId, "Clínicas", { role: "comercial" });
    await expect(createCampaign(db, companyId, "Advogados", { role: "atendimento" })).rejects.toThrow(/permissão/i);
    await expect(renameCampaign(db, id, "Outro nome", { companyId, role: "auditor" })).rejects.toThrow(/permissão/i);
    expect((await listCampaigns(db, companyId)).map((campaign) => campaign.name)).toEqual(["Clínicas"]);
  });

  it("não renomeia campanha de outra empresa nem campanha excluída", async () => {
    const { db, companyId } = await open();
    const id = await createCampaign(db, companyId, "Clínicas");
    await expect(renameCampaign(db, id, "Invasão", { companyId: "outra" })).rejects.toThrow(/não encontrada/i);
    await db.execute("UPDATE prospecting_campaigns SET deleted_at=? WHERE id=?", ["2026-10-25T10:00:00.000Z", id]);
    await expect(renameCampaign(db, id, "Volta", { companyId })).rejects.toThrow(/não encontrada/i);
  });

  it("leads importados sem campanha vão para a campanha escolhida; os que já têm campanha não mudam", async () => {
    const { db, companyId } = await open();
    const a = await createCampaign(db, companyId, "Clínicas");
    const b = await createCampaign(db, companyId, "Advogados");
    await insertLead(db, companyId, "a-1", a, "novo", 0);
    await insertLead(db, companyId, "x-1", null, "novo", 0);
    await insertLead(db, companyId, "x-2", null, "novo", 0);

    expect(await assignLeadsWithoutCampaign(db, companyId, b)).toBe(2);
    const byId = Object.fromEntries((await leads(db, companyId)).map((lead) => [lead.id, lead.campaign_id]));
    expect(byId).toEqual({ "a-1": a, "x-1": b, "x-2": b });
    await expect(assignLeadsWithoutCampaign(db, companyId, "nao-existe")).rejects.toThrow(/não encontrada/i);
  });
});
