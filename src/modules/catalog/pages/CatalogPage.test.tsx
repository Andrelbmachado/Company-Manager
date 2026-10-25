// Catálogo e tabelas de preço pela tela (edição na própria tabela): cadastro com item de estoque, SKU repetido,
// desativar, consulta do comercial, preço na tabela e reajuste por percentual.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import { buttonIn, choose, click, mountPage, typeInto, until, type Mounted } from "../testHarness";
import type { InventoryItem, PriceListItem, Product } from "@/types";
import CatalogPage from "./CatalogPage";
import PriceListsPage from "./PriceListsPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let fx: TradeFixture;
let page: Mounted;

beforeEach(async () => {
  const { companyId } = await insertTestCompany(testDb(), { roles: ["estoquista", "comercial"] });
  fx = await seedTradeFixture(testDb(), companyId, "test-user-estoquista");
});

afterEach(() => page?.unmount());

const text = () => page.container.textContent ?? "";
const open = (role: "estoquista" | "comercial", path: string) => mountPage({ companyId: fx.companyId, role, path, routes: [{ path: "/catalog", element: <CatalogPage /> }, { path: "/catalog/tabelas-de-preco", element: <PriceListsPage /> }] });
const productBySku = async (sku: string) => (await testDb().select<Product[]>("SELECT * FROM products WHERE company_id = ? AND sku = ?", [fx.companyId, sku]))[0];
const table = (resource: string, index = 0) => page.container.querySelectorAll<HTMLElement>(`[data-editable-table="${resource}"]`)[index]!;
const cell = <T extends HTMLElement = HTMLInputElement>(scope: ParentNode, label: string) => scope.querySelector<T>(`[aria-label="${label}"]`);
const rowOf = (scope: ParentNode, name: string) => [...scope.querySelectorAll<HTMLTableRowElement>("tr[data-row-key]")].find((row) => row.textContent?.includes(name));
const alertText = () => [...page.container.querySelectorAll("[role=alert]")].map((node) => node.textContent).join(" ");

