import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import type { InventoryItem, PriceList, PriceListItem, Product } from "@/types";
import { applyPercentToPriceList, deletePriceList, deleteProduct, removePriceListItem, savePriceList, savePriceListItem, saveProduct, setProductActive } from "./catalog";
import { seedTradeFixture, type TradeFixture } from "./tradeFixtures";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

async function setup(): Promise<{ db: TestDb; fx: TradeFixture }> {
  db = await createTestDb();
  const { companyId, userIds } = await insertTestCompany(db, { roles: ["ceo", "estoquista"] });
  await insertTestCompany(db, { companyId: "outra", roles: ["admin"] });
  return { db, fx: await seedTradeFixture(db, companyId, userIds.estoquista!) };
}

const one = async <T>(table: string, id: string): Promise<T> => (await db!.select<T[]>(`SELECT * FROM ${table} WHERE id=?`, [id]))[0];

describe("produtos e serviços", () => {
  it("cadastra com SKU aparado, SKU vazio vira NULL e serviço nunca liga estoque", async () => {
    const { db, fx } = await setup();
    const id = await saveProduct(db, fx.companyId, { name: "  Roteador AX  ", sku: "  rot-ax  ", kind: "produto", unit: "un", price: 900, cost: 600, taxRate: 5, category: "Rede" });
    expect(await one<Product>("products", id)).toMatchObject({ name: "Roteador AX", sku: "rot-ax", kind: "produto", price: 900, cost: 600, tax_rate: 5, active: 1, inventory_item_id: null });
    const noSku = await saveProduct(db, fx.companyId, { name: "Sem código", sku: "   ", kind: "produto", price: 1 });
    const noSku2 = await saveProduct(db, fx.companyId, { name: "Sem código 2", sku: "", kind: "produto", price: 1 });
    expect((await one<Product>("products", noSku)).sku).toBeNull();
    expect((await one<Product>("products", noSku2)).sku).toBeNull();
    const service = await saveProduct(db, fx.companyId, { name: "Hora extra", kind: "servico", price: 200, unit: "h", inventoryItemId: fx.items.mouse });
    expect((await one<Product>("products", service)).inventory_item_id).toBeNull();
  });

  it("recusa SKU repetido (sem diferenciar maiúsculas), preço negativo e item de estoque de outra empresa", async () => {
    const { db, fx } = await setup();
    await expect(saveProduct(db, fx.companyId, { name: "Outro switch", sku: "fx-sw", kind: "produto", price: 1 })).rejects.toThrow(/SKU/);
    await expect(saveProduct(db, fx.companyId, { name: "X", kind: "produto", price: -1 })).rejects.toThrow(/preço/i);
    await expect(saveProduct(db, fx.companyId, { name: " ", kind: "produto", price: 1 })).rejects.toThrow(/nome/i);
    await db.execute("INSERT INTO inventory_items (id, company_id, name) VALUES (?, ?, ?)", ["item-outra", "outra", "Item de outra empresa"]);
    await expect(saveProduct(db, fx.companyId, { name: "X", kind: "produto", price: 1, inventoryItemId: "item-outra" })).rejects.toThrow(/item de estoque/i);
    // Editar mantendo o próprio SKU não conflita; SKU de produto excluído pode ser reaproveitado.
    await saveProduct(db, fx.companyId, { name: "Switch 24 portas PoE", sku: "FX-SW", kind: "produto", price: 3100, inventoryItemId: fx.items.switch }, fx.products.switch);
    expect((await one<Product>("products", fx.products.switch)).price).toBe(3100);
    await deleteProduct(db, fx.companyId, fx.products.mouse);
    expect((await one<Product>("products", fx.products.mouse)).deleted_at).toBeTruthy();
    await expect(saveProduct(db, fx.companyId, { name: "Mouse novo", sku: "FX-MOUSE", kind: "produto", price: 90 })).resolves.toBeTruthy();
  });

  it("cria e liga um item de estoque quando pedido", async () => {
    const { db, fx } = await setup();
    const id = await saveProduct(db, fx.companyId, { name: "Câmera IP", sku: "CAM-IP", kind: "produto", unit: "un", price: 700, cost: 450, category: "Segurança", createStockItem: true });
    const product = await one<Product>("products", id);
    expect(product.inventory_item_id).toBeTruthy();
    expect(await one<InventoryItem>("inventory_items", product.inventory_item_id!)).toMatchObject({ company_id: fx.companyId, name: "Câmera IP", sku: "CAM-IP", unit: "un", cost: 450, category: "Segurança" });
  });

  it("ativa e inativa", async () => {
    const { db, fx } = await setup();
    await setProductActive(db, fx.companyId, fx.products.inativo, true);
    expect((await one<Product>("products", fx.products.inativo)).active).toBe(1);
    await setProductActive(db, fx.companyId, fx.products.inativo, false);
    expect((await one<Product>("products", fx.products.inativo)).active).toBe(0);
    await expect(setProductActive(db, "outra", fx.products.inativo, true)).rejects.toThrow(/não encontrado/i);
  });
});

