// Agenda da empresa em .ics (para importar no Google Agenda ou no Calendário da Apple): eventos criados no app
// (reuniões, ausências) e férias/ausências aprovadas do RH; nada das agendas conectadas por link.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { buildCompanyFeed } from "./feed";
import { parseIcs } from "./ical";

const COMPANY = "test-company";
const NOW = new Date("2026-10-20T15:00:00Z");
const PERIOD = { start: "2026-10-01", end: "2027-01-01" };
const LONG_TITLE = "Reunião de planejamento estratégico com a diretoria, o comercial, o financeiro e a operação — revisão de metas";
let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await insertTestCompany(db, { companyId: COMPANY, name: "TechFlow Sorocaba" });
  await db.execute("INSERT INTO employees (id, company_id, user_id, name) VALUES ('emp-ana', ?, 'test-user-tecnico', 'Ana Souza')", [COMPANY]);
  const request = (id: string, type: string, start: string, end: string, status: string, extra: { reason?: string; deleted?: boolean } = {}) =>
    db.execute("INSERT INTO hr_requests (id, company_id, employee_id, type, start_date, end_date, days, reason, status, deleted_at) VALUES (?, ?, 'emp-ana', ?, ?, ?, 1, ?, ?, ?)", [
      id,
      COMPANY,
      type,
      start,
      end,
      extra.reason ?? null,
      status,
      extra.deleted ? NOW.toISOString() : null,
    ]);
  await request("req-ferias", "ferias", "2026-11-02", "2026-11-13", "aprovada");
  await request("req-atestado", "atestado", "2026-10-21", "2026-10-21", "aprovada", { reason: "gripe forte" });
  await request("req-pendente", "ferias", "2026-12-01", "2026-12-10", "pendente");
  await request("req-recusada", "folga", "2026-10-26", "2026-10-26", "recusada");
  await request("req-excluida", "folga", "2026-10-27", "2026-10-27", "aprovada", { deleted: true });

  const event = (id: string, values: Record<string, unknown>) => {
    const columns = ["id", "company_id", ...Object.keys(values)];
    return db.execute(`INSERT INTO calendar_events (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, [id, COMPANY, ...Object.values(values)]);
  };
  await event("ev-reuniao", { title: "Planejamento", starts_at: "2026-10-22T13:00:00.000Z", ends_at: "2026-10-22T14:00:00.000Z", all_day: 0, kind: "reuniao", location: "Sala 2", description: "Pauta: metas, prazos; orçamento\nSegunda linha" });
  await event("ev-ausencia", { title: "Ausência: Bruno", starts_at: "2026-10-30", ends_at: "2026-10-31", all_day: 1, kind: "ausencia" });
  await event("ev-longo", { title: LONG_TITLE, starts_at: "2026-10-23T12:00:00.000Z", all_day: 0, kind: "reuniao" });
  await event("ev-excluido", { title: "Excluído", starts_at: "2026-10-24T12:00:00.000Z", all_day: 0, kind: "evento", deleted_at: NOW.toISOString() });
  await db.execute("INSERT INTO calendar_sources (id, company_id, name, kind, url) VALUES ('src-google', ?, 'Google', 'ical', 'https://exemplo.com/a.ics')", [COMPANY]);
  await event("ev-externo", { title: "Consulta pessoal", starts_at: "2026-10-25T12:00:00.000Z", all_day: 0, kind: "externo", source_id: "src-google", uid: "x" });
});

afterEach(() => db.close());

describe("buildCompanyFeed", () => {
  it("gera um VCALENDAR válido: CRLF, linhas de até 75 bytes, nome da agenda e UIDs estáveis", async () => {
    const text = await buildCompanyFeed(db, COMPANY, { now: NOW });
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const lines = text.split("\r\n");
    expect(lines.every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(text).toContain("X-WR-CALNAME:TechFlow Sorocaba");
    expect(text).toContain("UID:ev-reuniao@company-manager");
    expect(text).toContain("UID:hr-req-ferias@company-manager");
    expect(await buildCompanyFeed(db, COMPANY, { now: NOW })).toBe(text);
  });

  it("traz reuniões e ausências do app e férias/ausências aprovadas do RH (sem motivo); nada pendente, recusado, excluído ou de agenda conectada", async () => {
    const text = await buildCompanyFeed(db, COMPANY, { now: NOW });
    const items = parseIcs(text, PERIOD);
    expect(items.map((item) => item.title).sort()).toEqual(["Ausência: Ana Souza", "Ausência: Bruno", "Férias: Ana Souza", LONG_TITLE, "Planejamento"].sort());
    expect(text).not.toContain("gripe");
    expect(text).not.toContain("Consulta pessoal");

    const byTitle = (title: string) => items.find((item) => item.title === title);
    // Fim do RH é inclusivo (13/11); no iCal o dia inteiro termina no dia seguinte.
    expect(byTitle("Férias: Ana Souza")).toMatchObject({ start: "2026-11-02", end: "2026-11-14", allDay: true });
    expect(byTitle("Ausência: Ana Souza")).toMatchObject({ start: "2026-10-21", end: "2026-10-22", allDay: true });
    expect(byTitle("Ausência: Bruno")).toMatchObject({ start: "2026-10-30", end: "2026-10-31", allDay: true });
    expect(byTitle("Planejamento")).toMatchObject({
      start: "2026-10-22T13:00:00.000Z",
      end: "2026-10-22T14:00:00.000Z",
      location: "Sala 2",
      description: "Pauta: metas, prazos; orçamento\nSegunda linha",
    });
    expect(byTitle(LONG_TITLE)?.start).toBe("2026-10-23T12:00:00.000Z");
  });

  it("empresa sem eventos gera agenda vazia válida", async () => {
    await insertTestCompany(db, { companyId: "outra", roles: [] });
    const text = await buildCompanyFeed(db, "outra", { now: NOW });
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).not.toContain("BEGIN:VEVENT");
    expect(parseIcs(text, PERIOD)).toEqual([]);
  });
});
