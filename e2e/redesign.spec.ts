// QA do redesign modular (Tarefa 11 de docs/superpowers/plans/2026-10-25-redesign-modular.md) no navegador, com o
// banco demo (localStorage; cada teste abre um contexto novo, então começa com o banco demo limpo).
// Rodar: `npx playwright test` (sobe `vite` na porta 1420 se não houver servidor) ou `E2E_PORT=1431 npx playwright test`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const ICS = readFileSync(fileURLToPath(new URL("../src/lib/calendar/fixtures/google-semanal.ics", import.meta.url)), "utf8");
const ICS_URL = "https://agenda.exemplo.test/equipe/basic.ics";
const ICS_OFFLINE_URL = "https://agenda.exemplo.test/fora-do-ar.ics";

/** Erros de página e de console (exceto os de rede esperados, como o 404 da agenda fora do ar). */
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

/** Página do módulo carregada: o código dela vem sob demanda na primeira visita (carregando só no conteúdo). */
async function pageLoaded(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main [data-page-loading]")).toHaveCount(0);
  await expect(page.locator("aside nav")).toBeVisible();
}

async function quickLogin(page: Page, area = "CEO") {
  await page.goto("/");
  await page.getByRole("button", { name: `Entrar rápido como ${area}` }).click();
  await expect(page.getByRole("button", { name: "Abrir menu da conta" })).toBeVisible();
}

