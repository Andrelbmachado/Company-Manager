// Massa de teste do estoque (só usada pelos *.test.ts desta pasta): empresa, dois locais, itens e saldos.
import { insertTestCompany, type TestDb } from "@/test/sqlite";

export interface StockFixture {
  companyId: string;
  userId: string;
}

export async function seedStockFixture(db: TestDb): Promise<StockFixture> {
  const { companyId, userIds } = await insertTestCompany(db, { roles: ["estoquista", "ceo"] });
  const C = companyId;
  await db.execute("INSERT INTO stock_locations (id, company_id, name, type) VALUES (?,?,?,?)", ["loc-a", C, "Depósito Central", "deposito"]);
  await db.execute("INSERT INTO stock_locations (id, company_id, name, type) VALUES (?,?,?,?)", ["loc-b", C, "Loja", "loja"]);
  await db.execute("INSERT INTO suppliers (id, company_id, name) VALUES (?,?,?)", ["sup-1", C, "NetPrime"]);
  await db.execute("INSERT INTO suppliers (id, company_id, name) VALUES (?,?,?)", ["sup-2", C, "ByteCenter"]);
  const items: [string, string, string, number, number | null, number, string | null][] = [
    // id, nome, unidade, mínimo, máximo, custo, fornecedor
    ["item-1", "Cabo Cat6", "cx", 5, 20, 10, "sup-1"],
    ["item-2", "Switch 24p", "un", 2, 6, 2180.5, "sup-1"],
    ["item-3", "Mouse USB", "un", 10, null, 48.9, "sup-2"],
    ["item-4", "SSD 1 TB", "un", 0, null, 520, null],
  ];
  for (const [id, name, unit, min, max, cost, supplier] of items) {
    await db.execute(
      "INSERT INTO inventory_items (id, company_id, name, sku, unit, min_stock, max_stock, cost, supplier_id) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, C, name, id.toUpperCase(), unit, min, max, cost, supplier],
    );
  }
  await db.execute("INSERT INTO stock_balances (id, company_id, item_id, location_id, quantity) VALUES (?,?,?,?,?)", ["bal-1a", C, "item-1", "loc-a", 10]);
  await db.execute("INSERT INTO stock_balances (id, company_id, item_id, location_id, quantity) VALUES (?,?,?,?,?)", ["bal-3a", C, "item-3", "loc-a", 4]);
  await db.execute("INSERT INTO stock_balances (id, company_id, item_id, location_id, quantity) VALUES (?,?,?,?,?)", ["bal-3b", C, "item-3", "loc-b", 3]);
  return { companyId: C, userId: userIds.estoquista! };
}

export async function balanceOf(db: TestDb, itemId: string, locationId: string): Promise<number | null> {
  const rows = await db.select<{ quantity: number }[]>("SELECT quantity FROM stock_balances WHERE item_id=? AND location_id=?", [itemId, locationId]);
  return rows[0]?.quantity ?? null;
}

export async function countRows(db: TestDb, table: string): Promise<number> {
  const [row] = await db.select<{ n: number }[]>(`SELECT count(*) AS n FROM ${table}`);
  return row.n;
}
