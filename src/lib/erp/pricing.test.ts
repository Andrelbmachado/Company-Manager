import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import type { PriceList, PriceListItem } from "@/types";
import { computeLines, effectivePriceList, isPriceListValid, marginPercent, quoteItems, resolveUnitPrice, tierPrice } from "./pricing";
import { seedTradeFixture, type TradeFixture } from "./tradeFixtures";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

async function setup(): Promise<{ db: TestDb; fx: TradeFixture }> {
  db = await createTestDb();
  const { companyId, userIds } = await insertTestCompany(db, { roles: ["ceo", "comercial"] });
  return { db, fx: await seedTradeFixture(db, companyId, userIds.ceo!) };
}

const item = (id: string, productId: string, price: number, minQty: number, extra: Partial<PriceListItem> = {}): PriceListItem => ({
  id,
  company_id: "c",
  price_list_id: "pl",
  product_id: productId,
  price,
  min_qty: minQty,
  created_at: "",
  updated_at: "",
  deleted_at: null,
  ...extra,
});

const list = (extra: Partial<PriceList> = {}): PriceList => ({
  id: "pl",
  company_id: "c",
  name: "Tabela",
  is_default: 0,
  active: 1,
  valid_from: null,
  valid_to: null,
  created_at: "",
  updated_at: "",
  deleted_at: null,
  ...extra,
});

describe("preço por faixa de quantidade", () => {
  it("usa a faixa de maior quantidade mínima que a quantidade alcança", () => {
    const items = [item("a", "p1", 70, 10), item("b", "p1", 65, 50), item("c", "p2", 5, 1), item("d", "p1", 60, 100, { deleted_at: "2026-01-01" })];
    expect(tierPrice(items, "p1", 9)).toBeNull();
    expect(tierPrice(items, "p1", 10)?.price).toBe(70);
    expect(tierPrice(items, "p1", 49.5)?.price).toBe(70);
    expect(tierPrice(items, "p1", 50)?.price).toBe(65);
    expect(tierPrice(items, "p1", 500)?.price).toBe(65);
    expect(tierPrice(items, "p3", 1)).toBeNull();
  });

  it("sem faixa na tabela, vale o preço do catálogo", () => {
    const items = [item("a", "p1", 70, 10)];
    expect(resolveUnitPrice({ id: "p1", price: 80 }, items, 3)).toEqual({ unitPrice: 80, source: "catalogo", priceListItemId: null });
    expect(resolveUnitPrice({ id: "p1", price: 80 }, items, 12)).toEqual({ unitPrice: 70, source: "tabela", priceListItemId: "a" });
    expect(resolveUnitPrice({ id: "p1", price: 80 }, null, 12)).toEqual({ unitPrice: 80, source: "catalogo", priceListItemId: null });
  });
});

describe("validade da tabela de preço", () => {
  it("respeita ativa, início, fim (inclusive) e exclusão", () => {
    expect(isPriceListValid(list(), "2026-05-10")).toBe(true);
    expect(isPriceListValid(list({ active: 0 }), "2026-05-10")).toBe(false);
    expect(isPriceListValid(list({ valid_from: "2026-06-01" }), "2026-05-31")).toBe(false);
    expect(isPriceListValid(list({ valid_from: "2026-06-01" }), "2026-06-01")).toBe(true);
    expect(isPriceListValid(list({ valid_to: "2026-06-30" }), "2026-06-30")).toBe(true);
    expect(isPriceListValid(list({ valid_to: "2026-06-30" }), "2026-07-01")).toBe(false);
    expect(isPriceListValid(list({ deleted_at: "2026-01-01T00:00:00Z" }), "2026-05-10")).toBe(false);
    // O desktop grava booleano como texto; o demo, como booleano.
    expect(isPriceListValid(list({ active: "true" as unknown as number }), "2026-05-10")).toBe(true);
  });
});

