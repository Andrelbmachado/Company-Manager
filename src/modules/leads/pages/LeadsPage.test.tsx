// Prospecção numa lista só (sem seletor de campanha): todos os leads somados, menu "Nova prospecção" (cadastrar,
// editar, importar), filtros na barra da tabela, só a coluna WhatsApp, excluir lead, cards só com título e número e
// cronograma no CalendarView na largura toda (SQLite real).
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { click, findButton, plain, renderPage, type, until, type RenderedPage } from "@/test/pageHarness";
import { defaultCampaignId } from "@/lib/prospecting/campaigns";
import type { Lead, Role } from "@/types";
import LeadsPage from "./LeadsPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

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
const table = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-editable-table="leads"]')!;
const menuItem = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')].find((item) => plain(item.textContent).trim() === label);

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

describe("Prospecção: uma lista só, menu Nova prospecção e cards enxutos", () => {
  it("sem seletor de prospecção: cards e lista somam os leads de todas as campanhas, sem os textos fixos antigos", async () => {
    const { page } = await open();
    await until(() => kpi(page.container, "Leads") === "4" && page.text().includes("Escritório Silva"), "cards com todos os leads");

    const list = cards(page.container);
    expect(list.map((card) => card.title)).toEqual(["Leads", "Abordados", "Fechados", "Potencial no 1º ano"]);
    for (const card of list) {
      expect(card.childCount).toBe(2);
      expect(card.text).toBe(card.title + card.value);
    }
    expect(kpi(page.container, "Abordados")).toBe("3");
    expect(kpi(page.container, "Fechados")).toBe("1");
    expect(kpi(page.container, "Potencial no 1º ano")).toBe("R$ 11.000");
    expect(page.container.querySelector('select[aria-label="Prospecção"]')).toBeNull();
    expect(page.button("Renomear prospecção")).toBeUndefined();
    expect(page.text()).toContain("Pet Shop Alfa");
    for (const fixed of FIXED_TEXTS) expect(page.text()).not.toContain(fixed);
  });

  it("busca e filtros ficam na barra da tabela; só a coluna WhatsApp, com o número inteiro numa linha", async () => {
    const { page } = await open();
    await until(() => page.text().includes("Pet Shop Alfa"), "leads");
    const bar = table(page.container).firstElementChild as HTMLElement;
    for (const label of ["Filtrar por status", "Filtrar por categoria", "Filtrar por presença online"]) {
      expect(bar.querySelector(`select[aria-label="${label}"]`), label).not.toBeNull();
    }
    expect(bar.querySelector("input[placeholder^='Buscar']")).not.toBeNull();
    const headers = [...table(page.container).querySelectorAll("thead th")].map((th) => plain(th.textContent));
    expect(headers).toContain("WhatsApp");
    expect(headers).not.toContain("Telefone");
    const whatsapp = table(page.container).querySelector<HTMLElement>('tr[data-row-key="a1"] td[data-column="whatsapp"] button');
    expect(whatsapp?.className).toMatch(/whitespace-nowrap/);
    expect(plain(whatsapp?.textContent).trim()).toBe("(15) 99876-5432");
  });

  it("menu Nova prospecção: Nova prospecção cadastra na tabela (lead entra na prospecção padrão), Editar abre a edição", async () => {
    const { companyId, page } = await open();
    await until(() => kpi(page.container, "Leads") === "4", "cards");

    await click(page.button("Nova prospecção"));
    expect(menuItem("Nova prospecção")).toBeDefined();
    expect(menuItem("Editar prospecção")).toBeDefined();
    expect(menuItem("Importar prospecção")).toBeDefined();
    expect(page.container.querySelector("button[aria-label^='Importar planilha']")).toBeNull();
    await click(menuItem("Nova prospecção"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await type(table(page.container).querySelector('[aria-label="Lead (nova linha)"]'), "Advocacia Souza");
    await click(findButton(table(page.container), "Salvar"));

    const created = async () => (await testDb().select<Lead[]>("SELECT * FROM leads WHERE company_id=? AND name=?", [companyId, "Advocacia Souza"]))[0];
    await until(async () => !!(await created()), "lead gravado");
    expect((await created())!.campaign_id).toBe(defaultCampaignId(companyId));
    await until(() => kpi(page.container, "Leads") === "5", "card com o lead novo");

    await click(page.button("Nova prospecção"));
    await click(menuItem("Editar prospecção"));
    await until(() => table(page.container).getAttribute("data-editing") === "true", "tabela em edição");
  });

  it("papel sem permissão vê os itens do menu desativados, com dica", async () => {
    const { page } = await open("auditor");
    await until(() => page.text().includes("Pet Shop Alfa"), "leads");
    const menu = page.button("Nova prospecção");
    if (menu && !menu.disabled) {
      await click(menu);
      for (const label of ["Nova prospecção", "Editar prospecção", "Importar prospecção"]) {
        expect(menuItem(label)?.disabled, label).toBe(true);
        expect(menuItem(label)?.title, label).toMatch(/permissão/i);
      }
    } else {
      expect(menu?.disabled).toBe(true);
    }
  });

  it("Excluir tira o lead da prospecção (soft delete), depois de confirmar", async () => {
    const { companyId, page } = await open("ceo");
    await until(() => page.text().includes("Buffet Gama"), "leads");
    await click(page.container.querySelector<HTMLButtonElement>('button[aria-label="Excluir Buffet Gama"]'));
    await until(async () => !!(await testDb().select<Lead[]>("SELECT * FROM leads WHERE company_id=? AND id=?", [companyId, "a3"]))[0]?.deleted_at, "lead excluído");
    await until(() => !page.text().includes("Buffet Gama"), "lead some da lista");
    expect(kpi(page.container, "Leads")).toBe("3");
  });

  it("previsão de receita calcula na hora com todos os leads, em cards só com título e número", async () => {
    const companyId = await seed();
    await testDb().execute("INSERT INTO revenue_scenarios (id, company_id, code, label, conversion_rate) VALUES (?, ?, ?, ?, ?)", ["s5", companyId, "c5", "Conservador (5%)", 0.05]);
    await testDb().execute("INSERT INTO revenue_scenarios (id, company_id, code, label, conversion_rate) VALUES (?, ?, ?, ?, ?)", ["s20", companyId, "c20", "Otimista (20%)", 0.2]);
    const rendered = await renderPage(<LeadsPage />, { companyId, role: "comercial", path: "/leads" });
    page = rendered;
    await until(() => kpi(rendered.container, "Leads") === "4", "cards");

    await click(rendered.button("Previsão de receita"));
    await until(() => kpi(rendered.container, "Conservador (5%)") === "R$ 550", "previsão (R$ 11.000 × 5%)");
    expect(kpi(rendered.container, "Otimista (20%)")).toBe("R$ 2.200");
    for (const card of cards(rendered.container)) {
      expect(card.childCount).toBe(2);
      expect(card.text).toBe(card.title + card.value);
    }
    for (const fixed of FIXED_TEXTS) expect(rendered.text()).not.toContain(fixed);
    expect(rendered.button("Recalcular a partir dos leads")).toBeUndefined();
  });

  it("cronograma em calendário na largura toda: sem 'Só leads novos' nem painel vazio; remarca no próprio lugar", async () => {
    const { companyId, page } = await open();
    await until(() => kpi(page.container, "Leads") === "4", "cards");

    await click(page.button("Cronograma de abordagem"));
    await until(() => !!page.container.querySelector("[data-calendar-view]") && !!page.container.querySelector('[data-item-id="a1"]'), "calendário com os leads");
    expect(page.container.querySelector('[data-item-id="a2"]')).not.toBeNull();
    expect(page.container.querySelector('[data-item-id="a3"]')).toBeNull();
    expect(page.text()).not.toContain("Só leads novos");
    expect(page.text()).not.toContain("Nenhum lead escolhido");
    expect(page.container.querySelector('section[aria-label="Lead escolhido"]')).toBeNull();
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
