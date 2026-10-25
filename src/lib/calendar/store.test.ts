// Camada de dados do calendário (SQLite real): agendas conectadas e eventos do app com a permissão conferida na
// gravação (não só na tela), itens para o CalendarView e exportação da agenda da empresa.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import type { CalendarEvent, CalendarSource, Role } from "@/types";
import {
  calendarItems,
  canManageEvent,
  canManageSource,
  createLocalEvent,
  deleteLocalEvent,
  deleteSource,
  exportCompanyCalendar,
  listSources,
  loadCalendarData,
  saveLocalEvents,
  saveSources,
  type CalendarActor,
} from "./store";

const COMPANY = "test-company";
const NOW = new Date("2026-10-20T15:00:00Z");
let db: TestDb;

const actor = (role: Role): CalendarActor => ({ companyId: COMPANY, userId: `test-user-${role}`, role });

beforeEach(async () => {
  db = await createTestDb();
  await insertTestCompany(db, { companyId: COMPANY });
});

afterEach(() => db.close());

const sourceRow = async (id: string) => (await db.select<CalendarSource[]>("SELECT * FROM calendar_sources WHERE id = ?", [id]))[0];
const eventRow = async (id: string) => (await db.select<CalendarEvent[]>("SELECT * FROM calendar_events WHERE id = ?", [id]))[0];

describe("agendas conectadas", () => {
  it("quem só pode criar conecta a própria agenda: dono forçado, nome aparado e webcal vira https", async () => {
    const [id] = await saveSources(db, actor("tecnico"), { created: [{ name: "  Minha agenda  ", url: "webcal://p01-caldav.icloud.com/published/2/abc", user_id: "test-user-ceo" }], updated: [] }, { now: NOW });
    expect(await sourceRow(id)).toMatchObject({ name: "Minha agenda", url: "https://p01-caldav.icloud.com/published/2/abc", user_id: "test-user-tecnico", kind: "ical", company_id: COMPANY });
    expect((await listSources(db, COMPANY)).map((source) => source.id)).toEqual([id]);
  });

  it("Auditoria não conecta agenda; nome vazio e link inválido são recusados", async () => {
    await expect(saveSources(db, actor("auditor"), { created: [{ name: "X", url: "https://exemplo.com/a.ics" }], updated: [] })).rejects.toThrow(/permissão/);
    await expect(saveSources(db, actor("tecnico"), { created: [{ name: " ", url: "https://exemplo.com/a.ics" }], updated: [] })).rejects.toThrow(/nome da agenda/);
    await expect(saveSources(db, actor("tecnico"), { created: [{ name: "X", url: "calendario do google" }], updated: [] })).rejects.toThrow(/Link da agenda inválido/);
    expect(await listSources(db, COMPANY)).toEqual([]);
  });

  it("quem não gerencia só altera e exclui a própria agenda; Gerência e RH mexem em todas e põem a agenda na empresa", async () => {
    const [mine] = await saveSources(db, actor("tecnico"), { created: [{ name: "Técnico", url: "https://exemplo.com/t.ics" }], updated: [] });
    const [other] = await saveSources(db, actor("comercial"), { created: [{ name: "Comercial", url: "https://exemplo.com/c.ics" }], updated: [] });
    expect(canManageSource(actor("tecnico"), await sourceRow(mine))).toBe(true);
    expect(canManageSource(actor("tecnico"), await sourceRow(other))).toBe(false);
    expect(canManageSource(actor("gerente"), await sourceRow(other))).toBe(true);

    await saveSources(db, actor("tecnico"), { created: [], updated: [{ id: mine, name: "Técnico (pessoal)" }] });
    expect((await sourceRow(mine)).name).toBe("Técnico (pessoal)");
    await expect(saveSources(db, actor("tecnico"), { created: [], updated: [{ id: other, name: "Invadida" }] })).rejects.toThrow(/só pode alterar/);
    // Mudar o dono para outra pessoa também é coisa de quem gerencia.
    await expect(saveSources(db, actor("tecnico"), { created: [], updated: [{ id: mine, user_id: "test-user-ceo" }] })).rejects.toThrow(/permissão/);

    await saveSources(db, actor("gerente"), { created: [], updated: [{ id: other, user_id: null, name: "Comercial (empresa)" }] });
    expect(await sourceRow(other)).toMatchObject({ user_id: null, name: "Comercial (empresa)" });

    await expect(deleteSource(db, actor("tecnico"), other)).rejects.toThrow(/só pode excluir/);
    await db.execute("INSERT INTO calendar_events (id, company_id, source_id, uid, title, starts_at, all_day, kind) VALUES ('ev-t', ?, ?, 'u1', 'Evento', '2026-10-21T12:00:00.000Z', 0, 'externo')", [COMPANY, mine]);
    await deleteSource(db, actor("tecnico"), mine, { now: NOW });
    expect((await sourceRow(mine)).deleted_at).toBe(NOW.toISOString());
    expect((await eventRow("ev-t")).deleted_at).toBe(NOW.toISOString());
    await deleteSource(db, actor("rh"), other);
    expect(await listSources(db, COMPANY)).toEqual([]);
  });
});

