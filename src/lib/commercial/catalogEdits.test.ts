// Gravação das tabelas editáveis do catálogo (produtos, tabelas de preço e preços) em SQLite real.
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { NEW_STOCK_ITEM, savePriceListItemRows, savePriceListRows, saveProductRows } from "./catalogEdits";

type Row = Record<string, unknown>;

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

async function setup() {
  db = await createTestDb();
  const { companyId } = await insertTestCompany(db, { roles: ["ceo", "comercial", "estoquista"] });
  return { db, companyId, manager: { role: "estoquista" as const, userId: "test-user-estoquista" } };
}

const one = async (sql: string, binds: unknown[]) => (await db!.select<Row[]>(sql, binds))[0];

describe("saveProductRows", () => {
  it("altera só o preço e mantém o resto; produto novo pode criar o item de estoque junto", async () => {
    const { db, companyId, manager } = await setup();
    await db.execute("INSERT INTO products (id, company_id, sku, name, kind, unit, price, cost, tax_rate, active, ncm) VALUES (?,?,?,?,?,?,?,?,?,?,?)", ["p1", companyId, "SW24", "Switch 24 portas", "produto", "un", 900, 600, 0, 1, "8517"]);
    await saveProductRows(db, companyId, manager, { updated: [{ id: "p1", price: 950.5 }], created: [{ name: "Cabo de rede", sku: "CAB1", price: 12, inventory_item_id: NEW_STOCK_ITEM }] });
    expect(await one("SELECT * FROM products WHERE id=?", ["p1"])).toMatchObject({ name: "Switch 24 portas", sku: "SW24", price: 950.5, cost: 600, ncm: "8517", active: 1 });
    const cable = await one("SELECT * FROM products WHERE sku=?", ["CAB1"]);
    expect(cable).toMatchObject({ name: "Cabo de rede", kind: "produto", unit: "un", price: 12, active: 1 });
    expect(await one("SELECT name, sku FROM inventory_items WHERE id=?", [cable!.inventory_item_id])).toEqual({ name: "Cabo de rede", sku: "CAB1" });
  });

  it("SKU repetido nas linhas novas é recusado antes de gravar", async () => {
    const { db, companyId, manager } = await setup();
    await expect(saveProductRows(db, companyId, manager, { updated: [], created: [{ name: "A", sku: "X1", price: 1 }, { name: "B", sku: "x1", price: 2 }] })).rejects.toThrow(/SKU/);
    expect(await db.select("SELECT id FROM products WHERE company_id=?", [companyId])).toHaveLength(0);
  });

  it("vendedor só consulta o catálogo", async () => {
    const { db, companyId } = await setup();
    await expect(saveProductRows(db, companyId, { role: "comercial", userId: "test-user-comercial" }, { updated: [], created: [{ name: "A", price: 1 }] })).rejects.toThrow(/permissão/);
  });
});

describe("savePriceListRows e savePriceListItemRows", () => {
  it("marcar outra tabela como padrão tira a marca da antiga; duas padrão na mesma gravação é erro", async () => {
    const { db, companyId, manager } = await setup();
    await db.execute("INSERT INTO price_lists (id, company_id, name, is_default, active) VALUES (?,?,?,?,?)", ["t1", companyId, "Tabela padrão", 1, 1]);
    const { created } = await savePriceListRows(db, companyId, manager, { updated: [], created: [{ name: "Revenda", is_default: 1 }] });
    expect(await one("SELECT is_default FROM price_lists WHERE id=?", ["t1"])).toEqual({ is_default: 0 });
    expect(await one("SELECT name, is_default, active FROM price_lists WHERE id=?", [created[0]])).toEqual({ name: "Revenda", is_default: 1, active: 1 });
    await expect(savePriceListRows(db, companyId, manager, { updated: [{ id: "t1", is_default: 1 }], created: [{ name: "Atacado", is_default: 1 }] })).rejects.toThrow(/padrão/);
    await expect(savePriceListRows(db, companyId, manager, { updated: [{ id: "t1", valid_from: "2026-12-01", valid_to: "2026-11-01" }], created: [] })).rejects.toThrow(/vigência/);
  });

  it("preço da tabela: cria, altera e recusa o mesmo produto na mesma quantidade mínima", async () => {
    const { db, companyId, manager } = await setup();
    await db.execute("INSERT INTO price_lists (id, company_id, name, is_default, active) VALUES (?,?,?,?,?)", ["t1", companyId, "Revenda", 0, 1]);
    await db.execute("INSERT INTO products (id, company_id, name, kind, unit, price, cost, tax_rate, active) VALUES (?,?,?,?,?,?,?,?,?)", ["p1", companyId, "Mouse USB", "produto", "un", 50, 20, 0, 1]);
    const { created } = await savePriceListItemRows(db, companyId, manager, { updated: [], created: [{ product_id: "p1", price: 45 }] }, { priceListId: "t1" });
    expect(await one("SELECT price, min_qty, price_list_id FROM price_list_items WHERE id=?", [created[0]])).toEqual({ price: 45, min_qty: 1, price_list_id: "t1" });
    await savePriceListItemRows(db, companyId, manager, { updated: [{ id: created[0]!, price: 44.9 }], created: [{ product_id: "p1", price: 40, min_qty: 10 }] }, { priceListId: "t1" });
    expect(await one("SELECT price FROM price_list_items WHERE id=?", [created[0]])).toEqual({ price: 44.9 });
    await expect(savePriceListItemRows(db, companyId, manager, { updated: [], created: [{ product_id: "p1", price: 1, min_qty: 10 }] }, { priceListId: "t1" })).rejects.toThrow(/já tem preço/);
    await expect(savePriceListItemRows(db, companyId, manager, { updated: [], created: [{ price: 1 }] }, { priceListId: "t1" })).rejects.toThrow(/produto/);
    expect(await db.select("SELECT id FROM price_list_items WHERE company_id=? AND deleted_at IS NULL", [companyId])).toHaveLength(2);
  });
});
