// Prospecção com várias campanhas: seletor no topo, "Nova prospecção" e renomear no próprio lugar, cards só com título
// e número da campanha escolhida, cronograma no CalendarView (SQLite real).
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { choose, click, findButton, plain, renderPage, type, until, type RenderedPage } from "@/test/pageHarness";
import { defaultCampaignId } from "@/lib/prospecting/campaigns";
import type { Lead, ProspectingCampaign, Role } from "@/types";
import LeadsPage from "./LeadsPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
let page: RenderedPage | null = null;
afterEach(() => {
  page?.unmount();
  page = null;
});

const OTHER = "camp-advogados";

async function seed(): Promise<string> {
  const db = testDb();
  const { companyId } = await insertTestCompany(db);
  const first = defaultCampaignId(companyId);
  await db.execute("INSERT INTO prospecting_campaigns (id, company_id, name, created_at) VALUES (?, ?, ?, ?)", [first, companyId, "Prospecção 1", "2026-09-01T10:00:00.000Z"]);
  await db.execute("INSERT INTO prospecting_campaigns (id, company_id, name, created_at) VALUES (?, ?, ?, ?)", [OTHER, companyId, "Advogados", "2026-10-01T10:00:00.000Z"]);
  const lead = (id: string, name: string, status: string, revenue: number, campaign: string, date: string | null, rank: number) =>
    db.execute(
      "INSERT INTO leads (id, company_id, name, status, estimated_revenue, campaign_id, outreach_date, outreach_day, priority_rank, presence_kind, whatsapp) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [id, companyId, name, status, revenue, campaign, date, date ? rank : null, rank, "site_quebrado", "(15) 99876-5432"],
    );
  await lead("a1", "Pet Shop Alfa", "novo", 1000, first, "2026-11-03", 1);
  await lead("a2", "Clínica Beta", "abordado", 2000, first, "2026-11-04", 2);
  await lead("a3", "Buffet Gama", "fechado", 3000, first, null, 3);
  await lead("b1", "Escritório Silva", "interessado", 5000, OTHER, "2026-11-05", 1);
  return companyId;
}

async function open(role: Role = "comercial"): Promise<{ companyId: string; page: RenderedPage }> {
  const companyId = await seed();
  page = await renderPage(<LeadsPage />, { companyId, role, path: "/leads" });
  return { companyId, page };
}

function cards(container: HTMLElement): { title: string; value: string; childCount: number; text: string }[] {
  return [...container.querySelectorAll<HTMLElement>(".kpi-card")].map((card) => ({
    title: plain(card.firstElementChild?.textContent),
    value: plain(card.querySelector("[data-kpi-value]")?.textContent),
    childCount: card.children.length,
    text: plain(card.textContent),
  }));
}

const kpi = (container: HTMLElement, title: string) => cards(container).find((card) => card.title === title)?.value;
const campaignSelect = (container: HTMLElement) => container.querySelector<HTMLSelectElement>('select[aria-label="Prospecção"]');

const FIXED_TEXTS = [
  "Sorocaba",
  "sem site",
  "Pacotes e cronograma",
  "implantação + 12 mensalidades",
  "preço da proposta",
  "com sites quebrados",
  "com site quebrado",
  "com WhatsApp",
  "abordados / interessados / fechados",
  "abordagens por dia útil",
  "por dia útil",
];