describe("eventos do app", () => {
  it("cria reunião com horário e ausência de dia inteiro; o dono é quem cria (salvo quem gerencia)", async () => {
    const meeting = await createLocalEvent(db, actor("comercial"), { title: "Visita ao cliente", kind: "reuniao", starts_at: "2026-10-22T13:00:00.000Z", ends_at: "2026-10-22T14:00:00.000Z", user_id: "test-user-ceo" }, { now: NOW });
    expect(await eventRow(meeting)).toMatchObject({ title: "Visita ao cliente", kind: "reuniao", all_day: 0, user_id: "test-user-comercial", source_id: null, starts_at: "2026-10-22T13:00:00.000Z" });

    const absence = await createLocalEvent(db, actor("rh"), { title: "Ausência: Bruno", kind: "ausencia", all_day: 1, starts_at: "2026-10-30", ends_at: null, user_id: "test-user-tecnico" });
    expect(await eventRow(absence)).toMatchObject({ all_day: 1, starts_at: "2026-10-30", ends_at: "2026-10-31", user_id: "test-user-tecnico" });
  });

  it("recusa sem permissão, sem título, fim antes do início e tipo de agenda conectada", async () => {
    await expect(createLocalEvent(db, actor("auditor"), { title: "X", starts_at: "2026-10-22T13:00:00.000Z" })).rejects.toThrow(/permissão/);
    await expect(createLocalEvent(db, actor("tecnico"), { title: "", starts_at: "2026-10-22T13:00:00.000Z" })).rejects.toThrow(/título/);
    await expect(createLocalEvent(db, actor("tecnico"), { title: "X", starts_at: "2026-10-22T13:00:00.000Z", ends_at: "2026-10-22T12:00:00.000Z" })).rejects.toThrow(/fim/);
    await expect(createLocalEvent(db, actor("tecnico"), { title: "X", all_day: 1, starts_at: "2026-10-22", ends_at: "2026-10-21" })).rejects.toThrow(/fim/);
    await expect(createLocalEvent(db, actor("tecnico"), { title: "X", kind: "externo", starts_at: "2026-10-22T13:00:00.000Z" })).rejects.toThrow(/tipo/i);
    await expect(createLocalEvent(db, actor("tecnico"), { title: "X", starts_at: "amanhã" })).rejects.toThrow(/início/);
  });

  it("evento de agenda conectada não se edita no app; quem não gerencia só mexe nos próprios", async () => {
    await db.execute("INSERT INTO calendar_sources (id, company_id, name, kind, url) VALUES ('src', ?, 'Google', 'ical', 'https://exemplo.com/a.ics')", [COMPANY]);
    await db.execute("INSERT INTO calendar_events (id, company_id, source_id, uid, title, starts_at, all_day, kind) VALUES ('ev-ext', ?, 'src', 'u1', 'Externo', '2026-10-21T12:00:00.000Z', 0, 'externo')", [COMPANY]);
    const mine = await createLocalEvent(db, actor("tecnico"), { title: "Meu", starts_at: "2026-10-23T12:00:00.000Z" });
    const theirs = await createLocalEvent(db, actor("comercial"), { title: "Deles", starts_at: "2026-10-23T12:00:00.000Z" });

    expect(canManageEvent(actor("gerente"), await eventRow("ev-ext"))).toBe(false);
    await expect(saveLocalEvents(db, actor("gerente"), { created: [], updated: [{ id: "ev-ext", title: "Mudado" }] })).rejects.toThrow(/agenda de origem/);
    await expect(deleteLocalEvent(db, actor("gerente"), "ev-ext")).rejects.toThrow(/agenda de origem/);

    await saveLocalEvents(db, actor("tecnico"), { created: [], updated: [{ id: mine, title: "Meu (novo)" }] }, { now: NOW });
    expect(await eventRow(mine)).toMatchObject({ title: "Meu (novo)", updated_at: NOW.toISOString() });
    await expect(saveLocalEvents(db, actor("tecnico"), { created: [], updated: [{ id: theirs, title: "Invadido" }] })).rejects.toThrow(/só pode alterar/);
    await expect(deleteLocalEvent(db, actor("tecnico"), theirs)).rejects.toThrow(/só pode excluir/);

    await saveLocalEvents(db, actor("gerente"), { created: [{ title: "Novo da gerência", kind: "reuniao", starts_at: "2026-10-24T12:00:00.000Z", user_id: null }], updated: [{ id: theirs, title: "Revisado" }] });
    expect((await eventRow(theirs)).title).toBe("Revisado");
    await deleteLocalEvent(db, actor("tecnico"), mine, { now: NOW });
    expect((await eventRow(mine)).deleted_at).toBe(NOW.toISOString());
  });
});

