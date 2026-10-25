// Migration 0012 (redesign modular) no SQLite real: assistente, calendário, pastas de nuvem e campanhas de prospecção.
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

const NEW_TABLES = ["assistant_conversations", "calendar_sources", "calendar_events", "cloud_folders", "prospecting_campaigns"];

async function columns(target: TestDb, table: string): Promise<string[]> {
  const rows = await target.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
  return rows.map((row) => row.name);
}

describe("migration 0012 (redesign modular)", () => {
  it("cria as tabelas novas com as colunas-padrão e leads.campaign_id", async () => {
    db = await createTestDb();
    expect(db.appliedVersions).toContain(12);
    for (const table of NEW_TABLES) {
      const cols = await columns(db, table);
      for (const col of ["id", "company_id", "created_at", "deleted_at"]) expect(cols, `${table}.${col}`).toContain(col);
    }
    expect(await columns(db, "calendar_sources")).toEqual(
      expect.arrayContaining(["user_id", "name", "kind", "url", "color", "last_sync_at", "last_error", "updated_at"]),
    );
    expect(await columns(db, "calendar_events")).toEqual(
      expect.arrayContaining(["source_id", "uid", "title", "starts_at", "ends_at", "all_day", "location", "description", "user_id", "kind", "updated_at"]),
    );
    expect(await columns(db, "cloud_folders")).toEqual(expect.arrayContaining(["provider", "label", "local_path", "created_by", "updated_at"]));
    expect(await columns(db, "prospecting_campaigns")).toEqual(expect.arrayContaining(["name", "updated_at"]));
    expect(await columns(db, "leads")).toContain("campaign_id");
    expect(await columns(db, "assistant_messages")).toEqual(expect.arrayContaining(["conversation_id", "author", "text", "created_at"]));
  });

  it("leads que já existiam vão para a campanha \"Prospecção 1\" da própria empresa; empresa sem leads fica sem campanha", async () => {
    db = await createTestDb({ upTo: 11 });
    const { companyId } = await insertTestCompany(db, { roles: ["comercial"] });
    await insertTestCompany(db, { companyId: "outra-empresa", roles: ["comercial"] });
    await insertTestCompany(db, { companyId: "empresa-sem-leads", roles: ["comercial"] });
    await db.execute("INSERT INTO leads (id, company_id, name) VALUES (?, ?, ?)", ["lead-1", companyId, "Pet Shop Amigo"]);
    await db.execute("INSERT INTO leads (id, company_id, name, deleted_at) VALUES (?, ?, ?, datetime('now'))", ["lead-2", companyId, "Clínica Antiga"]);
    await db.execute("INSERT INTO leads (id, company_id, name) VALUES (?, ?, ?)", ["dev-lead-3", "outra-empresa", "Lead de outra empresa"]);

    await db.migrate();
    expect(db.appliedVersions).toContain(12);

    const campaigns = await db.select<{ id: string; company_id: string; name: string; deleted_at: string | null }[]>(
      "SELECT id, company_id, name, deleted_at FROM prospecting_campaigns ORDER BY company_id",
    );
    expect(campaigns).toEqual([
      { id: "prospeccao-1-outra-empresa", company_id: "outra-empresa", name: "Prospecção 1", deleted_at: null },
      { id: `prospeccao-1-${companyId}`, company_id: companyId, name: "Prospecção 1", deleted_at: null },
    ]);
    // Id fora dos prefixos dev-/demo-: a limpeza do modo demonstração nunca apaga a campanha dos leads reais.
    for (const campaign of campaigns) expect(campaign.id).not.toMatch(/^(dev|demo)-/);

    const leads = await db.select<{ id: string; campaign_id: string }[]>("SELECT id, campaign_id FROM leads ORDER BY id");
    expect(leads).toEqual([
      { id: "dev-lead-3", campaign_id: "prospeccao-1-outra-empresa" },
      { id: "lead-1", campaign_id: `prospeccao-1-${companyId}` },
      { id: "lead-2", campaign_id: `prospeccao-1-${companyId}` },
    ]);
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("aceita fonte de calendário, evento, pasta de nuvem e campanha, com as chaves estrangeiras valendo", async () => {
    db = await createTestDb();
    const { companyId, userIds } = await insertTestCompany(db, { roles: ["rh"] });
    await db.execute("INSERT INTO calendar_sources (id, company_id, user_id, name, url) VALUES (?, ?, ?, ?, ?)", [
      "src-1",
      companyId,
      userIds.rh,
      "Agenda do RH",
      "https://calendar.google.com/calendar/ical/x/basic.ics",
    ]);
    await db.execute(
      "INSERT INTO calendar_events (id, company_id, source_id, uid, title, starts_at, ends_at, all_day, user_id, kind) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ["ev-1", companyId, "src-1", "abc@google.com", "Férias da Ana", "2026-11-02", "2026-11-14", 1, userIds.rh, "ausencia"],
    );
    await db.execute("INSERT INTO cloud_folders (id, company_id, provider, label, local_path) VALUES (?, ?, ?, ?, ?)", [
      "cf-1",
      companyId,
      "icloud",
      "iCloud Drive",
      "/Users/teste/Library/Mobile Documents/com~apple~CloudDocs",
    ]);
    await db.execute("INSERT INTO prospecting_campaigns (id, company_id, name) VALUES (?, ?, ?)", ["camp-1", companyId, "Clínicas de Sorocaba"]);
    await db.execute("INSERT INTO leads (id, company_id, name, campaign_id) VALUES (?, ?, ?, ?)", ["lead-1", companyId, "Clínica Bem-Estar", "camp-1"]);

    const [source] = await db.select<Record<string, unknown>[]>("SELECT * FROM calendar_sources WHERE id = ?", ["src-1"]);
    expect(source).toMatchObject({ kind: "ical", color: null, last_sync_at: null, last_error: null, deleted_at: null });
    const [event] = await db.select<Record<string, unknown>[]>("SELECT * FROM calendar_events WHERE id = ?", ["ev-1"]);
    expect(event).toMatchObject({ all_day: 1, kind: "ausencia", location: null });
    await db.execute("INSERT INTO calendar_events (id, company_id, title, starts_at) VALUES (?, ?, ?, ?)", ["ev-2", companyId, "Reunião geral", "2026-11-03T13:00:00.000Z"]);
    const [manual] = await db.select<Record<string, unknown>[]>("SELECT * FROM calendar_events WHERE id = ?", ["ev-2"]);
    expect(manual).toMatchObject({ source_id: null, uid: null, all_day: 0, kind: "evento" });

    await expect(db.execute("INSERT INTO leads (id, company_id, name, campaign_id) VALUES (?, ?, ?, ?)", ["lead-x", companyId, "Sem campanha", "nao-existe"])).rejects.toThrow(/FOREIGN KEY/);
    await expect(db.execute("INSERT INTO calendar_events (id, company_id, source_id, title, starts_at) VALUES (?, ?, ?, ?, ?)", ["ev-x", companyId, "nao-existe", "X", "2026-11-03"])).rejects.toThrow(/FOREIGN KEY/);
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("o mesmo uid não se repete numa fonte (sincronizar de novo atualiza), mas pode voltar depois de excluído", async () => {
    db = await createTestDb();
    const { companyId } = await insertTestCompany(db, { roles: ["rh"] });
    await db.execute("INSERT INTO calendar_sources (id, company_id, name, url) VALUES (?, ?, ?, ?)", ["src-1", companyId, "Agenda", "https://exemplo.com/a.ics"]);
    await db.execute("INSERT INTO calendar_sources (id, company_id, name, url) VALUES (?, ?, ?, ?)", ["src-2", companyId, "Outra", "https://exemplo.com/b.ics"]);
    const insert = (id: string, source: string) =>
      db!.execute("INSERT INTO calendar_events (id, company_id, source_id, uid, title, starts_at) VALUES (?, ?, ?, ?, ?, ?)", [id, companyId, source, "uid-1", "Evento", "2026-11-03"]);
    await insert("ev-1", "src-1");
    await expect(insert("ev-2", "src-1")).rejects.toThrow(/UNIQUE/);
    await insert("ev-3", "src-2");
    await db.execute("UPDATE calendar_events SET deleted_at = datetime('now') WHERE id = ?", ["ev-1"]);
    await insert("ev-4", "src-1");
  });

  it("a mesma pasta não é conectada duas vezes na empresa", async () => {
    db = await createTestDb();
    const { companyId } = await insertTestCompany(db, { roles: ["ceo"] });
    const insert = (id: string) =>
      db!.execute("INSERT INTO cloud_folders (id, company_id, provider, label, local_path) VALUES (?, ?, ?, ?, ?)", [id, companyId, "gdrive", "Drive", "/Users/x/Library/CloudStorage/GoogleDrive-x"]);
    await insert("cf-1");
    await expect(insert("cf-2")).rejects.toThrow(/UNIQUE/);
    await db.execute("UPDATE cloud_folders SET deleted_at = datetime('now') WHERE id = ?", ["cf-1"]);
    await insert("cf-3");
  });
});
