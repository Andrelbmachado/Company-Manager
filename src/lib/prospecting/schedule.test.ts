// @vitest-environment jsdom
// Cronograma de abordagens no CalendarView: leads com data viram eventos de dia inteiro; remarcar grava a data nova.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID, type DatabaseLike } from "@/lib/db/demo";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import type { Lead } from "@/types";
import { nextOutreachDay, outreachItems, rescheduleLead } from "./schedule";

const lead = (id: string, outreach_date: string | null, status = "novo", name = `Lead ${id}`) => ({ id, name, outreach_date, status, priority_rank: Number(id.replace(/\D/g, "")) || null }) as unknown as Lead;

describe("itens do cronograma", () => {
  it("lead com data vira evento de dia inteiro (fim exclusivo); lead sem data fica de fora", () => {
    const items = outreachItems([lead("l1", "2026-11-03"), lead("l2", null), lead("l3", "2026-11-04", "abordado")]);
    expect(items).toEqual([
      { id: "l1", title: "Lead l1", start: "2026-11-03", end: "2026-11-04", allDay: true, sourceLabel: "Novo" },
      { id: "l3", title: "Lead l3", start: "2026-11-04", end: "2026-11-05", allDay: true, sourceLabel: "Abordado" },
    ]);
  });

  it("só pendentes mostra apenas os leads novos; status fora do funil aparece com o nome", () => {
    const leads = [lead("l1", "2026-11-03"), lead("l2", "2026-11-03", "fechado"), lead("l3", "2026-11-05", "convertido")];
    expect(outreachItems(leads, { onlyPending: true }).map((item) => item.id)).toEqual(["l1"]);
    expect(outreachItems(leads).find((item) => item.id === "l3")?.sourceLabel).toBe("Convertido");
  });

  it("data inválida gravada no lead não vira evento", () => {
    expect(outreachItems([lead("l1", "31/12/2026"), lead("l2", "2026-02-30")])).toEqual([]);
  });

  it("dia em foco: o próximo dia (a partir de hoje) com lead novo; senão o primeiro com lead novo; senão o primeiro", () => {
    const leads = [lead("l1", "2026-10-20"), lead("l2", "2026-10-28", "abordado"), lead("l3", "2026-11-02"), lead("l4", "2026-11-09")];
    expect(nextOutreachDay(leads, "2026-10-25")).toBe("2026-11-02");
    expect(nextOutreachDay(leads, "2026-12-01")).toBe("2026-10-20");
    expect(nextOutreachDay([lead("l2", "2026-10-28", "fechado")], "2026-12-01")).toBe("2026-10-28");
    expect(nextOutreachDay([lead("l1", null)], "2026-12-01")).toBeUndefined();
  });
});

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

const dateOf = async (db: DatabaseLike, companyId: string, id: string) =>
  (await db.select<Lead[]>("SELECT * FROM leads WHERE company_id=? AND id=?", [companyId, id]))[0]?.outreach_date ?? null;

describe.each([
  ["SQLite", sqliteDb],
  ["demo", async () => ({ db: createDemoDb() as DatabaseLike, companyId: DEMO_COMPANY_ID })],
] as const)("remarcar abordagem (%s)", (_name, open) => {
  it("grava a data nova (aceita dd/mm/aaaa) e limpar tira o lead do cronograma", async () => {
    const { db, companyId } = await open();
    await db.execute("INSERT INTO leads (id, company_id, name, outreach_date) VALUES (?, ?, ?, ?)", ["l1", companyId, "Pet Shop", "2026-11-03"]);

    await rescheduleLead(db, companyId, "l1", "2026-11-10", { role: "comercial" });
    expect(await dateOf(db, companyId, "l1")).toBe("2026-11-10");
    await rescheduleLead(db, companyId, "l1", "12/11/2026", { role: "comercial" });
    expect(await dateOf(db, companyId, "l1")).toBe("2026-11-12");
    await rescheduleLead(db, companyId, "l1", null, { role: "comercial" });
    expect(await dateOf(db, companyId, "l1")).toBeNull();
  });

  it("recusa data inválida, papel sem permissão e lead de outra empresa, sem gravar", async () => {
    const { db, companyId } = await open();
    await db.execute("INSERT INTO leads (id, company_id, name, outreach_date) VALUES (?, ?, ?, ?)", ["l1", companyId, "Pet Shop", "2026-11-03"]);

    await expect(rescheduleLead(db, companyId, "l1", "2026-02-30", { role: "comercial" })).rejects.toThrow(/data/i);
    await expect(rescheduleLead(db, companyId, "l1", "2026-11-10", { role: "atendimento" })).rejects.toThrow(/permissão/i);
    await expect(rescheduleLead(db, "outra", "l1", "2026-11-10", { role: "comercial" })).rejects.toThrow(/não encontrado/i);
    expect(await dateOf(db, companyId, "l1")).toBe("2026-11-03");
  });
});
