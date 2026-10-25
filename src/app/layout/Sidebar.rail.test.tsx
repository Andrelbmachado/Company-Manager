// Sidebar recolhida = trilho de ícones (busca, assistente, módulos e conta continuam na tela, com nome acessível e
// dica ao lado); a escolha fica salva; em janela estreita ela recolhe sozinha e, expandida, abre por cima do conteúdo.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { click, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { Sidebar } from "./Sidebar";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
const COMPANY = "test-company";
const COLLAPSED_KEY = "cm_sidebar_collapsed";
const initialWidth = window.innerWidth;
let page: RenderedPage | null = null;

beforeEach(async () => {
  localStorage.clear();
  await insertTestCompany(testDb(), { companyId: COMPANY });
});

afterEach(async () => {
  page?.unmount();
  page = null;
  await resizeWindow(initialWidth);
});

async function resizeWindow(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
  });
}

async function openSidebar(path = "/"): Promise<RenderedPage> {
  page = await renderPage(<Sidebar onSearch={() => {}} />, { companyId: COMPANY, role: "comercial", path });
  return page;
}

const aside = () => document.querySelector("aside")!;
const control = (name: string) =>
  [...aside().querySelectorAll<HTMLElement>("button, a")].find(
    (element) => element.getAttribute("aria-label") === name || element.textContent?.trim() === name,
  );
const navLinks = () => [...aside().querySelectorAll<HTMLAnchorElement>("nav[aria-label=Módulos] a")];
const isRail = () => aside().hasAttribute("data-rail");
const tooltip = () => document.querySelector<HTMLElement>("[role=tooltip][data-rail-tooltip]");

async function focus(element: HTMLElement | undefined) {
  if (!element) throw new Error("controle não encontrado");
  await act(async () => {
    element.focus();
  });
}

describe("Sidebar recolhida (trilho de ícones)", () => {
  it("busca, assistente, módulos e conta continuam no trilho, cada um com nome acessível e dica", async () => {
    localStorage.setItem(COLLAPSED_KEY, "true");
    await openSidebar();
    expect(isRail()).toBe(true);
    expect(aside().style.width).toBe("56px");

    for (const name of ["Buscar", "Assistente de IA", "Abrir menu da conta", "Expandir sidebar"]) {
      const element = control(name);
      expect(element, name).toBeDefined();
      expect(element!.getAttribute("data-rail-tip"), name).toBeTruthy();
      expect(element!.querySelector("svg, span"), name).not.toBeNull();
    }

    const links = navLinks();
    expect(links.length).toBeGreaterThan(3);
    for (const link of links) {
      const name = link.textContent?.trim();
      expect(name).toBeTruthy();
      // O texto fica só para leitor de tela; a dica mostra o mesmo nome.
      expect(link.querySelector(".sr-only")?.textContent).toBe(name);
      expect(link.getAttribute("data-rail-tip")).toBe(name);
      expect(link.querySelector("svg")).not.toBeNull();
    }
    expect(navLinks().find((link) => link.textContent?.trim() === "Dashboard")).toBeDefined();
  });

  it("a dica aparece ao focar pelo teclado e some ao sair do controle ou com Esc", async () => {
    localStorage.setItem(COLLAPSED_KEY, "true");
    await openSidebar();
    expect(tooltip()).toBeNull();

    const dashboard = navLinks().find((link) => link.textContent?.trim() === "Dashboard");
    await focus(dashboard);
    expect(tooltip()?.textContent).toBe("Dashboard");
    expect(tooltip()?.className).toMatch(/\bfixed\b/);
    // Em portal: fora da lista de módulos, que rola e cortaria a dica.
    expect(aside().contains(tooltip())).toBe(false);

    await focus(control("Buscar"));
    expect(tooltip()?.textContent).toMatch(/Buscar/);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(tooltip()).toBeNull();

    await focus(control("Abrir menu da conta"));
    expect(tooltip()?.textContent).toBe("Teste comercial");
    await act(async () => {
      (document.activeElement as HTMLElement).blur();
    });
    expect(tooltip()).toBeNull();
  });

  it("expandida não mostra dica e mostra os nomes dos módulos", async () => {
    await openSidebar();
    expect(isRail()).toBe(false);
    const dashboard = navLinks().find((link) => link.textContent?.trim() === "Dashboard")!;
    expect(dashboard.querySelector(".sr-only")).toBeNull();
    expect(dashboard.hasAttribute("data-rail-tip")).toBe(false);
    await focus(dashboard);
    expect(tooltip()).toBeNull();
  });

  it("recolher e expandir fica salvo para a próxima abertura", async () => {
    await openSidebar();
    await click(control("Minimizar sidebar"));
    expect(isRail()).toBe(true);
    expect(localStorage.getItem(COLLAPSED_KEY)).toBe("true");
    page!.unmount();

    await openSidebar();
    expect(isRail()).toBe(true);
    await click(control("Expandir sidebar"));
    expect(isRail()).toBe(false);
    expect(localStorage.getItem(COLLAPSED_KEY)).toBe("false");
  });

  it("em janela estreita recolhe sozinha sem mudar a escolha salva; expandida abre por cima e fecha com Esc ou ao navegar", async () => {
    await openSidebar();
    expect(isRail()).toBe(false);

    await resizeWindow(700);
    expect(isRail()).toBe(true);
    expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull();

    await click(control("Expandir sidebar"));
    expect(isRail()).toBe(false);
    expect(aside().hasAttribute("data-overlay")).toBe(true);
    expect(aside().className).toMatch(/\bfixed\b/);
    // O conteúdo não pula: um espaço do tamanho do trilho segura o lugar da sidebar.
    expect(document.querySelector<HTMLElement>("[data-sidebar-spacer]")?.style.width).toBe("56px");
    expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(isRail()).toBe(true);
    expect(aside().hasAttribute("data-overlay")).toBe(false);

    await click(control("Expandir sidebar"));
    expect(aside().hasAttribute("data-overlay")).toBe(true);
    await click(navLinks().find((link) => link.textContent?.trim() === "Calendário"));
    await until(() => isRail(), "fechar a sidebar por cima ao navegar");

    await resizeWindow(1280);
    expect(isRail()).toBe(false);
    expect(aside().hasAttribute("data-overlay")).toBe(false);
  });

  it("janela estreita com a sidebar recolhida pela pessoa continua recolhida ao alargar", async () => {
    localStorage.setItem(COLLAPSED_KEY, "true");
    await openSidebar();
    await resizeWindow(700);
    expect(isRail()).toBe(true);
    await resizeWindow(1280);
    expect(isRail()).toBe(true);
  });
});