describe("itens do calendário", () => {
  beforeEach(async () => {
    await db.execute("INSERT INTO calendar_sources (id, company_id, user_id, name, kind, url) VALUES ('src-ana', ?, 'test-user-tecnico', 'Google da Ana', 'ical', 'https://exemplo.com/a.ics')", [COMPANY]);
    await db.execute("INSERT INTO calendar_events (id, company_id, source_id, uid, title, starts_at, ends_at, all_day, user_id, kind) VALUES ('ev-ext', ?, 'src-ana', 'u1', 'Dentista', '2026-10-21T12:00:00.000Z', '2026-10-21T13:00:00.000Z', 0, 'test-user-tecnico', 'externo')", [COMPANY]);
    await db.execute("INSERT INTO calendar_events (id, company_id, title, starts_at, ends_at, all_day, user_id, kind) VALUES ('ev-app', ?, 'Planejamento', '2026-10-22T13:00:00.000Z', '2026-10-22T14:00:00.000Z', 0, NULL, 'reuniao')", [COMPANY]);
    await db.execute("INSERT INTO employees (id, company_id, user_id, name) VALUES ('emp-ana', ?, 'test-user-tecnico', 'Ana Souza'), ('emp-bia', ?, NULL, 'Bia Lima')", [COMPANY, COMPANY]);
    await db.execute("INSERT INTO hr_requests (id, company_id, employee_id, type, start_date, end_date, days, status) VALUES ('req-1', ?, 'emp-ana', 'ferias', '2026-11-02', '2026-11-13', 12, 'aprovada'), ('req-2', ?, 'emp-bia', 'atestado', '2026-10-21', '2026-10-21', 1, 'aprovada'), ('req-3', ?, 'emp-ana', 'folga', '2026-10-26', '2026-10-26', 1, 'pendente')", [COMPANY, COMPANY, COMPANY]);
  });

  it("junta agendas conectadas, eventos do app e ausências aprovadas do RH (fim exclusivo, sem motivo)", async () => {
    const items = calendarItems(await loadCalendarData(db, COMPANY));
    expect(items.map((item) => [item.title, item.origin]).sort()).toEqual([
      ["Ausência: Bia Lima", "rh"],
      ["Dentista", "agenda"],
      ["Férias: Ana Souza", "rh"],
      ["Planejamento", "app"],
    ]);
    expect(items.find((item) => item.title === "Dentista")).toMatchObject({ sourceLabel: "Google da Ana", userId: "test-user-tecnico", kind: "externo" });
    expect(items.find((item) => item.title === "Férias: Ana Souza")).toMatchObject({ start: "2026-11-02", end: "2026-11-14", allDay: true, userId: "test-user-tecnico", sourceLabel: "RH", kind: "ferias" });
    expect(items.find((item) => item.title === "Planejamento")).toMatchObject({ sourceLabel: "Reunião", kind: "reuniao" });
  });

  it("filtro por funcionário mostra só os eventos da pessoa", async () => {
    const items = calendarItems(await loadCalendarData(db, COMPANY), { userId: "test-user-tecnico" });
    expect(items.map((item) => item.title).sort()).toEqual(["Dentista", "Férias: Ana Souza"]);
  });
});

describe("exportar agenda da empresa", () => {
  it("exige a permissão de exportar (Auditoria pode; Comercial não)", async () => {
    await expect(exportCompanyCalendar(db, actor("comercial"))).rejects.toThrow(/permissão/);
    expect(await exportCompanyCalendar(db, actor("auditor"), { now: NOW })).toContain("BEGIN:VCALENDAR");
  });
});
