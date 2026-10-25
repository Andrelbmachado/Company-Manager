// Configurações > Área da empresa: seletor de área e tabela de rótulos editável no próprio lugar (sem modal).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany, type TestDb } from "@/test/sqlite";
import { choose, click, renderPage, type as typeInto, until, type RenderedPage } from "@/test/pageHarness";
import { confirmAction } from "@/lib/confirm";
import { loadAreaLabels } from "@/lib/labels/store";
import { setCompanySetting } from "@/lib/settings/companySettings";
import type { Role } from "@/types";
import AreaProfilePage from "./AreaProfilePage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => false) }));

const testDb = useTestDb();
const COMPANY = "test-company";
let page: RenderedPage | null = null;

beforeEach(async () => {
  vi.mocked(confirmAction).mockReset().mockResolvedValue(false);
  await insertTestCompany(testDb(), { companyId: COMPANY });
});

afterEach(() => {
  page?.unmount();
  page = null;
});

async function open(role: Role): Promise<RenderedPage> {
  page = await renderPage(<AreaProfilePage />, { companyId: COMPANY, role, path: "/settings/area" });
  await until(() => document.querySelector("table tbody tr") !== null, "tabela de rótulos");
  return page;
}

const areaSelect = () => document.querySelector<HTMLSelectElement>("select[aria-label='Área da empresa']");
const row = (key: string) => document.querySelector<HTMLTableRowElement>(`tr[data-key='${key}']`);
const input = (key: string) => row(key)?.querySelector<HTMLInputElement>("input");

describe("AreaProfilePage", () => {
  it("CEO troca a área: grava na hora e a tabela passa a mostrar os textos da área", async () => {
    await open("ceo");
    expect(areaSelect()?.value).toBe("ti");
    expect(row("dashboard.active_work")?.textContent).toMatch(/Projetos ativos/);

    await choose(areaSelect(), "advocacia");
    await until(async () => (await loadAreaLabels(testDb(), COMPANY)).profile === "advocacia", "área gravada");
    await until(() => row("dashboard.active_work")?.textContent?.includes("Clientes ativos") ?? false, "texto da advocacia na tabela");
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("Editar libera as células; Salvar grava só os rótulos mudados e marca a linha alterada", async () => {
    await open("ceo");
    expect(input("dashboard.profit")).toBeNull();
    await click(page!.button("Editar"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(input("dashboard.profit")?.placeholder).toBe("Lucro do mês");

    await typeInto(input("dashboard.profit"), "Honorários do mês");
    await typeInto(input("module.crm"), "CRM");
    expect(row("dashboard.profit")?.getAttribute("data-changed")).toBe("true");
    await click(page!.button("Salvar"));

    await until(async () => (await loadAreaLabels(testDb(), COMPANY)).overrides["dashboard.profit"] === "Honorários do mês", "rótulo gravado");
    // "CRM" é o próprio texto da área: não vira sobrescrita (trocar de área depois continua valendo).
    expect((await loadAreaLabels(testDb(), COMPANY)).overrides).toEqual({ "dashboard.profit": "Honorários do mês" });
    await until(() => input("dashboard.profit") === null, "sai do modo edição");
    expect(row("dashboard.profit")?.textContent).toMatch(/Honorários do mês/);
  });

  it("Atualizar com alterações não salvas pergunta antes e, se a pessoa desiste, mantém o rascunho", async () => {
    await open("ceo");
    await click(page!.button("Editar"));
    await typeInto(input("module.projects"), "Obras");
    await click(page!.button("Atualizar"));
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(input("module.projects")?.value).toBe("Obras");

    vi.mocked(confirmAction).mockResolvedValue(true);
    await click(page!.button("Atualizar"));
    await until(() => input("module.projects") === null, "descarta o rascunho");
    expect(row("module.projects")?.textContent).toMatch(/Project Manager/);
  });

  it("Restaurar padrões limpa as sobrescritas no rascunho", async () => {
    await setCompanySetting(testDb(), COMPANY, "company.labels", { "module.calendar": "Agenda" });
    await open("ceo");
    await until(() => row("module.calendar")?.textContent?.includes("Agenda") ?? false, "sobrescrita gravada");
    await click(page!.button("Editar"));
    expect(input("module.calendar")?.value).toBe("Agenda");
    await click(page!.button("Restaurar padrões"));
    expect(input("module.calendar")?.value).toBe("");
    await click(page!.button("Salvar"));
    await until(async () => Object.keys((await loadAreaLabels(testDb(), COMPANY)).overrides).length === 0, "sobrescritas apagadas");
  });

  it("sem conseguir ler os rótulos, Editar e o seletor ficam desativados (Salvar não grava a tabela vazia por cima); Atualizar tenta de novo", async () => {
    await setCompanySetting(testDb(), COMPANY, "company.labels", { "module.calendar": "Agenda" });
    const db = testDb();
    const realSelect = db.select.bind(db);
    db.select = (async (sql: string, binds?: unknown[]) => {
      if (/from settings/i.test(sql)) throw new Error("banco ocupado");
      return realSelect(sql, binds);
    }) as TestDb["select"];

    const view = await renderPage(<AreaProfilePage />, { companyId: COMPANY, role: "ceo", path: "/settings/area" });
    page = view;
    await until(() => document.querySelector("[role=alert]") !== null, "aviso de leitura com erro");
    expect(view.button("Editar")?.disabled).toBe(true);
    expect(areaSelect()?.disabled).toBe(true);

    db.select = realSelect;
    await click(view.button("Atualizar"));
    await until(() => row("module.calendar")?.textContent?.includes("Agenda") ?? false, "rótulos lidos de novo");
    expect(view.button("Editar")?.disabled).toBe(false);
    expect(areaSelect()?.disabled).toBe(false);
    expect((await loadAreaLabels(db, COMPANY)).overrides).toEqual({ "module.calendar": "Agenda" });
  });

  it("quem não edita Configurações vê tudo, mas o seletor e o Editar ficam desativados com dica", async () => {
    await open("comercial");
    expect(areaSelect()?.disabled).toBe(true);
    const edit = page!.button("Editar");
    expect(edit?.disabled).toBe(true);
    expect(edit?.title).toMatch(/CEO e Administração/);
    expect(page!.button("Atualizar")?.disabled).toBe(false);
    expect(row("module.dashboard")?.textContent).toMatch(/Dashboard/);
  });
});