describe("tabela de preço do pedido", () => {
  it("escolhida > do cliente > padrão; tabela vencida ou inativa é ignorada", async () => {
    const { db, fx } = await setup();
    const day = "2026-05-10";
    expect((await effectivePriceList(db, fx.companyId, { customerId: fx.customerId, day }))?.id).toBe(fx.priceLists.revenda);
    expect((await effectivePriceList(db, fx.companyId, { customerId: fx.otherCustomerId, day }))?.id).toBe(fx.priceLists.padrao);
    expect((await effectivePriceList(db, fx.companyId, { customerId: fx.otherCustomerId, priceListId: fx.priceLists.revenda, day }))?.id).toBe(fx.priceLists.revenda);

    await db.execute("UPDATE price_lists SET valid_to=? WHERE id=?", ["2026-04-30", fx.priceLists.revenda]);
    expect((await effectivePriceList(db, fx.companyId, { customerId: fx.customerId, day }))?.id).toBe(fx.priceLists.padrao);

    await db.execute("UPDATE price_lists SET active=0 WHERE id=?", [fx.priceLists.padrao]);
    expect(await effectivePriceList(db, fx.companyId, { customerId: fx.customerId, day })).toBeNull();
  });

  it("cota os itens: tabela por quantidade, catálogo como reserva e preço digitado mantido", async () => {
    const { db, fx } = await setup();
    const lines = await quoteItems(db, fx.companyId, {
      priceListId: fx.priceLists.padrao,
      items: [
        { productId: fx.products.mouse, qty: 5 },
        { productId: fx.products.mouse, qty: 10, discount: 20 },
        { productId: fx.products.switch, qty: 1 },
        { productId: fx.products.visita, qty: 2, unitPrice: 199.9 },
        { description: "Frete especial", qty: 1, unitPrice: 35 },
      ],
    });
    expect(lines.map((line) => [line.description, line.unitPrice, line.total])).toEqual([
      ["Mouse USB", 80, 400],
      ["Mouse USB", 70, 680],
      ["Switch 24 portas", 3000, 3000],
      ["Visita técnica", 199.9, 399.8],
      ["Frete especial", 35, 35],
    ]);
    expect(lines[3].unit).toBe("visita");
    expect(lines.map((line) => line.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it("produto inativo, de outra empresa ou inexistente não entra", async () => {
    const { db, fx } = await setup();
    await expect(quoteItems(db, fx.companyId, { items: [{ productId: fx.products.inativo, qty: 1 }] })).rejects.toThrow(/inativo/i);
    await expect(quoteItems(db, fx.companyId, { items: [{ productId: "nao-existe", qty: 1 }] })).rejects.toThrow(/não encontrado/i);
    await expect(quoteItems(db, "outra-empresa", { items: [{ productId: fx.products.mouse, qty: 1 }] })).rejects.toThrow(/não encontrado/i);
  });
});

describe("linhas e margem", () => {
  it("calcula o total de cada linha e recusa quantidade, preço ou desconto inválidos", () => {
    const base = { productId: null, unit: "un", taxRate: 0 };
    expect(computeLines([{ ...base, description: "A", qty: 3, unitPrice: 19.99, discount: 0 }])[0].total).toBe(59.97);
    expect(() => computeLines([])).toThrow(/ao menos um item/i);
    expect(() => computeLines([{ ...base, description: "A", qty: 0, unitPrice: 10, discount: 0 }])).toThrow(/quantidade/i);
    expect(() => computeLines([{ ...base, description: "A", qty: 1, unitPrice: -1, discount: 0 }])).toThrow(/preço/i);
    expect(() => computeLines([{ ...base, description: "A", qty: 1, unitPrice: 10, discount: 10.01 }])).toThrow(/desconto/i);
    expect(() => computeLines([{ ...base, description: "  ", qty: 1, unitPrice: 10, discount: 0 }])).toThrow(/descrição/i);
    expect(() => computeLines([{ ...base, description: "A", qty: Number.NaN, unitPrice: 10, discount: 0 }])).toThrow(/quantidade/i);
    // Preço com mais de 2 casas: o total usa o preço gravado (10,01), como o subtotal do pedido (orderTotals).
    expect(computeLines([{ ...base, description: "A", qty: 3, unitPrice: 10.005, discount: 0 }])[0]).toMatchObject({ unitPrice: 10.01, total: 30.03 });
    expect(computeLines([{ ...base, description: "A", qty: 3, unitPrice: 10.005, discount: 30.03 }])[0].total).toBe(0);
  });

  it("margem sobre o preço de venda", () => {
    expect(marginPercent(3000, 2000)).toBe(33.33);
    expect(marginPercent(100, 0)).toBe(100);
    expect(marginPercent(0, 10)).toBeNull();
    expect(marginPercent(100, 120)).toBe(-20);
  });
});
