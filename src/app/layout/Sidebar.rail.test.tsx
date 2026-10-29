// Sidebar fechada some por completo: fica só o botão de abrir. A escolha fica salva; em janela estreita ela fecha
// sozinha e, aberta, aparece por cima do conteúdo.
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

const aside = () => document.querySelector("aside");
const toggle = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("button")].find((element) => element.getAttribute("aria-label") === name);
const control = (name: string) =>
  [...(aside()?.querySelectorAll<HTMLElement>("button, a") ?? [])].find(
    (element) => element.getAttribute("aria-label") === name || element.textContent?.trim() === name,
  );
const navLinks = () => [...(aside()?.querySelectorAll<HTMLAnchorElement>("nav[aria-label=Módulos] a") ?? [])];
const isClosed = () => !aside() && !!document.querySelector("[data-sidebar-closed]");

describe("Sidebar fechada (só o botão de abrir)", () => {
  it("fechada não mostra busca, assistente, módulos nem conta: só o botão Expandir sidebar", async () => {
    localStorage.setItem(COLLAPSED_KEY, "true");
    await openSidebar();
    expect(isClosed()).toBe(true);
    const closed = document.querySelector<HTMLElement>("[data-sidebar-closed]")!;
    expect(closed.querySelectorAll("button, a")).toHaveLength(1);
    expect(toggle("Expandir sidebar")).toBeDefined();
    expect(document.querySelector("nav")).toBeNull();
    expect(closed.style.width).toBe("48px");
  });

  it("aberta mostra os nomes dos módulos", async () => {
    await openSidebar();
    expect(isClosed()).toBe(false);
    const dashboard = navLinks().find((link) => link.textContent?.trim() === "Dashboard")!;
    expect(dashboard.querySelector(".sr-only")).toBeNull();
  });

  it("fechar e abrir fica salvo para a próxima abertura", async () => {
    await openSidebar();
    await click(control("Minimizar sidebar"));
    expect(isClosed()).toBe(true);
    expect(localStorage.getItem(COLLAPSED_KEY)).toBe("true");
    page!.unmount();

    await openSidebar();
    expect(isClosed()).toBe(true);
    await click(toggle("Expandir sidebar"));
    expect(isClosed()).toBe(false);
    expect(localStorage.getItem(COLLAPSED_KEY)).toBe("false");
  });

  it("em janela estreita fecha sozinha sem mudar a escolha salva; aberta fica por cima e fecha com Esc ou ao navegar", async () => {
    await openSidebar();
    expect(isClosed()).toBe(false);

    await resizeWindow(700);
    expect(isClosed()).toBe(true);
    expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull();

    await click(toggle("Expandir sidebar"));
    expect(isClosed()).toBe(false);
    expect(aside()!.hasAttribute("data-overlay")).toBe(true);
    expect(aside()!.className).toMatch(/\bfixed\b/);
    // O conteúdo não pula: um espaço do tamanho do botão segura o lugar da sidebar.
    expect(document.querySelector<HTMLElement>("[data-sidebar-spacer]")?.style.width).toBe("48px");
    expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(isClosed()).toBe(true);

    await click(toggle("Expandir sidebar"));
    expect(aside()!.hasAttribute("data-overlay")).toBe(true);
    await click(navLinks().find((link) => link.textContent?.trim() === "Calendário"));
    await until(() => isClosed(), "fechar a sidebar por cima ao navegar");

    await resizeWindow(1280);
    expect(isClosed()).toBe(false);
    expect(aside()!.hasAttribute("data-overlay")).toBe(false);
  });

  it("janela estreita com a sidebar fechada pela pessoa continua fechada ao alargar", async () => {
    localStorage.setItem(COLLAPSED_KEY, "true");
    await openSidebar();
    await resizeWindow(700);
    expect(isClosed()).toBe(true);
    await resizeWindow(1280);
    expect(isClosed()).toBe(true);
  });

  it("os menus da conta e do assistente não passam da janela: rolam por dentro", async () => {
    const fitsWindow = (id: string) => {
      const names = document.getElementById(id)?.className.split(/\s+/) ?? [];
      expect(names.some((name) => /^max-w-\[calc\(100vw-[\d.]+rem\)\]$/.test(name)), `${id}: largura limitada à janela`).toBe(true);
      expect(names.some((name) => /^max-h-\[calc\(100vh-[\d.]+rem\)\]$/.test(name)), `${id}: altura limitada à janela`).toBe(true);
      expect(names, `${id}: rola por dentro`).toContain("overflow-y-auto");
    };
    await openSidebar();
    await click(control("Abrir menu da conta"));
    fitsWindow("account-menu");
    await click(control("Assistente de IA"));
    fitsWindow("assistant-menu");
  });

  it("estreitar a janela não grava uma largura menor: ao alargar, a sidebar volta à largura escolhida", async () => {
    await resizeWindow(1280);
    localStorage.setItem("cm_sidebar_width", "300");
    await openSidebar();
    expect(aside()!.style.width).toBe("300px");
    await resizeWindow(700);
    await resizeWindow(1000);
    // 33% de 1000 = 330: a largura escolhida cabe de novo.
    expect(aside()!.style.width).toBe("300px");
    expect(localStorage.getItem("cm_sidebar_width")).toBe("300");
  });
});
