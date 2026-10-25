// @vitest-environment jsdom
// Campanha padrão da prospecção ("Prospecção 1"): leads sem campanha vão para ela, no SQLite e no banco demo.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID, type DatabaseLike } from "@/lib/db/demo";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import type { Lead, ProspectingCampaign } from "@/types";
import { DEFAULT_CAMPAIGN_NAME, defaultCampaignId, ensureDefaultCampaign } from "./campaigns";

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
