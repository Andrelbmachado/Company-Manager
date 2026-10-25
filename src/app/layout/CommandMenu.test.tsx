// Busca (⌘K): nomes dos módulos conforme a área da empresa (Configurações > Área da empresa), sem perder o nome
// descritivo na pesquisa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { renderPage, type as typeInto, until, type RenderedPage } from "@/test/pageHarness";
import { setCompanySetting } from "@/lib/settings/companySettings";
import { CommandMenu } from "./CommandMenu";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

// O cmdk rola o item selecionado com scrollIntoView, que o jsdom não tem.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

const testDb = useTestDb();
const COMPANY = "test-company";
let page: RenderedPage | null = null;

beforeEach(async () => {
  await insertTestCompany(testDb(), { companyId: COMPANY, roles: ["ceo"] });
});

afterEach(() => {
  page?.unmount();
  page = null;
});

const items = () => [...document.querySelectorAll("[cmdk-item]")].map((item) => item.textContent?.trim() ?? "");

async function openSearch(): Promise<void> {
  page = await renderPage(<CommandMenu open onClose={() => {}} />, { companyId: COMPANY, role: "ceo" });
}

describe("CommandMenu", () => {
  it("na área padrão (TI) mostra os nomes descritivos, o Calendário e a aba Área da empresa", async () => {
    await openSearch();
    expect(items()).toEqual(
      expect.arrayContaining(["Project Manager (projetos)", "CRM / Clientes", "Calendário (agenda da empresa)", "CRM › Contatos", "Configurações › Área da empresa"]),
    );
  });

  it("com outra área e rótulo personalizado, mostra o nome da empresa e o nome descritivo continua achando o módulo", async () => {
    await setCompanySetting(testDb(), COMPANY, "company.area_profile", "advocacia");
    await setCompanySetting(testDb(), COMPANY, "company.labels", { "module.calendar": "Agenda e prazos" });
    await openSearch();
    await until(() => items().includes("Processos"), "rótulo da advocacia na busca");
    expect(items()).toEqual(expect.arrayContaining(["Clientes", "Agenda e prazos", "Clientes › Contatos"]));
    expect(items()).not.toContain("Project Manager (projetos)");
    expect(items()).not.toContain("Calendário (agenda da empresa)");

    await typeInto(document.querySelector("[cmdk-input]"), "Project Manager");
    await until(() => !items().includes("Clientes"), "busca filtrada");
    expect(items()).toContain("Processos");
  });
});
