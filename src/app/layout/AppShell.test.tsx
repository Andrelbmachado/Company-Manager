// Shell sem top bar: busca, Assistente de IA e navegação na sidebar; conta (tema, notificações, sair) no rodapé.
import { act, lazy } from "react";
import { Route, Routes, useParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { click, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { createConversation } from "@/lib/assistant/conversations";
import { AppShell } from "./AppShell";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/hooks/useProspectingBootstrap", () => ({ useProspectingBootstrap: () => undefined }));

// O cmdk (busca) rola o item selecionado com scrollIntoView, que o jsdom não tem.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

const testDb = useTestDb();
const COMPANY = "test-company";
const ME = "test-user-comercial";
let page: RenderedPage | null = null;

beforeEach(async () => {
  localStorage.clear();
  document.documentElement.classList.add("dark");
  await insertTestCompany(testDb(), { companyId: COMPANY, roles: ["comercial"] });
});

afterEach(() => {
  page?.unmount();
  page = null;
});

function ConversationProbe() {
  const { conversationId } = useParams();
  return <p data-testid="conversa">{conversationId ?? "nova"}</p>;
}

async function openShell(): Promise<RenderedPage> {
  page = await renderPage(
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<p data-testid="conteudo">Conteúdo da página</p>} />
        <Route path="/assistant/:conversationId?" element={<ConversationProbe />} />
      </Route>
    </Routes>,
    { companyId: COMPANY, role: "comercial" },
  );
  return page;
}

const sidebar = () => document.querySelector("aside")!;
const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const byName = (scope: ParentNode, name: string) =>
  [...scope.querySelectorAll<HTMLElement>("button, a, [role=switch]")].find(
    (element) => element.getAttribute("aria-label") === name || element.textContent?.trim() === name,
  );

describe("AppShell", () => {
  it("não tem top bar: busca, assistente acima do Dashboard e conta por último na sidebar", async () => {
    await openShell();
    expect(document.querySelector("header")).toBeNull();
    expect(document.querySelector("[role=banner]")).toBeNull();
    expect(document.querySelector("main [data-testid=conteudo]")).not.toBeNull();

    const search = byName(sidebar(), "Buscar");
    const assistant = byName(sidebar(), "Assistente de IA");
    const dashboard = [...sidebar().querySelectorAll("a")].find((link) => link.textContent?.trim() === "Dashboard");
    const account = byName(sidebar(), "Abrir menu da conta");
    expect(search?.tagName).toBe("BUTTON");
    expect(assistant?.tagName).toBe("BUTTON");
    expect(dashboard).toBeDefined();
    expect(account?.tagName).toBe("BUTTON");
    expect(precedes(search!, assistant!)).toBe(true);
    expect(precedes(assistant!, dashboard!)).toBe(true);
    const focusable = [...sidebar().querySelectorAll("button, a")];
    expect(focusable.at(-1)).toBe(account);
  });

  it("a conta mostra o switch Tema escuro e as Notificações com contador", async () => {
    await openShell();
    await click(byName(sidebar(), "Abrir menu da conta"));
    const themeSwitch = document.querySelector<HTMLElement>("[role=switch]");
    expect(themeSwitch?.getAttribute("aria-label") ?? themeSwitch?.textContent).toMatch(/Tema escuro/);
    expect(themeSwitch?.getAttribute("aria-checked")).toBe("true");
    const notifications = byName(sidebar(), "Notificações");
    expect(notifications).toBeDefined();
    expect(notifications?.textContent).toMatch(/1/);
    expect(page!.text()).toMatch(/Configurações da conta/);
    expect(page!.text()).toMatch(/Trocar usuário/);
    expect(page!.text()).toMatch(/Sair/);

    await click(themeSwitch);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("cm_theme")).toBe("light");
    expect(document.querySelector("[role=switch]")?.getAttribute("aria-checked")).toBe("false");

    await click(notifications);
    expect(page!.text()).toMatch(/Novo ticket aguardando atendimento/);
  });

  it("com o menu da conta aberto, os itens vêm depois do botão (Tab a partir dele entra no menu, na ordem)", async () => {
    await openShell();
    const account = byName(sidebar(), "Abrir menu da conta")!;
    await click(account);
    const settings = byName(sidebar(), "Configurações da conta");
    const signOut = byName(sidebar(), "Sair");
    expect(settings).toBeDefined();
    expect(signOut).toBeDefined();
    expect(precedes(account, settings!)).toBe(true);
    expect(precedes(settings!, signOut!)).toBe(true);
  });

  it("Buscar e ⌘K abrem a busca", async () => {
    await openShell();
    expect(document.querySelector("[role=dialog][aria-label=Buscar]")).toBeNull();
    await click(byName(sidebar(), "Buscar"));
    expect(document.querySelector("[role=dialog][aria-label=Buscar] input")).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.querySelector("[role=dialog][aria-label=Buscar]")).toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    });
    expect(document.querySelector("[role=dialog][aria-label=Buscar]")).not.toBeNull();
  });

  it("página que ainda está carregando (lazy) não esconde a sidebar: só o conteúdo mostra o carregando", async () => {
    // Na primeira visita a cada módulo o código da página é baixado sob demanda; antes, o carregando ocupava a janela
    // toda e a sidebar sumia até a página chegar.
    const Pending = lazy(() => new Promise<{ default: () => JSX.Element }>(() => {}));
    page = await renderPage(
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Pending />} />
        </Route>
      </Routes>,
      { companyId: COMPANY, role: "comercial" },
    );
    expect(byName(sidebar(), "Buscar")).toBeDefined();
    expect(byName(sidebar(), "Abrir menu da conta")).toBeDefined();
    expect(document.querySelector("main [data-page-loading]")).not.toBeNull();
  });

  it("o Assistente de IA lista as conversas do usuário e abre cada uma", async () => {
    const id = await createConversation(testDb(), COMPANY, ME, "Resumo do funil");
    await openShell();
    await click(byName(sidebar(), "Assistente de IA"));
    await until(() => page!.text().includes("Resumo do funil"), "conversa na lista do assistente");
    expect(byName(sidebar(), "Nova conversa")).toBeDefined();

    await click(byName(sidebar(), "Resumo do funil"));
    await until(() => document.querySelector("[data-testid=conversa]")?.textContent === id, "abrir a conversa");

    await click(byName(sidebar(), "Assistente de IA"));
    await until(() => byName(sidebar(), "Nova conversa") !== undefined, "menu do assistente");
    await click(byName(sidebar(), "Nova conversa"));
    await until(() => document.querySelector("[data-testid=conversa]")?.textContent === "nova", "nova conversa");
  });

  it("só a área de conteúdo rola: a casca tem a altura da janela e nada fora do main e da lista de módulos rola", async () => {
    // Rolar entre a sidebar e o conteúdo levava a janela inteira para cima (só o fundo aparecia): a casca não rola,
    // o main e a lista de módulos rolam sozinhos e não passam a rolagem adiante (overscroll contido).
    await openShell();
    const shell = sidebar().parentElement!;
    const classes = (element: Element) => element.getAttribute("class")?.split(/\s+/) ?? [];
    expect(classes(shell)).toEqual(expect.arrayContaining(["h-full", "overflow-hidden"]));
    expect(classes(shell)).not.toContain("h-screen");

    const main = shell.querySelector("main")!;
    expect(main.parentElement).toBe(shell);
    expect(classes(main)).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "overflow-y-auto", "overscroll-contain"]));

    const nav = sidebar().querySelector("nav[aria-label=Módulos]")!;
    expect(classes(nav)).toEqual(expect.arrayContaining(["overflow-y-auto", "overscroll-contain"]));

    const scrollers = [shell, ...shell.querySelectorAll("*")].filter((element) =>
      classes(element).some((name) => /^overflow(-[xy])?-(auto|scroll)$/.test(name)),
    );
    expect(scrollers).toEqual([nav, main]);
  });

  it("elemento absoluto (sr-only) fica dentro da área que rola e não dá altura de rolagem à janela", async () => {
    // A tabela sr-only do gráfico do Dashboard (absoluta, sem ancestral posicionado) saía do main e da casca: a janela
    // ganhava altura para rolar mesmo com overflow hidden. Main, casca e cada grupo da sidebar seguram os absolutos.
    localStorage.setItem("cm_sidebar_collapsed", "true");
    await openShell();
    const shell = sidebar().parentElement!;
    expect(shell.classList.contains("relative")).toBe(true);
    expect(shell.querySelector("main")!.classList.contains("relative")).toBe(true);
    const groupTitles = [...sidebar().querySelectorAll("nav[aria-label=Módulos] p.sr-only")];
    expect(groupTitles.length).toBeGreaterThan(0);
    for (const title of groupTitles) expect(title.parentElement!.classList.contains("relative")).toBe(true);
  });

  it("o conteúdo usa o respiro variável (.app-content), que encolhe em janela estreita", async () => {
    await openShell();
    const content = document.querySelector("main")!.firstElementChild!;
    expect(content.classList.contains("app-content")).toBe(true);
    expect(content.className).not.toMatch(/(^|\s)p-\d/);
    expect(content.querySelector("[data-testid=conteudo]")).not.toBeNull();
  });
});
