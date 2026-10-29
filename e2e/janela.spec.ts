// Casca do app numa janela pequena e na impressão (pedido do André de 2026-10-25): o app chega a 1/5 da largura e
// 1/3 da altura da tela (num MacBook Air 13", 1470 × 956 pontos, isso dá 294 × 318), só a área de conteúdo rola e o
// relatório impresso/em PDF não fica preso à altura da janela.
// Rodar: `npx playwright test e2e/janela.spec.ts` (ou com E2E_PORT, ver playwright.config.ts).
import { expect, test, type Locator, type Page } from "@playwright/test";

const MIN_WINDOW = { width: 294, height: 318 };

/** Erros de página e de console (exceto os de rede). */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource|404|ERR_/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

async function quickLogin(page: Page, area = "CEO") {
  await page.goto("/");
  await page.getByRole("button", { name: `Entrar rápido como ${area}` }).click();
  await expect(page.getByRole("button", { name: "Abrir menu da conta" })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

async function expectInsideWindow(page: Page, locator: Locator, what: string) {
  await expect(locator, what).toBeVisible();
  const box = (await locator.boundingBox())!;
  const { width, height } = page.viewportSize()!;
  expect(box.x, `${what}: borda esquerda`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${what}: topo`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${what}: borda direita`).toBeLessThanOrEqual(width);
  expect(box.y + box.height, `${what}: base`).toBeLessThanOrEqual(height);
}

test.describe("janela mínima (1/5 × 1/3 da tela)", () => {
  test.use({ viewport: MIN_WINDOW });

  test("sidebar fechada (só o botão de abrir); menus da conta e do assistente e a busca cabem na janela; a janela não rola", async ({ page }) => {
    const errors = watchErrors(page);
    // O login também cabe: a tela rola no próprio contêiner até o botão.
    await quickLogin(page);
    await expect(page.locator("[data-sidebar-closed]")).toBeVisible();
    await expect(page.locator("aside")).toHaveCount(0);

    // Aberta numa janela estreita, a sidebar fica por cima do conteúdo; o menu da conta abre para cima e cabe.
    await page.getByRole("button", { name: "Expandir sidebar" }).click();
    const sidebar = page.locator("aside").first();
    await expect(sidebar).toHaveAttribute("data-overlay", "");
    await sidebar.getByRole("button", { name: "Abrir menu da conta" }).click();
    const account = page.locator("#account-menu");
    await expectInsideWindow(page, account, "menu da conta (sidebar por cima)");
    await expectInsideWindow(page, account.getByRole("switch", { name: "Tema escuro" }), "switch Tema escuro");
    await page.keyboard.press("Escape");
    await expect(account).toHaveCount(0);

    await sidebar.getByRole("button", { name: "Assistente de IA" }).click();
    await expectInsideWindow(page, page.locator("#assistant-menu"), "menu do assistente");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-sidebar-closed]")).toBeVisible();

    await page.keyboard.press("Control+k");
    await expectInsideWindow(page, page.getByRole("dialog", { name: "Buscar" }), "busca");
    await page.keyboard.press("Escape");

    // Rodinha do mouse sobre a borda entre o botão da sidebar e o conteúdo: só o conteúdo rola, a casca fica no lugar.
    const rail = (await page.locator("[data-sidebar-closed]").boundingBox())!;
    await page.mouse.move(rail.x + rail.width + 1, MIN_WINDOW.height / 2);
    for (let step = 0; step < 6; step++) await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => document.querySelector("main")!.scrollTop)).toBeGreaterThan(0);
    const shell = await page.evaluate(() => ({
      window: document.scrollingElement!.scrollTop,
      sidebarTop: document.querySelector("[data-sidebar-closed]")!.getBoundingClientRect().top,
      pageWidth: document.documentElement.scrollWidth,
    }));
    expect(shell).toEqual({ window: 0, sidebarTop: 0, pageWidth: MIN_WINDOW.width });

    expect(errors).toEqual([]);
  });
});

test.describe("largura mínima do app (240 px, o piso do tauri.conf.json)", () => {
  test.use({ viewport: { width: 240, height: 318 } });

  test("nenhuma tela dos módulos (e das abas) estoura a largura da área de conteúdo", async ({ page }) => {
    test.setTimeout(300_000);
    const errors = watchErrors(page);
    await quickLogin(page);
    // Janela estreita: a sidebar fica fechada e abre por cima a cada navegação.
    const modules = page.locator('aside nav[aria-label="Módulos"]');
    const openSidebar = async () => {
      if (await page.locator("[data-sidebar-closed]").count()) await page.getByRole("button", { name: "Expandir sidebar" }).click();
    };
    await openSidebar();
    const routes = await modules.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    const visited = new Set<string>();
    const overflowing: string[] = [];

    // Visita a rota pelo link (navegação do app, sem recarregar) e depois as abas dela, inclusive as abas das abas.
    async function visit(route: string, link: Locator) {
      visited.add(route);
      await link.click();
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main [data-page-loading]")).toHaveCount(0);
      // O que é largo (tabela, abas) rola no próprio contêiner; o conteúdo da tela não ganha rolagem lateral.
      const width = await page.evaluate(() => {
        const main = document.querySelector("main")!;
        return { scroll: main.scrollWidth, client: main.clientWidth };
      });
      if (width.scroll > width.client + 1) overflowing.push(`${route} (${width.scroll} > ${width.client})`);
      const tabs = await page.locator("main nav a:visible").evaluateAll((links) => links.map((item) => item.getAttribute("href") ?? ""));
      for (const tab of tabs) {
        if (!tab || visited.has(tab)) continue;
        await visit(tab, page.locator(`main nav a[href="${tab}"]`).first());
      }
    }

    for (const route of routes) {
      if (!route || visited.has(route)) continue;
      await openSidebar();
      await visit(route, modules.locator(`a[href="${route}"]`).first());
    }
    expect(visited.size).toBeGreaterThan(30);
    expect(overflowing).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test("impressão: a folha do relatório passa de uma página (a janela travada não corta o PDF)", async ({ page }) => {
  await quickLogin(page);
  // Mesma função dos botões PDF dos relatórios, com 200 linhas; window.print vira nada para gerar o PDF aqui.
  await page.evaluate(async () => {
    const { printReport } = await import("/src/lib/reports/export.ts");
    window.print = () => undefined;
    const rows = Array.from({ length: 200 }, (_, index) => ({ nome: `Linha ${index + 1}`, valor: index * 10 }));
    await printReport({
      title: "Relatório longo",
      columns: [{ key: "nome", label: "Nome", kind: "text" }, { key: "valor", label: "Valor", kind: "money" }],
      rows,
      fileName: "relatorio-longo",
    });
  });
  const pdf = await page.pdf();
  const pages = pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
  // 200 linhas em A4 paisagem dão 9 páginas; presa à janela, a folha saía com uma.
  expect(pages).toBeGreaterThan(5);
});
