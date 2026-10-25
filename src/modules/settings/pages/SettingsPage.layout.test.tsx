// Configurações ocupam a largura toda da área de conteúdo (antes max-w-2xl, apertado): seções em duas colunas na
// janela larga, e o que é largo (título, contas e acessos) na linha inteira. A Área da empresa também sem max-w.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { renderPage, until, type RenderedPage } from "@/test/pageHarness";
import SettingsPage from "./SettingsPage";
import AreaProfilePage from "./AreaProfilePage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const C = "test-company";
const testDb = useTestDb();
let page: RenderedPage | null = null;

beforeEach(async () => {
  await insertTestCompany(testDb());
});

afterEach(() => {
  page?.unmount();
  page = null;
});

const classes = (element: Element | null | undefined) => element?.getAttribute("class")?.split(/\s+/) ?? [];
const hasMaxWidth = (element: Element) => classes(element).some((name) => /(^|:)max-w-/.test(name));

describe("Configurações em tela cheia", () => {
  it("a página não tem largura máxima e as seções se dividem em duas colunas na janela larga", async () => {
    page = await renderPage(<SettingsPage />, { companyId: C, role: "ceo" });
    await until(() => !!page!.container.querySelector('[data-editable-table="users"]'), "contas e acessos");
    const root = page.container.firstElementChild!;
    expect(hasMaxWidth(root)).toBe(false);
    expect(classes(root)).toEqual(expect.arrayContaining(["grid", "w-full", "xl:grid-cols-2"]));

    // Título e "Contas e acessos" (tabela larga) ocupam a linha inteira.
    expect(root.firstElementChild?.querySelector("h1")?.textContent).toBe("Configurações");
    expect(classes(root)).toContain("[&>*:first-child]:xl:col-span-2");
    const users = page.container.querySelector('[data-editable-table="users"]')!;
    const usersSection = [...root.children].find((child) => child.contains(users))!;
    expect(classes(usersSection)).toContain("xl:col-span-2");
  });

  it("Área da empresa também usa a largura toda", async () => {
    page = await renderPage(<AreaProfilePage />, { companyId: C, role: "ceo" });
    await until(() => page!.text().includes("Rótulos"), "tabela de rótulos");
    expect(hasMaxWidth(page.container.firstElementChild!)).toBe(false);
  });
});
