// O seed de prospecção põe os leads importados na campanha padrão ("Prospecção 1"), sem duplicar ao rodar de novo.
import { describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import type { Lead, ProspectingCampaign, Session } from "@/types";
import { defaultCampaignId } from "./campaigns";
import { ensureSiteProspectingSeed } from "./seed";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();

function session(companyId: string): Session {
  return {
    user: { id: "test-user-comercial", name: "Teste comercial", email: "comercial@teste.local" },
    membership: { id: `test-member-${companyId}-comercial`, company_id: companyId, user_id: "test-user-comercial", role: "comercial", scope: "setor" },
    company: { id: companyId, name: "Empresa de Teste" },
  } as unknown as Session;
}

describe("seed de prospecção × campanhas", () => {
  it("todos os leads do seed entram na \"Prospecção 1\" da empresa", async () => {
    const { companyId } = await insertTestCompany(testDb(), { roles: ["comercial"] });
    expect(await ensureSiteProspectingSeed(session(companyId))).toBe(true);

    const leads = await testDb().select<Lead[]>("SELECT * FROM leads WHERE company_id = ?", [companyId]);
    expect(leads.length).toBeGreaterThan(100);
    expect(new Set(leads.map((lead) => lead.campaign_id))).toEqual(new Set([defaultCampaignId(companyId)]));
    const campaigns = await testDb().select<ProspectingCampaign[]>("SELECT * FROM prospecting_campaigns WHERE company_id = ?", [companyId]);
    expect(campaigns.map((campaign) => campaign.name)).toEqual(["Prospecção 1"]);
    expect(await testDb().select("PRAGMA foreign_key_check")).toEqual([]);

    expect(await ensureSiteProspectingSeed(session(companyId))).toBe(false);
    expect(await testDb().select<unknown[]>("SELECT * FROM prospecting_campaigns WHERE company_id = ?", [companyId])).toHaveLength(1);
  });
});
