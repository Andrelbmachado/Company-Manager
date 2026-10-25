// Catálogo e tabelas de preço pela tela: cadastro com item de estoque, SKU repetido, desativar, preço na tabela e reajuste.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import { buttonIn, choose, click, dialog, field, mountPage, typeInto, until, type Mounted } from "../testHarness";
import type { InventoryItem, PriceListItem, Product } from "@/types";
import CatalogPage from "./CatalogPage";
import PriceListsPage from "./PriceListsPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

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

describe("CatalogPage", () => {
  it("cadastra produto criando o item de estoque e recusa SKU repetido", async () => {
    page = await open("estoquista", "/catalog");
    await until(() => text().includes("Switch 24 portas"), "lista do catálogo");
    expect(text()).not.toContain("Produto fora de linha");

    await click(buttonIn(page.container, "Novo produto ou serviço"));
    let form = dialog("Novo produto ou serviço");
    await typeInto(field(form, "Nome"), "Câmera IP");
    await typeInto(field(form, "SKU"), "CAM-1");
    await typeInto(field(form, "Preço de venda"), "700");
    await typeInto(field(form, "Custo"), "450");
    await choose(field<HTMLSelectElement>(form, "Item de estoque"), "__novo__");
    await click(buttonIn(form, "Salvar"));
    await until(async () => Boolean(await productBySku("CAM-1")), "produto gravado");
    const product = await productBySku("CAM-1");
    const [item] = await testDb().select<InventoryItem[]>("SELECT * FROM inventory_items WHERE id = ?", [product.inventory_item_id]);
    expect(item).toMatchObject({ name: "Câmera IP", sku: "CAM-1", cost: 450 });
    await until(() => Boolean(document.querySelector("[role=dialog][aria-label='Câmera IP']")), "detalhe do produto aberto");
    expect(document.body.textContent).toContain("35,7%");

    await click(buttonIn(dialog("Câmera IP"), "Fechar") ?? document.querySelector("[role=dialog][aria-label='Câmera IP'] button[aria-label=Fechar]"));
    await click(buttonIn(page.container, "Novo produto ou serviço"));
    form = dialog("Novo produto ou serviço");
    await typeInto(field(form, "Nome"), "Outra câmera");
    await typeInto(field(form, "SKU"), "cam-1");
    await typeInto(field(form, "Preço de venda"), "1");
    await click(buttonIn(form, "Salvar"));
    await until(() => (dialog("Novo produto ou serviço").textContent ?? "").includes('Já existe um produto com o SKU "cam-1"'), "erro de SKU");
  });

  it("desativa pelo detalhe; comercial só consulta", async () => {
    page = await open("estoquista", "/catalog");
    await until(() => text().includes("Mouse USB"), "lista");
    await click([...page.container.querySelectorAll("tr")].find((row) => row.textContent?.includes("Mouse USB")));
    await click(buttonIn(dialog("Mouse USB"), "Desativar"));
    await until(async () => (await productBySku("FX-MOUSE")).active === 0, "desativado");
    page.unmount();

    page = await open("comercial", "/catalog");
    await until(() => text().includes("Switch 24 portas"), "lista");
    expect(buttonIn(page.container, "Novo produto ou serviço")).toBeUndefined();
    await click([...page.container.querySelectorAll("tr")].find((row) => row.textContent?.includes("Switch 24 portas")));
    expect(buttonIn(dialog("Switch 24 portas"), "Desativar")).toBeUndefined();
    expect(buttonIn(dialog("Switch 24 portas"), "Editar")).toBeUndefined();
    expect(dialog("Switch 24 portas").textContent).toContain("Revenda");
  });
});

describe("PriceListsPage", () => {
  it("adiciona preço com faixa e aplica percentual na tabela escolhida", async () => {
    page = await open("estoquista", "/catalog/tabelas-de-preco");
    await until(() => text().includes("Tabela padrão") && text().includes("Revenda"), "tabelas");
    await click([...page.container.querySelectorAll("nav[aria-label='Tabelas de preço'] button")].find((button) => button.textContent?.includes("Revenda")));
    await until(() => text().includes("Clientes: Cliente Revenda"), "tabela Revenda aberta");

    await click(buttonIn(page.container, "Adicionar preço"));
    const form = dialog("Adicionar preço");
    await choose(field<HTMLSelectElement>(form, "Produto ou serviço"), fx.products.mouse);
    expect(field(form, "Preço nesta tabela").value).toBe("80");
    await typeInto(field(form, "A partir de"), "20");
    await typeInto(field(form, "Preço nesta tabela"), "60");
    await click(buttonIn(form, "Salvar"));
    await until(async () => (await testDb().select<PriceListItem[]>("SELECT * FROM price_list_items WHERE price_list_id = ? AND product_id = ?", [fx.priceLists.revenda, fx.products.mouse])).length === 1, "preço gravado");

    await click(buttonIn(page.container, "Aplicar % sobre o catálogo"));
    const percent = dialog("Aplicar percentual sobre o catálogo");
    await typeInto(field(percent, "Percentual"), "-10");
    await choose(field<HTMLSelectElement>(percent, "Itens"), "produto");
    await click(buttonIn(percent, "Aplicar"));
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
});
