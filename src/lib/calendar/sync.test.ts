// Sincronização de uma agenda por link iCal com calendar_events (SQLite real): upsert por uid, sem duplicar,
// removido na fonte some, erro legível na fonte sem apagar o que já estava gravado.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import type { CalendarEvent, CalendarSource } from "@/types";
import { normalizeCalendarUrl, syncCompanySources, syncSource, syncWindow, type CalendarFetcher } from "./sync";

const COMPANY = "test-company";
const NOW = new Date("2026-10-20T15:00:00Z");
let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await insertTestCompany(db, { companyId: COMPANY });
  await addSource("src-1", "webcal://exemplo.com/agenda.ics", "test-user-tecnico");
});

afterEach(() => db.close());

async function addSource(id: string, url: string, userId: string | null = null) {
  await db.execute("INSERT INTO calendar_sources (id, company_id, user_id, name, kind, url) VALUES (?, ?, ?, ?, 'ical', ?)", [id, COMPANY, userId, `Agenda ${id}`, url]);
}

const vevent = (uid: string, lines: string[]) => ["BEGIN:VEVENT", `UID:${uid}`, ...lines, "END:VEVENT"];
const calendar = (...events: string[][]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Teste//PT", ...events.flat(), "END:VCALENDAR"].join("\r\n");
const respond = (body: string, status = 200): CalendarFetcher => vi.fn(async () => new Response(body, { status }));

const WEEKLY = vevent("semanal", ["DTSTART;TZID=America/Sao_Paulo:20261006T090000", "DTEND;TZID=America/Sao_Paulo:20261006T100000", "RRULE:FREQ=WEEKLY;COUNT=4", "SUMMARY:Reunião semanal"]);
const SINGLE = vevent("pontual", ["DTSTART:20261015T170000Z", "DTEND:20261015T180000Z", "SUMMARY:Call com cliente", "LOCATION:Online"]);
const ALL_DAY = vevent("folga", ["DTSTART;VALUE=DATE:20261012", "DTEND;VALUE=DATE:20261013", "SUMMARY:Folga"]);

const events = (sourceId = "src-1") => db.select<CalendarEvent[]>("SELECT * FROM calendar_events WHERE source_id = ? AND deleted_at IS NULL ORDER BY starts_at, title", [sourceId]);
const source = async (id = "src-1") => (await db.select<CalendarSource[]>("SELECT * FROM calendar_sources WHERE id = ?", [id]))[0];

describe("syncSource", () => {
  it("primeira vez grava as ocorrências com o dono da agenda; sincronizar de novo não duplica", async () => {
    const fetcher = respond(calendar(WEEKLY, SINGLE, ALL_DAY));
    expect(await syncSource(db, "src-1", fetcher, { now: NOW })).toEqual({ added: 6, updated: 0, removed: 0 });
    expect(fetcher).toHaveBeenCalledWith("https://exemplo.com/agenda.ics", expect.anything());

    const rows = await events();
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.user_id === "test-user-tecnico" && row.kind === "externo" && row.company_id === COMPANY)).toBe(true);
    expect(rows.find((row) => row.title === "Folga")).toMatchObject({ starts_at: "2026-10-12", ends_at: "2026-10-13", all_day: 1 });
    expect(rows.find((row) => row.title === "Call com cliente")).toMatchObject({ starts_at: "2026-10-15T17:00:00.000Z", ends_at: "2026-10-15T18:00:00.000Z", all_day: 0, location: "Online" });
    expect(rows.filter((row) => row.title === "Reunião semanal").map((row) => row.starts_at)).toEqual([
      "2026-10-06T12:00:00.000Z",
      "2026-10-13T12:00:00.000Z",
      "2026-10-20T12:00:00.000Z",
      "2026-10-27T12:00:00.000Z",
    ]);
    const synced = await source();
    expect(synced.last_error).toBeNull();
    expect(synced.last_sync_at).toBe(NOW.toISOString());

    expect(await syncSource(db, "src-1", fetcher, { now: NOW })).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(await db.select<{ n: number }[]>("SELECT count(*) AS n FROM calendar_events")).toEqual([{ n: 6 }]);
  });

  it("evento alterado na fonte é atualizado, removido some (soft delete) e novo entra", async () => {
    await syncSource(db, "src-1", respond(calendar(SINGLE, ALL_DAY)), { now: NOW });
    const renamed = vevent("pontual", ["DTSTART:20261015T170000Z", "DTEND:20261015T183000Z", "SUMMARY:Call com cliente (remarcada)"]);
    const added = vevent("novo", ["DTSTART:20261101T120000Z", "SUMMARY:Novo evento"]);
    expect(await syncSource(db, "src-1", respond(calendar(renamed, added)), { now: NOW })).toEqual({ added: 1, updated: 1, removed: 1 });

    expect((await events()).map((row) => row.title)).toEqual(["Call com cliente (remarcada)", "Novo evento"]);
    const gone = await db.select<CalendarEvent[]>("SELECT * FROM calendar_events WHERE uid = 'folga'");
    expect(gone[0].deleted_at).toBeTruthy();
    expect((await events()).find((row) => row.uid === "pontual")).toMatchObject({ ends_at: "2026-10-15T18:30:00.000Z", location: null });
  });

  it("URL que responde 404 grava last_error e não apaga os eventos antigos; a próxima sincronização boa limpa o erro", async () => {
    await syncSource(db, "src-1", respond(calendar(SINGLE, ALL_DAY)), { now: NOW });
    const later = new Date("2026-10-20T16:00:00Z");
    const result = await syncSource(db, "src-1", respond("Not Found", 404), { now: later });
    expect(result).toMatchObject({ added: 0, updated: 0, removed: 0 });
    expect(result.error).toMatch(/404/);
    expect(result.error).toMatch(/não encontrada/i);

    const failed = await source();
    expect(failed.last_error).toBe(result.error);
    expect(failed.last_sync_at).toBe(NOW.toISOString());
    expect(await events()).toHaveLength(2);

    await syncSource(db, "src-1", respond(calendar(SINGLE, ALL_DAY)), { now: later });
    expect((await source()).last_error).toBeNull();
  });

  it("sem internet, página da web no lugar da agenda, acesso negado e link inválido dão erro legível", async () => {
    const offline: CalendarFetcher = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect((await syncSource(db, "src-1", offline, { now: NOW })).error).toMatch(/Não foi possível acessar o link/);
    expect((await syncSource(db, "src-1", respond("<!DOCTYPE html><html><body>Login</body></html>"), { now: NOW })).error).toMatch(/página da web/);
    expect((await syncSource(db, "src-1", respond("Forbidden", 403), { now: NOW })).error).toMatch(/Acesso negado/);
    expect((await syncSource(db, "src-1", respond("erro", 503), { now: NOW })).error).toMatch(/fora do ar/);

    await addSource("src-ftp", "ftp://exemplo.com/agenda.ics");
    const never = respond(calendar(SINGLE));
    expect((await syncSource(db, "src-ftp", never, { now: NOW })).error).toMatch(/link/i);
    expect(never).not.toHaveBeenCalled();
    expect((await source("src-ftp")).last_error).toMatch(/link/i);
  });

  it("evento que já terminou antes da janela fica como histórico mesmo fora do arquivo", async () => {
    await db.execute(
      "INSERT INTO calendar_events (id, company_id, source_id, uid, title, starts_at, ends_at, all_day, kind) VALUES ('velho', ?, 'src-1', 'velho', 'Evento de 2025', '2025-03-10T17:00:00.000Z', '2025-03-10T18:00:00.000Z', 0, 'externo')",
      [COMPANY],
    );
    expect(await syncSource(db, "src-1", respond(calendar(SINGLE)), { now: NOW })).toEqual({ added: 1, updated: 0, removed: 0 });
    expect((await events()).map((row) => row.uid)).toEqual(["velho", "pontual"]);
  });

  it("duas sincronizações ao mesmo tempo da mesma agenda não duplicam", async () => {
    const fetcher = respond(calendar(WEEKLY, SINGLE));
    const [first, second] = await Promise.all([syncSource(db, "src-1", fetcher, { now: NOW }), syncSource(db, "src-1", fetcher, { now: NOW })]);
    expect(first.error ?? second.error).toBeUndefined();
    expect(await events()).toHaveLength(5);
  });

  it("agenda excluída ou de outro tipo não sincroniza", async () => {
    await db.execute("UPDATE calendar_sources SET deleted_at = ? WHERE id = 'src-1'", [NOW.toISOString()]);
    await expect(syncSource(db, "src-1", respond(calendar(SINGLE)), { now: NOW })).rejects.toThrow(/Agenda não encontrada/);
  });
});