describe("Prospecção: várias campanhas e cards enxutos", () => {
  it("cards só com título e número da campanha escolhida, sem os textos fixos antigos", async () => {
    const { page } = await open();
    await until(() => kpi(page.container, "Leads") === "3" && page.text().includes("Pet Shop Alfa"), "cards da Prospecção 1");

    const list = cards(page.container);
    expect(list.map((card) => card.title)).toEqual(["Leads", "Abordados", "Fechados", "Potencial no 1º ano"]);
    for (const card of list) {
      expect(card.childCount).toBe(2);
      expect(card.text).toBe(card.title + card.value);
    }
    expect(kpi(page.container, "Abordados")).toBe("2");
    expect(kpi(page.container, "Fechados")).toBe("1");
    expect(kpi(page.container, "Potencial no 1º ano")).toBe("R$ 6.000");
    expect(campaignSelect(page.container)?.value).toBeTruthy();
    expect(page.text()).not.toContain("Escritório Silva");
    for (const fixed of FIXED_TEXTS) expect(page.text()).not.toContain(fixed);
  });

  it("trocar a campanha no seletor filtra os cards e a lista de leads", async () => {
    const { page } = await open();
    await until(() => kpi(page.container, "Leads") === "3", "cards da Prospecção 1");

    await choose(campaignSelect(page.container), OTHER);
    await until(() => kpi(page.container, "Leads") === "1" && page.text().includes("Escritório Silva"), "cards de Advogados");
    expect(kpi(page.container, "Abordados")).toBe("1");
    expect(kpi(page.container, "Fechados")).toBe("0");
    expect(kpi(page.container, "Potencial no 1º ano")).toBe("R$ 5.000");
    expect(page.text()).not.toContain("Pet Shop Alfa");
  });

  it("Nova prospecção pede o nome no próprio lugar (sem diálogo) e abre a campanha vazia", async () => {
    const { companyId, page } = await open();
    await until(() => kpi(page.container, "Leads") === "3", "cards da Prospecção 1");

    await click(page.button("Nova prospecção"));
    const input = page.container.querySelector<HTMLInputElement>('input[aria-label="Nome da nova prospecção"]');
    expect(input?.value).toBe("Prospecção 3");
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await type(input, "Imobiliárias");
    await click(page.button("Criar"));

    await until(async () => (await testDb().select<ProspectingCampaign[]>("SELECT * FROM prospecting_campaigns WHERE company_id=? AND name=?", [companyId, "Imobiliárias"])).length === 1, "campanha gravada");
    const [created] = await testDb().select<ProspectingCampaign[]>("SELECT * FROM prospecting_campaigns WHERE company_id=? AND name=?", [companyId, "Imobiliárias"]);
    await until(() => campaignSelect(page.container)?.value === created!.id && kpi(page.container, "Leads") === "0", "campanha nova escolhida");
    expect(kpi(page.container, "Potencial no 1º ano")).toBe("R$ 0");
    expect(page.text()).not.toContain("Pet Shop Alfa");
    // Campanha nova: lista vazia curta, sem o texto antigo do seed ("primeiro acesso do CEO...").
    await until(() => page.text().includes("Nenhum lead"), "lista vazia da campanha nova");
    expect(page.text()).not.toContain("primeiro acesso");
  });

  it("Adicionar na tabela de leads grava o lead na campanha escolhida no topo", async () => {
    const { companyId, page } = await open();
    await until(() => kpi(page.container, "Leads") === "3", "cards da Prospecção 1");
    await choose(campaignSelect(page.container), OTHER);
    await until(() => page.text().includes("Escritório Silva"), "leads de Advogados");

    const table = () => page.container.querySelector<HTMLElement>('[data-editable-table="leads"]')!;
    await click(findButton(table(), "Adicionar"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await type(table().querySelector('[aria-label="Lead (nova linha)"]'), "Advocacia Souza");
    await click(findButton(table(), "Salvar"));

    const created = async () => (await testDb().select<Lead[]>("SELECT * FROM leads WHERE company_id=? AND name=?", [companyId, "Advocacia Souza"]))[0];
    await until(async () => !!(await created()), "lead gravado");
    expect((await created())!.campaign_id).toBe(OTHER);
    await until(() => kpi(page.container, "Leads") === "2", "card da campanha com o lead novo");
  });

  it("nome repetido aparece como erro no próprio campo e nada é gravado", async () => {
    const { companyId, page } = await open();
    await until(() => kpi(page.container, "Leads") === "3", "cards da Prospecção 1");

    await click(page.button("Nova prospecção"));
    await type(page.container.querySelector('input[aria-label="Nome da nova prospecção"]'), " advogados ");
    await click(page.button("Criar"));
    await until(() => !!page.container.querySelector("[role=alert]"), "erro do nome");
    expect(plain(page.container.querySelector("[role=alert]")?.textContent)).toMatch(/já existe/i);
    expect(await testDb().select("SELECT * FROM prospecting_campaigns WHERE company_id=?", [companyId])).toHaveLength(2);
  });

  it("renomear a campanha no próprio lugar muda só o nome: os leads continuam nela", async () => {
    const { companyId, page } = await open();
    await until(() => kpi(page.container, "Leads") === "3", "cards da Prospecção 1");

    await click(page.button("Renomear prospecção"));
    const input = page.container.querySelector<HTMLInputElement>('input[aria-label="Nome da prospecção"]');
    expect(input?.value).toBe("Prospecção 1");
    await type(input, "Clínicas e pet shops");
    await click(page.button("Salvar"));

    const first = defaultCampaignId(companyId);
    await until(async () => (await testDb().select<ProspectingCampaign[]>("SELECT * FROM prospecting_campaigns WHERE id=?", [first]))[0]?.name === "Clínicas e pet shops", "nome gravado");
    await until(() => [...(campaignSelect(page.container)?.options ?? [])].some((option) => option.text === "Clínicas e pet shops"), "seletor com o nome novo");
    const leads = await testDb().select<Lead[]>("SELECT * FROM leads WHERE company_id=? ORDER BY id ASC", [companyId]);
    expect(leads.map((lead) => lead.campaign_id)).toEqual([first, first, first, OTHER]);
    expect(kpi(page.container, "Leads")).toBe("3");
  });

  it("papel sem permissão vê Nova prospecção e Renomear desativados, com dica", async () => {
    const { page } = await open("auditor");
    await until(() => !!campaignSelect(page.container)?.value, "seletor de campanha");
    const create = page.button("Nova prospecção");
    const rename = page.button("Renomear prospecção");
    expect(create?.disabled).toBe(true);
    expect(rename?.disabled).toBe(true);
    expect(create?.title).toMatch(/permissão/i);
    expect(rename?.title).toMatch(/permissão/i);
  });

  it("previsão de receita calcula na hora só com os leads da campanha escolhida, em cards só com título e número", async () => {
    const companyId = await seed();
    await testDb().execute("INSERT INTO revenue_scenarios (id, company_id, code, label, conversion_rate) VALUES (?, ?, ?, ?, ?)", ["s5", companyId, "c5", "Conservador (5%)", 0.05]);
    await testDb().execute("INSERT INTO revenue_scenarios (id, company_id, code, label, conversion_rate) VALUES (?, ?, ?, ?, ?)", ["s20", companyId, "c20", "Otimista (20%)", 0.2]);
    const rendered = await renderPage(<LeadsPage />, { companyId, role: "comercial", path: "/leads" });
    page = rendered;
    await until(() => kpi(rendered.container, "Leads") === "3", "cards da Prospecção 1");

    await click(rendered.button("Previsão de receita"));
    await until(() => kpi(rendered.container, "Conservador (5%)") === "R$ 300", "previsão da Prospecção 1 (R$ 6.000 × 5%)");
    expect(kpi(rendered.container, "Otimista (20%)")).toBe("R$ 1.200");
    for (const card of cards(rendered.container)) {
      expect(card.childCount).toBe(2);
      expect(card.text).toBe(card.title + card.value);
    }
    for (const fixed of FIXED_TEXTS) expect(rendered.text()).not.toContain(fixed);
    expect(rendered.button("Recalcular a partir dos leads")).toBeUndefined();

    await choose(campaignSelect(rendered.container), OTHER);
    await until(() => kpi(rendered.container, "Conservador (5%)") === "R$ 250", "previsão de Advogados (R$ 5.000 × 5%)");
    expect(kpi(rendered.container, "Otimista (20%)")).toBe("R$ 1.000");
  });

  it("cronograma em calendário mostra só os leads da campanha e remarca a abordagem no próprio lugar", async () => {
    const { companyId, page } = await open();
    await until(() => kpi(page.container, "Leads") === "3", "cards da Prospecção 1");

    await click(page.button("Cronograma de abordagem"));
    await until(() => !!page.container.querySelector("[data-calendar-view]") && !!page.container.querySelector('[data-item-id="a1"]'), "calendário com os leads");
    expect(page.container.querySelector('[data-item-id="a2"]')).not.toBeNull();
    expect(page.container.querySelector('[data-item-id="b1"]')).toBeNull();
    expect(page.container.querySelector('[data-item-id="a3"]')).toBeNull();
    for (const fixed of FIXED_TEXTS) expect(page.text()).not.toContain(fixed);

    await click(page.container.querySelector('[data-item-id="a1"]'));
    const date = page.container.querySelector<HTMLInputElement>('input[aria-label="Abordar em"]');
    expect(date?.value).toBe("2026-11-03");
    expect(document.querySelector("[role=dialog]")).toBeNull();
    // Tema monocromático: o contato (WhatsApp) usa token, não cor solta da paleta; cor só no selo de status.
    const chosen = page.container.querySelector('section[aria-label="Lead escolhido"]');
    expect(chosen?.textContent).toContain("(15) 99876-5432");
    expect(chosen?.innerHTML).not.toMatch(/\b(?:text|bg|border)-(?:emerald|green|red|amber|yellow|orange|blue|sky|indigo|violet|purple|pink|rose|lime|teal|cyan)-\d/);
    await type(date, "2026-11-10");
    // Digitar o ano dígito a dígito passa por datas válidas (0002, 0020...): só grava ao confirmar.
    expect((await testDb().select<Lead[]>("SELECT * FROM leads WHERE id=?", ["a1"]))[0]?.outreach_date).toBe("2026-11-03");
    await click(page.button("Remarcar"));
    await until(async () => (await testDb().select<Lead[]>("SELECT * FROM leads WHERE company_id=? AND id=?", [companyId, "a1"]))[0]?.outreach_date === "2026-11-10", "data remarcada");
  });
});
