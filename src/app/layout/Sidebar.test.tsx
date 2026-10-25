// Navegação da sidebar registrada para a Fase B do redesign: Calendário em Visão Geral, Fornecedores em Logística
// e nomes dos módulos vindos do perfil de área (com as sobrescritas de Configurações).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { setCompanySetting } from "@/lib/settings/companySettings";
import type { Role } from "@/types";
import { Sidebar } from "./Sidebar";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
const COMPANY = "test-company";
let page: RenderedPage | null = null;

beforeEach(async () => {
  localStorage.clear();
  await insertTestCompany(testDb(), { companyId: COMPANY });
});

afterEach(() => {
  page?.unmount();
  page = null;
});

async function openSidebar(role: Role, path = "/"): Promise<RenderedPage> {
  page = await renderPage(<Sidebar onSearch={() => {}} />, { companyId: COMPANY, role, path });
  return page;
}

/** Grupos da navegação na ordem: título → rótulos dos links. */
function navGroups(): Record<string, string[]> {
  const nav = document.querySelector("nav[aria-label=Módulos]")!;
  const groups: Record<string, string[]> = {};
  for (const block of nav.children) {
    const title = block.querySelector("p")?.textContent?.trim() ?? "";
    groups[title] = [...block.querySelectorAll("a")].map((link) => link.textContent?.trim() ?? "");
  }
  return groups;
}

const link = (label: string) => [...document.querySelectorAll<HTMLAnchorElement>("nav[aria-label=Módulos] a")].find((item) => item.textContent?.trim() === label);

describe("Sidebar", () => {
  it("Calendário fica em Visão Geral, logo depois do Dashboard, para todos os papéis", async () => {
    await openSidebar("comercial");
    expect(navGroups()["Visão Geral"]).toEqual(["Dashboard", "Calendário"]);
    expect(link("Calendário")?.getAttribute("href")).toBe("/calendar");
  });

  it("Fornecedores fica em Logística e abre a lista de fornecedores das Compras (só para quem vê fornecedores)", async () => {
    await openSidebar("estoquista", "/purchasing/fornecedores");
    expect(navGroups()["Logística"]).toEqual(["Estoque", "Custódia de peça", "Compras", "Fornecedores"]);
    expect(link("Fornecedores")?.getAttribute("href")).toBe("/purchasing/fornecedores");
    // Item ativo: o caminho mais longo que contém a URL (Fornecedores, não Compras).
    expect(link("Fornecedores")?.className).toMatch(/font-semibold/);
    expect(link("Compras")?.className).not.toMatch(/font-semibold/);
    page!.unmount();
    page = null;

    await openSidebar("comercial");
    expect(link("Fornecedores")).toBeUndefined();
    expect(navGroups()["Logística"]).toBeUndefined();
  });

  it("os nomes dos módulos seguem a área da empresa e os rótulos personalizados", async () => {
    await setCompanySetting(testDb(), COMPANY, "company.area_profile", "advocacia");
    await setCompanySetting(testDb(), COMPANY, "company.labels", { "module.calendar": "Agenda e prazos" });
    await openSidebar("ceo");
    await until(() => link("Processos") !== undefined, "rótulo do perfil advocacia");
    expect(link("Project Manager")).toBeUndefined();
    expect(link("Agenda e prazos")?.getAttribute("href")).toBe("/calendar");
    expect(link("Clientes")?.getAttribute("href")).toBe("/crm");
    expect(link("Dashboard")).toBeDefined();
  });
});
