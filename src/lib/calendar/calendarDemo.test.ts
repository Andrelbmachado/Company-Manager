// @vitest-environment jsdom
// O calendário também funciona no banco demo do navegador (SQL nos padrões do demo.ts): sincronizar, gravar eventos
// do app, ler os itens e exportar a agenda da empresa.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID } from "@/lib/db/demo";
import type { CalendarSource } from "@/types";
import { parseIcs } from "./ical";
import { calendarItems, createLocalEvent, deleteLocalEvent, deleteSource, exportCompanyCalendar, listSources, loadCalendarData, saveLocalEvents, saveSources, type CalendarActor } from "./store";
import { syncCompanySources, syncSource, type CalendarFetcher } from "./sync";

const NOW = new Date("2026-10-20T15:00:00Z");
// No jsdom o URL global é o do jsdom; o caminho vem do import.meta.url como texto.
const ICS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/google-semanal.ics"), "utf8");
const ceo: CalendarActor = { companyId: DEMO_COMPANY_ID, userId: "demo-ceo", role: "ceo" };
const ok: CalendarFetcher = async () => new Response(ICS);

beforeEach(() => localStorage.clear());

describe("calendário no banco demo", () => {
  it("conecta, sincroniza sem duplicar, registra erro, cria/edita/exclui evento do app, lê itens e exporta", async () => {
    const db = createDemoDb();
    const [sourceId] = await saveSources(db, ceo, { created: [{ name: "Equipe", url: "webcal://exemplo.com/equipe.ics" }], updated: [] }, { now: NOW });

    const first = await syncSource(db, sourceId, ok, { now: NOW });
    expect(first.error).toBeUndefined();
    expect(first.added).toBeGreaterThan(40);
    // Relido do localStorage (outra aba / recarregar a página): nada duplica.
    expect(await syncSource(createDemoDb(), sourceId, ok, { now: NOW })).toEqual({ added: 0, updated: 0, removed: 0 });

    const failed = await syncSource(db, sourceId, async () => new Response("Not Found", { status: 404 }), { now: NOW });
    expect(failed.error).toMatch(/404/);
    expect((await listSources(createDemoDb(), DEMO_COMPANY_ID))[0]).toMatchObject<Partial<CalendarSource>>({ last_error: failed.error });
    expect(await syncCompanySources(db, DEMO_COMPANY_ID, ok, { now: NOW, olderThanMinutes: 15 })).toHaveLength(1);

    const meeting = await createLocalEvent(db, ceo, { title: "Planejamento", kind: "reuniao", starts_at: "2026-10-22T13:00:00.000Z", ends_at: "2026-10-22T14:00:00.000Z" }, { now: NOW });
    await saveLocalEvents(db, ceo, { created: [{ title: "Ausência: Bruno", kind: "ausencia", all_day: 1, starts_at: "2026-10-30" }], updated: [{ id: meeting, title: "Planejamento anual" }] }, { now: NOW });

    const items = calendarItems(await loadCalendarData(createDemoDb(), DEMO_COMPANY_ID));
    expect(items.filter((item) => item.title === "Reunião semanal").length).toBeGreaterThan(40);
    expect(items.find((item) => item.title === "Planejamento anual")).toMatchObject({ origin: "app", start: "2026-10-22T13:00:00.000Z" });

    const feed = await exportCompanyCalendar(db, ceo, { now: NOW });
    const exported = parseIcs(feed, { start: "2026-10-01", end: "2026-11-01" }).map((item) => item.title);
    expect(exported).toEqual(expect.arrayContaining(["Planejamento anual", "Ausência: Bruno"]));
    expect(exported).not.toContain("Reunião semanal");

    await deleteLocalEvent(db, ceo, meeting, { now: NOW });
    await saveSources(db, ceo, { created: [], updated: [{ id: sourceId, user_id: null, name: "Equipe (empresa)" }] }, { now: NOW });
    await deleteSource(db, ceo, sourceId, { now: NOW });
    const after = calendarItems(await loadCalendarData(createDemoDb(), DEMO_COMPANY_ID));
    expect(after.some((item) => item.title === "Planejamento anual" || item.title === "Reunião semanal")).toBe(false);
    expect(await listSources(createDemoDb(), DEMO_COMPANY_ID)).toEqual([]);
  });
});
