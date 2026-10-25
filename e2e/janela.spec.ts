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

  test("sidebar em trilho; menus da conta e do assistente e a busca cabem na janela; a janela não rola", async ({ page }) => {
    const errors = watchErrors(page);
    // O login também cabe: a tela rola no próprio contêiner até o botão.
    await quickLogin(page);
    const sidebar = page.locator("aside").first();
    await expect(sidebar).toHaveAttribute("data-rail", "");

    await sidebar.getByRole("button", { name: "Abrir menu da conta" }).click();
    const account = page.locator("#account-menu");
    await expectInsideWindow(page, account, "menu da conta (trilho)");
    await expectInsideWindow(page, account.getByRole("switch", { name: "Tema escuro" }), "switch Tema escuro (trilho)");
    await page.keyboard.press("Escape");
    await expect(account).toHaveCount(0);

    await sidebar.getByRole("button", { name: "Assistente de IA" }).click();
    await expectInsideWindow(page, page.locator("#assistant-menu"), "menu do assistente (trilho)");
    await page.keyboard.press("Escape");

    await sidebar.getByRole("button", { name: "Buscar" }).click();
    await expectInsideWindow(page, page.getByRole("dialog", { name: "Buscar" }), "busca");
    await page.keyboard.press("Escape");

    // Expandida numa janela estreita, a sidebar abre por cima do conteúdo; o menu da conta abre para cima e cabe.
    await sidebar.getByRole("button", { name: "Expandir sidebar" }).click();
    await expect(sidebar).toHaveAttribute("data-overlay", "");
    await sidebar.getByRole("button", { name: "Abrir menu da conta" }).click();
    await expectInsideWindow(page, page.locator("#account-menu"), "menu da conta (sidebar por cima)");
    await page.keyboard.press("Escape");
    await expect(sidebar).toHaveAttribute("data-rail", "");

    // Rodinha do mouse sobre a borda entre o trilho e o conteúdo: só o conteúdo rola, a casca fica no lugar.
    const rail = (await sidebar.boundingBox())!;
    await page.mouse.move(rail.x + rail.width + 1, MIN_WINDOW.height / 2);
    for (let step = 0; step < 6; step++) await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => document.querySelector("main")!.scrollTop)).toBeGreaterThan(0);
    const shell = await page.evaluate(() => ({
      window: document.scrollingElement!.scrollTop,
      sidebarTop: document.querySelector("aside")!.getBoundingClientRect().top,
      pageWidth: document.documentElement.scrollWidth,
    }));
    expect(shell).toEqual({ window: 0, sidebarTop: 0, pageWidth: MIN_WINDOW.width });

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
