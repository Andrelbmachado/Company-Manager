// Gravação da tabela editável de leads em SQLite real: status recalcula último contato e indicação, lead novo entra na
// campanha padrão, permissão conferida aqui. Leads são dados reais: nada aqui apaga lead.
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { defaultCampaignId } from "@/lib/prospecting/campaigns";
import { saveLeadRows } from "./leadEdits";

type Row = Record<string, unknown>;

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

async function setup() {
  db = await createTestDb();
  const { companyId } = await insertTestCompany(db, { roles: ["ceo", "comercial", "financeiro"] });
  return { db, companyId, seller: { role: "comercial" as const, userId: "test-user-comercial" } };
}

const one = async (sql: string, binds: unknown[]) => (await db!.select<Row[]>(sql, binds))[0];

describe("saveLeadRows", () => {
  it("mudar o status marca o último contato e o benefício da indicação", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO leads (id, company_id, name, status, referred_by) VALUES (?,?,?,?,?)", ["l1", companyId, "Pet Shop Bicho", "novo", "Clínica Vida"]);
    await saveLeadRows(db, companyId, seller, { updated: [{ id: "l1", status: "abordado", whatsapp: "(15) 98888-7777" }], created: [] });
    const lead = await one("SELECT * FROM leads WHERE id=?", ["l1"]);
    expect(lead).toMatchObject({ status: "abordado", whatsapp: "(15) 98888-7777", referral_status: "pendente", name: "Pet Shop Bicho" });
    expect(lead!.last_contact_at).not.toBeNull();

    await saveLeadRows(db, companyId, seller, { updated: [{ id: "l1", status: "fechado" }], created: [] });
    expect(await one("SELECT referral_status FROM leads WHERE id=?", ["l1"])).toEqual({ referral_status: "concedido" });
    await saveLeadRows(db, companyId, seller, { updated: [{ id: "l1", status: "novo", referred_by: null }], created: [] });
    expect(await one("SELECT status, last_contact_at, referral_status FROM leads WHERE id=?", ["l1"])).toEqual({ status: "novo", last_contact_at: null, referral_status: null });
  });

  it("lead novo entra na campanha padrão, como novo e com quem cadastrou de responsável", async () => {
    const { db, companyId, seller } = await setup();
    const { created } = await saveLeadRows(db, companyId, seller, { updated: [], created: [{ name: "Banho e Tosa Luna", category: "Pet shop", estimated_revenue: 1500 }] });
    expect(await one("SELECT * FROM leads WHERE id=?", [created[0]])).toMatchObject({
      name: "Banho e Tosa Luna",
      category: "Pet shop",
      status: "novo",
      estimated_revenue: 1500,
      owner_id: "test-user-comercial",
      campaign_id: defaultCampaignId(companyId),
      last_contact_at: null,
    });
  });

  it("recusa nome vazio, status desconhecido e valor negativo sem gravar nada", async () => {
    const { db, companyId, seller } = await setup();
    await db.execute("INSERT INTO leads (id, company_id, name) VALUES (?,?,?)", ["l1", companyId, "Pet Shop Bicho"]);
    await expect(saveLeadRows(db, companyId, seller, { updated: [{ id: "l1", name: " " }], created: [] })).rejects.toThrow(/nome/);
    await expect(saveLeadRows(db, companyId, seller, { updated: [{ id: "l1", status: "sumido" as never }], created: [] })).rejects.toThrow(/status/i);
    await expect(saveLeadRows(db, companyId, seller, { updated: [], created: [{ name: "A" }, { name: "B", estimated_setup: -1 }] })).rejects.toThrow(/negativo/);
    expect(await db.select("SELECT id FROM leads WHERE company_id=?", [companyId])).toHaveLength(1);
  });

  it("perfil sem acesso aos leads não grava", async () => {
    const { db, companyId } = await setup();
    await expect(saveLeadRows(db, companyId, { role: "financeiro", userId: "test-user-financeiro" }, { updated: [], created: [{ name: "X" }] })).rejects.toThrow(/permissão/);
  });
});