test.describe("redesign modular", () => {
  test("shell sem top bar: busca, assistente acima do Dashboard e conta no rodapé", async ({ page }) => {
    const errors = watchErrors(page);
    await quickLogin(page);

    await expect(page.getByRole("banner")).toHaveCount(0);

    const sidebar = page.locator("aside").first();
    const search = sidebar.getByRole("button", { name: "Buscar" });
    const assistant = sidebar.getByRole("button", { name: "Assistente de IA" });
    const dashboard = sidebar.getByRole("link", { name: "Dashboard" });
    const account = sidebar.getByRole("button", { name: "Abrir menu da conta" });
    await expect(search).toBeVisible();
    const top = async (locator: typeof search) => (await locator.boundingBox())!.y;
    expect(await top(search)).toBeLessThan(await top(assistant));
    expect(await top(assistant)).toBeLessThan(await top(dashboard));
    expect(await top(dashboard)).toBeLessThan(await top(account));

    // O conteúdo ocupa a altura toda da janela (não há faixa de top bar acima dele).
    const main = (await page.locator("main").boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(main.y).toBe(0);
    expect(Math.round(main.height)).toBe(viewport.height);

    // ⌘K / Buscar abre a busca.
    await search.click();
    await expect(page.getByPlaceholder(/buscar/i).first()).toBeVisible();
    await page.keyboard.press("Escape");

    expect(errors).toEqual([]);
  });

  test("menu da conta: notificações e switch do tema escuro", async ({ page }) => {
    const errors = watchErrors(page);
    await quickLogin(page);

    await page.getByRole("button", { name: "Abrir menu da conta" }).click();
    const menu = page.locator("#account-menu");
    await expect(menu).toBeVisible();

    const theme = menu.getByRole("switch", { name: "Tema escuro" });
    await expect(theme).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await theme.click();
    await expect(theme).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await theme.click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    const notifications = menu.getByRole("button", { name: "Notificações" });
    await notifications.click();
    await expect(notifications).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByText("Novo ticket aguardando atendimento")).toBeVisible();
    await menu.getByRole("button", { name: "Marcar todas como lidas" }).click();
    await expect(menu.getByLabel("nenhuma não lida")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("clientes: editar uma célula, salvar e ver o valor depois de Atualizar", async ({ page }) => {
    const errors = watchErrors(page);
    await quickLogin(page);
    await page.goto("/crm");

    const table = page.locator('[data-editable-table="customers"]');
    const firstRow = table.locator("tbody tr[data-row-key]").first();
    await expect(firstRow).toBeVisible();
    const rowKey = await firstRow.getAttribute("data-row-key");
    const row = table.locator(`tr[data-row-key="${rowKey}"]`);
    const segment = `Segmento E2E ${Date.now()}`;

    await table.getByRole("button", { name: "Editar" }).click();
    await row.locator('td[data-column="segment"] input').fill(segment);
    await expect(row).toHaveAttribute("data-changed", "true");

    // Atualizar com rascunho pergunta antes; "Continuar editando" (Cancelar) mantém o rascunho.
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("alterações não salvas");
      void dialog.dismiss();
    });
    await table.getByRole("button", { name: "Atualizar" }).click();
    await expect(row.locator('td[data-column="segment"] input')).toHaveValue(segment);

    await table.getByRole("button", { name: "Salvar" }).click();
    await expect(table.getByRole("status")).toHaveText("1 linha salva.");
    await table.getByRole("button", { name: "Atualizar" }).click();
    await expect(row.locator('td[data-column="segment"]')).toHaveText(segment);

    // Gravou no banco (demo: localStorage): continua lá depois de recarregar a página.
    await page.reload();
    await expect(page.locator(`[data-editable-table="customers"] tr[data-row-key="${rowKey}"] td[data-column="segment"]`)).toHaveText(segment);

    expect(errors).toEqual([]);
  });

  test("papel sem permissão de edição: Editar e Adicionar desativados com dica", async ({ page }) => {
    const errors = watchErrors(page);
    await quickLogin(page, "Auditoria");
    await page.goto("/finance");

    const tables = page.locator("[data-editable-table]:visible");
    await expect(tables.first()).toBeVisible();
    for (const table of await tables.all()) {
      for (const name of ["Editar", "Adicionar"]) {
        const button = table.getByRole("button", { name });
        await expect(button).toBeDisabled();
        await expect(button).toHaveAttribute("title", /permissão/);
      }
      await expect(table.getByRole("button", { name: "Atualizar" })).toBeEnabled();
    }

    expect(errors).toEqual([]);
  });

  test("dashboard: 4 cards só com título e número e gráfico com 3 linhas", async ({ page }) => {
    const errors = watchErrors(page);
    await quickLogin(page);

    const overview = page.locator("[data-overview]");
    const cards = overview.locator("[data-card]");
    await expect(cards).toHaveCount(4);
    await expect(overview.locator("[data-kpi-value]")).toHaveCount(4);
    for (const card of await cards.all()) {
      // Título + número: dois parágrafos, nada embaixo do número.
      await expect(card.locator("p")).toHaveCount(2);
      await expect(card.locator("[data-kpi-value]")).toHaveText(/\S/);
    }
    await expect(cards.nth(0)).toContainText(/Lucro do mês|Dívida do mês/);
    await expect(cards.nth(1)).toContainText("A pagar na semana");
    await expect(cards.nth(2)).toContainText("A receber na semana");

    const chart = page.locator('[data-chart="balance"]');
    await expect(chart.locator(".recharts-line")).toHaveCount(3);
    await expect(chart.locator(".recharts-line-curve")).toHaveCount(3);
    await expect(chart.locator(".recharts-line-curve").nth(2)).toHaveAttribute("stroke-dasharray", "6 5");
    await expect(chart.locator("[data-legend]")).toHaveText(["Resultado do mês", "Acumulado no ano", "Previsão de receita"]);

    expect(errors).toEqual([]);
  });

  test("login rápido nas 11 áreas abre todas as telas e abas sem erro", async ({ browser }) => {
    test.setTimeout(300_000);
    const areas = ["CEO", "Admin", "Gerência", "TI", "Estoque", "Financeiro", "RH", "Comercial", "Atendimento", "Produtos", "Auditoria"];
    const problems: string[] = [];
    let pages = 0;
    for (const area of areas) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = watchErrors(page);
      await quickLogin(page, area);
      const visited = new Set<string>();
      const nav = page.locator('aside nav[aria-label="Módulos"]');
      const modules = await nav.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
      expect(modules.length, `${area}: módulos na sidebar`).toBeGreaterThan(1);
      for (const href of modules) {
        visited.add(href);
        await nav.locator(`a[href="${href}"]`).click();
        await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/|$|\\?)`));
        await pageLoaded(page);
        // Abas visíveis do módulo (ModuleNav e abas da página) que o papel abre.
        const tabs = await page.locator("main nav a:visible").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
        for (const tab of tabs) {
          if (!tab || visited.has(tab)) continue;
          visited.add(tab);
          const link = page.locator(`main nav a[href="${tab}"]:visible`).first();
          if (!(await link.count())) continue;
          await link.click();
          await pageLoaded(page);
          for (const alert of await page.locator("main [role=alert]").allInnerTexts()) if (alert.trim()) problems.push(`${area} ${tab}: ${alert}`);
        }
        for (const alert of await page.locator("main [role=alert]").allInnerTexts()) if (alert.trim()) problems.push(`${area} ${href}: ${alert}`);
      }
      problems.push(...errors.map((error) => `${area}: ${error}`));
      pages += visited.size;
      await context.close();
    }
    expect(problems).toEqual([]);
    // Módulos + abas somados nas 11 áreas (eram 296 em 25/10/2026); bem menos que isso = a varredura não achou as abas.
    expect(pages).toBeGreaterThan(200);
  });

  test("calendário: agenda por link iCal (fixture) e link fora do ar sem derrubar a outra", async ({ page }) => {
    const errors = watchErrors(page);
    // Outubro de 2026, o mês da fixture (reunião semanal às terças, 09:00 de São Paulo, desde 06/10).
    await page.clock.setFixedTime(new Date("2026-10-20T12:00:00-03:00"));
    await page.route(ICS_URL, (route) => route.fulfill({ status: 200, body: ICS, headers: { "Content-Type": "text/calendar; charset=utf-8", "Access-Control-Allow-Origin": "*" } }));
    await page.route(ICS_OFFLINE_URL, (route) => route.fulfill({ status: 404, body: "not found", headers: { "Access-Control-Allow-Origin": "*" } }));

    await quickLogin(page);
    await page.goto("/calendar");
    await page.getByRole("tab", { name: "Agendas conectadas" }).click();

    const sources = page.locator('[data-editable-table="calendar"]').first();
    await sources.getByRole("button", { name: "Adicionar" }).click();
    await sources.getByLabel("Nome (nova linha)").fill("Equipe (Google)");
    await sources.getByLabel("Link iCal (nova linha)").fill(ICS_URL);
    await sources.getByRole("button", { name: "Adicionar" }).click();
    await sources.getByLabel("Nome (nova linha)").first().fill("Agenda fora do ar");
    await sources.getByLabel("Link iCal (nova linha)").first().fill(ICS_OFFLINE_URL);
    await sources.getByRole("button", { name: "Salvar" }).click();
    await expect(sources.getByRole("status")).toHaveText("2 linhas salvas.");

    const okRow = sources.locator("tbody tr", { hasText: "Equipe (Google)" });
    const badRow = sources.locator("tbody tr", { hasText: "Agenda fora do ar" });
    await expect(okRow).toContainText("Sincronizada em");
    await expect(badRow.locator(".text-destructive")).toContainText(/404|não|erro/i);
    await expect(page.getByRole("button", { name: "1 agenda com erro" })).toBeVisible();

    await page.getByRole("tab", { name: "Calendário" }).click();
    const grid = page.locator("[data-calendar-grid]").first();
    // 4 terças em outubro (a grade de 6 semanas também mostra 03/11, fora do mês).
    await expect(grid.locator('[data-day^="2026-10-"] [data-item-id]', { hasText: "Reunião semanal" })).toHaveCount(4);
    for (const day of ["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"]) {
      await expect(grid.locator(`[data-day="${day}"] [data-item-id]`, { hasText: "Reunião semanal" })).toContainText("09:00");
    }
    await expect(grid.locator('[data-day="2026-10-12"] [data-item-id]', { hasText: "Feriado" })).toBeVisible();
    // 17:00 UTC = 14:00 em São Paulo.
    await expect(grid.locator('[data-day="2026-10-15"] [data-item-id]', { hasText: "Call com cliente" })).toContainText("14:00");

    expect(errors).toEqual([]);
  });
});