describe("syncCompanySources", () => {
  it("uma agenda com erro não impede as outras; olderThanMinutes pula as sincronizadas há pouco", async () => {
    await addSource("src-2", "https://outro.exemplo.com/agenda.ics", null);
    const fetcher: CalendarFetcher = vi.fn(async (url: string) => (url.includes("outro") ? new Response(calendar(SINGLE, ALL_DAY)) : new Response("Not Found", { status: 404 })));
    const results = await syncCompanySources(db, COMPANY, fetcher, { now: NOW });
    expect(results.map((entry) => [entry.sourceId, entry.result.added, Boolean(entry.result.error)])).toEqual([
      ["src-1", 0, true],
      ["src-2", 2, false],
    ]);
    expect((await events("src-2")).every((row) => row.user_id === null)).toBe(true);

    vi.mocked(fetcher).mockClear();
    const soon = new Date(NOW.getTime() + 5 * 60_000);
    const again = await syncCompanySources(db, COMPANY, fetcher, { now: soon, olderThanMinutes: 15 });
    // src-2 sincronizou há 5 min; src-1 nunca sincronizou com sucesso, então tenta de novo.
    expect(again.map((entry) => entry.sourceId)).toEqual(["src-1"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("apoio", () => {
  it("normalizeCalendarUrl troca webcal por https e recusa o que não é http(s)", () => {
    expect(normalizeCalendarUrl(" webcal://p01-caldav.icloud.com/published/2/abc ")).toBe("https://p01-caldav.icloud.com/published/2/abc");
    expect(normalizeCalendarUrl("webcals://exemplo.com/a.ics")).toBe("https://exemplo.com/a.ics");
    expect(normalizeCalendarUrl("https://calendar.google.com/calendar/ical/x/basic.ics")).toBe("https://calendar.google.com/calendar/ical/x/basic.ics");
    expect(normalizeCalendarUrl("ftp://exemplo.com")).toBeNull();
    expect(normalizeCalendarUrl("calendario")).toBeNull();
    expect(normalizeCalendarUrl("")).toBeNull();
  });

  it("syncWindow vai de 90 dias antes a 1 ano depois de hoje (São Paulo)", () => {
    expect(syncWindow(NOW)).toEqual({ start: "2026-07-22", end: "2027-10-21" });
  });
});
