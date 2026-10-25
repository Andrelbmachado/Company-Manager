// Calendário (rota /calendar): CalendarView com agendas conectadas, eventos do app e ausências do RH; agendas e
// eventos editados no próprio lugar (EditableTable, sem modal); sincroniza ao abrir; exportação da agenda da empresa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { choose, click, findButton, renderPage, type as typeInto, until, type RenderedPage } from "@/test/pageHarness";
import { addDays, todayIn, zonedInstant } from "@/components/shared/calendar/layout";
import { defaultCalendarFetcher } from "@/lib/calendar/fetcher";
import { saveBlobAs } from "@/lib/files/saveAs";
import type { CalendarEvent, CalendarSource, Role } from "@/types";
import CalendarPage from "./CalendarPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock("@/lib/files/saveAs", () => ({ saveBlobAs: vi.fn(async () => "/tmp/agenda-da-empresa.ics") }));
vi.mock("@/lib/calendar/fetcher", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/calendar/fetcher")>()), defaultCalendarFetcher: vi.fn() }));

const testDb = useTestDb();
const COMPANY = "test-company";
const TODAY = todayIn(new Date());
const compact = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:ext-1",
  `DTSTART:${compact(zonedInstant(TODAY, 10 * 60))}`,
  `DTEND:${compact(zonedInstant(TODAY, 11 * 60))}`,
  "SUMMARY:Reunião externa",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");
let page: RenderedPage | null = null;

beforeEach(async () => {
  vi.mocked(saveBlobAs).mockClear();
  vi.mocked(defaultCalendarFetcher)
    .mockReset()
    .mockImplementation(async (url: string) => (url.includes("quebrado") ? new Response("Not Found", { status: 404 }) : new Response(ICS)));
  const db = testDb();
  await insertTestCompany(db, { companyId: COMPANY });
  await db.execute("INSERT INTO calendar_sources (id, company_id, user_id, name, kind, url) VALUES ('src-ok', ?, 'test-user-tecnico', 'Google do técnico', 'ical', 'https://ok.exemplo.com/agenda.ics')", [COMPANY]);
  await db.execute("INSERT INTO calendar_sources (id, company_id, user_id, name, kind, url) VALUES ('src-404', ?, NULL, 'Agenda antiga', 'ical', 'https://quebrado.exemplo.com/agenda.ics')", [COMPANY]);
  await db.execute("INSERT INTO calendar_events (id, company_id, title, starts_at, ends_at, all_day, user_id, kind) VALUES ('ev-plan', ?, 'Planejamento', ?, ?, 0, NULL, 'reuniao')", [
    COMPANY,
    zonedInstant(TODAY, 14 * 60),
    zonedInstant(TODAY, 15 * 60),
  ]);
  await db.execute("INSERT INTO employees (id, company_id, user_id, name) VALUES ('emp-ana', ?, 'test-user-tecnico', 'Ana Souza')", [COMPANY]);
  await db.execute("INSERT INTO hr_requests (id, company_id, employee_id, type, start_date, end_date, days, status) VALUES ('req-1', ?, 'emp-ana', 'ferias', ?, ?, 3, 'aprovada')", [COMPANY, addDays(TODAY, -1), addDays(TODAY, 1)]);
});

afterEach(() => {
  page?.unmount();
  page = null;
});

async function open(role: Role): Promise<RenderedPage> {
  page = await renderPage(<CalendarPage />, { companyId: COMPANY, role, path: "/calendar" });
  await until(() => document.querySelector("[data-calendar-view]") !== null, "calendário");
  return page;
}

const calendarText = () => document.querySelector("[data-calendar-view]")?.textContent ?? "";
const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((item) => item.textContent?.trim() === label);
/** Botão dentro do painel de uma aba (as abas ficam montadas; as escondidas também têm Editar/Adicionar). */
const panelButton = (panel: "calendario" | "agendas" | "eventos", label: string) => {
  const element = document.getElementById(`painel-calendario-${panel}`);
  return element ? findButton(element, label) : undefined;
};
const sources = () => testDb().select<CalendarSource[]>("SELECT * FROM calendar_sources WHERE deleted_at IS NULL ORDER BY name");
const events = () => testDb().select<CalendarEvent[]>("SELECT * FROM calendar_events WHERE deleted_at IS NULL ORDER BY title");
// O Blob do jsdom não tem text(): lê pelo FileReader.
const blobText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

describe("CalendarPage", () => {
  it("sincroniza ao abrir e mostra agendas conectadas, eventos do app e férias do RH; a agenda que falhou mostra o erro", async () => {
    await open("gerente");
    await until(() => calendarText().includes("Reunião externa"), "evento da agenda conectada");
    expect(defaultCalendarFetcher).toHaveBeenCalledWith("https://ok.exemplo.com/agenda.ics", expect.anything());
    expect(calendarText()).toContain("Planejamento");
    expect(calendarText()).toContain("Férias: Ana Souza");
    await until(() => page!.text().includes("1 agenda com erro"), "aviso da agenda com erro");

    await click(tab("Agendas conectadas"));
    await until(() => document.querySelector("tr[data-row-key='src-404']")?.textContent?.includes("Agenda não encontrada (404)") ?? false, "erro na linha da agenda");
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("filtro por funcionário mostra só os eventos da pessoa", async () => {
    await open("gerente");
    await until(() => calendarText().includes("Reunião externa"), "evento da agenda conectada");
    await until(() => document.querySelector("select[aria-label='Funcionário'] option[value='test-user-tecnico']") !== null, "lista de pessoas");
    await choose(document.querySelector("select[aria-label='Funcionário']"), "test-user-tecnico");
    await until(() => !calendarText().includes("Planejamento"), "evento da empresa sai do filtro");
    expect(calendarText()).toContain("Reunião externa");
    expect(calendarText()).toContain("Férias: Ana Souza");
  });

  it("Auditoria não adiciona nem edita agendas, mas exporta a agenda da empresa; Comercial não exporta", async () => {
    await open("auditor");
    const exportButton = () => page!.button("Exportar agenda da empresa");
    expect(exportButton()?.disabled).toBe(false);
    await click(exportButton());
    await until(() => vi.mocked(saveBlobAs).mock.calls.length === 1, "arquivo salvo");
    const [blob, name] = vi.mocked(saveBlobAs).mock.calls[0];
    expect(name).toBe("agenda-da-empresa.ics");
    expect(await blobText(blob as Blob)).toContain("SUMMARY:Planejamento");

    await click(tab("Agendas conectadas"));
    await until(() => panelButton("agendas", "Adicionar") !== undefined, "tabela de agendas");
    expect(panelButton("agendas", "Adicionar")?.disabled).toBe(true);
    expect(panelButton("agendas", "Editar")?.disabled).toBe(true);
    await click(tab("Eventos do app"));
    expect(panelButton("eventos", "Adicionar")?.disabled).toBe(true);
    expect(panelButton("eventos", "Editar")?.disabled).toBe(true);
    page!.unmount();

    page = await renderPage(<CalendarPage />, { companyId: COMPANY, role: "comercial", path: "/calendar" });
    await until(() => page!.button("Exportar agenda da empresa") !== undefined, "botão exportar");
    expect(page!.button("Exportar agenda da empresa")?.disabled).toBe(true);
    expect(page!.button("Exportar agenda da empresa")?.title).toMatch(/permissão/);
  });

  it("técnico conecta a própria agenda na tabela (sem modal): grava no nome dele e sincroniza", async () => {
    await open("tecnico");
    await click(tab("Agendas conectadas"));
    await until(() => panelButton("agendas", "Adicionar") !== undefined, "tabela de agendas");
    await click(panelButton("agendas", "Adicionar"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await typeInto(document.querySelector("input[aria-label='Nome (nova linha)']"), "Meu iCloud");
    await typeInto(document.querySelector("input[aria-label='Link iCal (nova linha)']"), "webcal://p01-caldav.icloud.com/published/2/meu");
    await click(panelButton("agendas", "Salvar"));

    await until(async () => (await sources()).some((source) => source.name === "Meu iCloud"), "agenda gravada");
    const saved = (await sources()).find((source) => source.name === "Meu iCloud")!;
    expect(saved).toMatchObject({ user_id: "test-user-tecnico", url: "https://p01-caldav.icloud.com/published/2/meu" });
    await until(() => vi.mocked(defaultCalendarFetcher).mock.calls.some(([url]) => url === "https://p01-caldav.icloud.com/published/2/meu"), "sincronizou a agenda nova");
    await until(async () => (await events()).some((event) => event.source_id === saved.id), "eventos da agenda nova");
  });

  it("clicar num dia vazio abre o formulário no próprio lugar e cria o evento no nome de quem criou", async () => {
    await open("tecnico");
    await click(document.querySelector(`[data-day='${TODAY}']`));
    const title = () => document.querySelector<HTMLInputElement>("input[aria-label='Título do novo evento']");
    await until(() => title() !== null, "formulário do novo evento");
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await typeInto(title(), "Visita técnica");
    await choose(document.querySelector("select[aria-label='Tipo do novo evento']"), "ausencia");
    await click(page!.button("Criar evento"));

    await until(async () => (await events()).some((event) => event.title === "Visita técnica"), "evento gravado");
    expect((await events()).find((event) => event.title === "Visita técnica")).toMatchObject({ all_day: 1, starts_at: TODAY, ends_at: addDays(TODAY, 1), user_id: "test-user-tecnico", kind: "ausencia", source_id: null });
    await until(() => calendarText().includes("Visita técnica"), "evento no calendário");
  });

  it("Eventos do app: editar a hora na tabela grava o horário de São Paulo", async () => {
    await open("gerente");
    await click(tab("Eventos do app"));
    await until(() => document.querySelector("tr[data-row-key='ev-plan']") !== null, "tabela de eventos");
    await click(panelButton("eventos", "Editar"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await typeInto(document.querySelector("tr[data-row-key='ev-plan'] input[aria-label^='Hora de início']"), "15h30");
    await typeInto(document.querySelector("tr[data-row-key='ev-plan'] input[aria-label^='Hora de fim']"), "16:45");
    await click(panelButton("eventos", "Salvar"));
    await until(async () => (await events()).find((event) => event.id === "ev-plan")?.starts_at === zonedInstant(TODAY, 15 * 60 + 30), "hora gravada");
    expect((await events()).find((event) => event.id === "ev-plan")?.ends_at).toBe(zonedInstant(TODAY, 16 * 60 + 45));
  });

  it("Eventos do app: hora inválida ou fim antes do início não grava e mantém o rascunho", async () => {
    await open("gerente");
    await click(tab("Eventos do app"));
    await until(() => document.querySelector("tr[data-row-key='ev-plan']") !== null, "tabela de eventos");
    await click(panelButton("eventos", "Editar"));
    await typeInto(document.querySelector("tr[data-row-key='ev-plan'] input[aria-label^='Hora de início']"), "25:99");
    await click(panelButton("eventos", "Salvar"));
    await until(() => document.querySelector("[role=alert]")?.textContent?.includes("Hora inválida") ?? false, "erro da hora");
    await typeInto(document.querySelector("tr[data-row-key='ev-plan'] input[aria-label^='Hora de início']"), "16:00");
    await click(panelButton("eventos", "Salvar"));
    await until(() => document.querySelector("[role=alert]")?.textContent?.includes("depois do início") ?? false, "erro do fim");
    expect((await events()).find((event) => event.id === "ev-plan")?.starts_at).toBe(zonedInstant(TODAY, 14 * 60));
  });

  it("trocar de aba com alterações não salvas não perde o rascunho em silêncio", async () => {
    await open("gerente");
    await click(tab("Eventos do app"));
    await until(() => document.querySelector("tr[data-row-key='ev-plan']") !== null, "tabela de eventos");
    await click(panelButton("eventos", "Editar"));
    const titleField = () => document.querySelector<HTMLInputElement>("tr[data-row-key='ev-plan'] input[aria-label^='Título']");
    await typeInto(titleField(), "Planejamento trimestral");
    await click(tab("Calendário"));
    await click(tab("Agendas conectadas"));
    await click(tab("Eventos do app"));
    expect(titleField()?.value).toBe("Planejamento trimestral");
    await click(panelButton("eventos", "Salvar"));
    await until(async () => (await events()).find((event) => event.id === "ev-plan")?.title === "Planejamento trimestral", "título gravado");
  });
});