describe("CatalogPage", () => {
  it("cadastra produto criando o item de estoque e recusa SKU repetido, tudo na tabela", async () => {
    page = await open("estoquista", "/catalog");
    await until(() => text().includes("Switch 24 portas"), "lista do catálogo");
    expect(text()).not.toContain("Produto fora de linha");

    const products = table("products");
    await click(buttonIn(products, "Adicionar"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await typeInto(cell(products, "Nome (nova linha)"), "Câmera IP");
    await typeInto(cell(products, "SKU (nova linha)"), "CAM-1");
    await typeInto(cell(products, "Preço (nova linha)"), "700");
    await typeInto(cell(products, "Custo (nova linha)"), "450");
    await choose(cell<HTMLSelectElement>(products, "Item de estoque (nova linha)"), "__novo__");
    await click(buttonIn(products, "Salvar"));
    await until(async () => Boolean(await productBySku("CAM-1")), "produto gravado");
    const product = await productBySku("CAM-1");
    const [item] = await testDb().select<InventoryItem[]>("SELECT * FROM inventory_items WHERE id = ?", [product.inventory_item_id]);
    expect(item).toMatchObject({ name: "Câmera IP", sku: "CAM-1", cost: 450 });
    await until(() => Boolean(rowOf(products, "Câmera IP")), "linha da câmera");
    expect(rowOf(products, "Câmera IP")!.textContent).toContain("35,7%");

    await click(buttonIn(products, "Adicionar"));
    await typeInto(cell(products, "Nome (nova linha)"), "Outra câmera");
    await typeInto(cell(products, "SKU (nova linha)"), "cam-1");
    await typeInto(cell(products, "Preço (nova linha)"), "1");
    await click(buttonIn(products, "Salvar"));
    await until(() => alertText().includes('Já existe um produto com o SKU "cam-1"'), "erro de SKU");
    expect(cell(products, "Nome (nova linha)")?.value).toBe("Outra câmera");
  });

  it("edita NCM, código de barras, código do serviço e descrição na própria tabela", async () => {
    page = await open("estoquista", "/catalog");
    await until(() => text().includes("Visita técnica"), "lista do catálogo");
    const products = table("products");
    const lineOf = (name: string) => [...products.querySelectorAll("tr[data-row-key]")].findIndex((row) => row.textContent?.includes(name)) + 1;
    const mouse = lineOf("Mouse USB");
    const visit = lineOf("Visita técnica");
    await click(buttonIn(products, "Editar"));
    await typeInto(cell(products, `NCM (linha ${mouse})`), "8471.60.53");
    await typeInto(cell(products, `Código de barras (linha ${mouse})`), "7891234567895");
    await typeInto(cell(products, `Descrição (linha ${mouse})`), "Mouse óptico 1200 dpi");
    await typeInto(cell(products, `Código do serviço (linha ${visit})`), "14.01");
    await click(buttonIn(products, "Salvar"));
    await until(async () => (await productBySku("FX-VISITA")).service_code === "14.01", "código do serviço gravado");
    expect(await productBySku("FX-MOUSE")).toMatchObject({ ncm: "8471.60.53", barcode: "7891234567895", description: "Mouse óptico 1200 dpi", name: "Mouse USB" });
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("desativa pela coluna Ativo; detalhes na página; comercial só consulta", async () => {
    page = await open("estoquista", "/catalog");
    await until(() => text().includes("Mouse USB"), "lista");
    const products = table("products");
    const number = [...products.querySelectorAll("tr[data-row-key]")].findIndex((row) => row.textContent?.includes("Mouse USB")) + 1;
    await click(buttonIn(products, "Editar"));
    await click(cell(products, `Ativo (linha ${number})`));
    await click(buttonIn(products, "Salvar"));
    await until(async () => (await productBySku("FX-MOUSE")).active === 0, "desativado");
    page.unmount();

    page = await open("comercial", "/catalog");
    await until(() => text().includes("Switch 24 portas"), "lista");
    const readOnly = table("products");
    expect(buttonIn(readOnly, "Editar")?.disabled).toBe(true);
    expect(buttonIn(readOnly, "Adicionar")?.disabled).toBe(true);
    expect(page.container.querySelector("[aria-label='Excluir Switch 24 portas']")).toBeNull();
    await click(page.container.querySelector("[aria-label='Detalhes de Switch 24 portas']"));
    const details = page.container.querySelector("[aria-label='Detalhes: Switch 24 portas']");
    expect(details?.textContent).toContain("Revenda");
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
});

describe("PriceListsPage", () => {
  it("adiciona preço com faixa e aplica percentual na tabela escolhida", async () => {
    page = await open("estoquista", "/catalog/tabelas-de-preco");
    await until(() => text().includes("Tabela padrão") && text().includes("Revenda"), "tabelas");
    await click(page.container.querySelector("[aria-label='Abrir tabela Revenda']"));
    await until(() => text().includes("Clientes: Cliente Revenda"), "tabela Revenda aberta");

    const prices = table("products", 1);
    await click(buttonIn(prices, "Adicionar"));
    await choose(cell<HTMLSelectElement>(prices, "Produto / serviço (nova linha)"), fx.products.mouse);
    await typeInto(cell(prices, "A partir de (nova linha)"), "20");
    await typeInto(cell(prices, "Preço na tabela (nova linha)"), "60");
    await click(buttonIn(prices, "Salvar"));
    await until(async () => (await testDb().select<PriceListItem[]>("SELECT * FROM price_list_items WHERE price_list_id = ? AND product_id = ?", [fx.priceLists.revenda, fx.products.mouse])).length === 1, "preço gravado");

    await typeInto(cell(page.container, "Percentual (%)"), "-10");
    await choose(cell<HTMLSelectElement>(page.container, "Itens do reajuste"), "produto");
    await click(buttonIn(page.container, "Aplicar % sobre o catálogo"));
    await until(async () => {
      const rows = await testDb().select<PriceListItem[]>("SELECT * FROM price_list_items WHERE price_list_id = ? AND deleted_at IS NULL", [fx.priceLists.revenda]);
      return rows.length === 3;
    }, "percentual aplicado");
    const rows = await testDb().select<PriceListItem[]>("SELECT * FROM price_list_items WHERE price_list_id = ? AND deleted_at IS NULL ORDER BY product_id, min_qty", [fx.priceLists.revenda]);
    expect(rows.map((row) => [row.product_id, row.min_qty, row.price])).toEqual([
      [fx.products.mouse, 1, 72],
      [fx.products.mouse, 20, 60],
      [fx.products.switch, 1, 2700],
    ]);
  });

  it("nova tabela marcada como padrão tira a marca da antiga", async () => {
    page = await open("estoquista", "/catalog/tabelas-de-preco");
    await until(() => text().includes("Tabela padrão"), "tabelas");
    const lists = table("products", 0);
    await click(buttonIn(lists, "Adicionar"));
    await typeInto(cell(lists, "Tabela (nova linha)"), "Atacado");
    await click(cell(lists, "Padrão (nova linha)"));
    await click(buttonIn(lists, "Salvar"));
    await until(async () => (await testDb().select<{ name: string }[]>("SELECT name FROM price_lists WHERE company_id = ? AND is_default = 1", [fx.companyId])).map((row) => row.name).join() === "Atacado", "nova padrão");
  });
});