describe("tabelas de preço", () => {
  it("só uma tabela padrão; vigência coerente", async () => {
    const { db, fx } = await setup();
    const id = await savePriceList(db, fx.companyId, { name: "Black Friday", isDefault: true, validFrom: "2026-11-20", validTo: "2026-11-30" });
    expect(await one<PriceList>("price_lists", id)).toMatchObject({ is_default: 1, valid_from: "2026-11-20", valid_to: "2026-11-30", active: 1 });
    expect((await one<PriceList>("price_lists", fx.priceLists.padrao)).is_default).toBe(0);
    await expect(savePriceList(db, fx.companyId, { name: "Errada", validFrom: "2026-12-01", validTo: "2026-11-01" })).rejects.toThrow(/vigência/i);
    await expect(savePriceList(db, fx.companyId, { name: "" })).rejects.toThrow(/nome/i);
  });

  it("um preço por produto e quantidade mínima; remover e excluir a tabela", async () => {
    const { db, fx } = await setup();
    const itemId = await savePriceListItem(db, fx.companyId, { priceListId: fx.priceLists.revenda, productId: fx.products.mouse, price: 72, minQty: 1 });
    await expect(savePriceListItem(db, fx.companyId, { priceListId: fx.priceLists.revenda, productId: fx.products.mouse, price: 70, minQty: 1 })).rejects.toThrow(/já tem preço/i);
    await expect(savePriceListItem(db, fx.companyId, { priceListId: fx.priceLists.revenda, productId: fx.products.mouse, price: -1, minQty: 5 })).rejects.toThrow(/preço/i);
    await expect(savePriceListItem(db, fx.companyId, { priceListId: fx.priceLists.revenda, productId: fx.products.mouse, price: 1, minQty: 0 })).rejects.toThrow(/quantidade/i);
    await savePriceListItem(db, fx.companyId, { priceListId: fx.priceLists.revenda, productId: fx.products.mouse, price: 71, minQty: 1 }, itemId);
    expect((await one<PriceListItem>("price_list_items", itemId)).price).toBe(71);
    await removePriceListItem(db, fx.companyId, itemId);
    expect((await one<PriceListItem>("price_list_items", itemId)).deleted_at).toBeTruthy();
    // Removido, o mesmo produto e quantidade podem voltar.
    await expect(savePriceListItem(db, fx.companyId, { priceListId: fx.priceLists.revenda, productId: fx.products.mouse, price: 70, minQty: 1 })).resolves.toBeTruthy();

    await deletePriceList(db, fx.companyId, fx.priceLists.revenda);
    expect((await one<PriceList>("price_lists", fx.priceLists.revenda)).deleted_at).toBeTruthy();
    const left = await db.select<PriceListItem[]>("SELECT * FROM price_list_items WHERE price_list_id=? AND deleted_at IS NULL", [fx.priceLists.revenda]);
    expect(left).toEqual([]);
  });

  it("aplica um percentual sobre o preço do catálogo (cria ou atualiza o preço a partir de 1 unidade)", async () => {
    const { db, fx } = await setup();
    const result = await applyPercentToPriceList(db, fx.companyId, fx.priceLists.revenda, -10);
    // Ativos: switch (já tinha 2.700 → 2.700), mouse e visita (novos). O inativo fica de fora.
    expect(result).toEqual({ created: 2, updated: 1 });
    const items = await db.select<PriceListItem[]>("SELECT * FROM price_list_items WHERE price_list_id=? AND deleted_at IS NULL", [fx.priceLists.revenda]);
    const byProduct = Object.fromEntries(items.map((item) => [item.product_id, item.price]));
    expect(byProduct).toEqual({ [fx.products.switch]: 2700, [fx.products.mouse]: 72, [fx.products.visita]: 225 });
    await expect(applyPercentToPriceList(db, fx.companyId, fx.priceLists.revenda, -100)).rejects.toThrow(/percentual/i);
  });
});
