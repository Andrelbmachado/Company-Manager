// Abas (TabList e ModuleNav): a linha fica só embaixo das abas (w-fit), sem linha de largura total nem barra de
// rolagem visível, e o texto é maior (text-base).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModuleNav } from "@/app/layout/ModuleNav";
import { renderPage, type RenderedPage } from "@/test/pageHarness";
import { TabList } from "./Tabs";

const TABS = [
  { id: "a", label: "Primeira" },
  { id: "b", label: "Segunda" },
] as const;

let page: RenderedPage | null = null;
afterEach(() => {
  page?.unmount();
  page = null;
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "project-manager" ? [] : sourceFiles(full);
    return /\.tsx$/.test(name) && !name.endsWith(".test.tsx") ? [full] : [];
  });
}

describe("abas", () => {
  it("TabList: lista do tamanho das abas, rolagem sem barra, texto maior e indicador em cada aba", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<TabList tabs={TABS} value="a" onChange={() => {}} label="Seções" idPrefix="t" />);
    const list = host.querySelector("[role=tablist]")!;
    expect(list.className).toContain("w-fit");
    expect(list.className).toContain("[scrollbar-width:none]");
    expect(list.className).not.toMatch(/(^|\s)border-b(\s|$)/);
    const tabs = [...host.querySelectorAll("[role=tab]")];
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      expect(tab.className).toContain("text-base");
      expect(tab.className).toContain("border-b-2");
      expect(tab.className).not.toContain("-mb-px");
    }
    expect(tabs[0].className).toContain("border-primary");
    expect(tabs[1].className).not.toContain("border-primary");
  });

  it("ModuleNav: mesma regra nas abas do módulo", async () => {
    page = await renderPage(<ModuleNav />, { companyId: "empresa-1", role: "ceo", path: "/crm" });
    const nav = page.container.querySelector("nav")!;
    expect(nav).not.toBeNull();
    expect(nav.className).toContain("w-fit");
    expect(nav.className).toContain("[scrollbar-width:none]");
    expect(nav.className).not.toMatch(/(^|\s)border-b(\s|$)/);
    const links = [...nav.querySelectorAll("a")];
    expect(links.length).toBeGreaterThan(1);
    for (const link of links) expect(link.className).toContain("text-base");
  });

  it("nenhuma tela embrulha o TabList numa linha de largura total", () => {
    const offenders = sourceFiles(path.resolve(__dirname, "../../modules")).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(/<div className="([^"]*)">\s*<TabList/g)].filter((match) => /(^|\s)border-b(\s|$)/.test(match[1])).map(() => path.relative(process.cwd(), file));
    });
    expect(offenders).toEqual([]);
  });
});
