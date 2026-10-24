// DEFAULT e índices da 0008 que dependem de detalhe: data de documento no dia local e SKU vazio.
import { afterEach, describe, expect, it } from "vitest";
import { todayIso } from "@/lib/utils";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

interface PragmaColumn {
  name: string;
  dflt_value: string | null;
}

const compact = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, "").replace(/^\((.*)\)$/, "$1").toLowerCase();

const DOCUMENT_DATES = [
  ["sales_orders", "order_date"],
  ["invoices", "issue_date"],
  ["purchase_orders", "order_date"],
] as const;

describe("datas de documento (0008)", () => {
  it("pedido de venda, fatura e compra têm DEFAULT no dia local, não no dia UTC", async () => {
    db = await createTestDb();
    for (const [table, column] of DOCUMENT_DATES) {
      const info = db.raw.prepare(`PRAGMA table_info(${table})`).all() as PragmaColumn[];
      expect(compact(info.find((item) => item.name === column)?.dflt_value), `${table}.${column}`).toBe("date('now','localtime')");
    }
  });

  it("nenhuma coluna das migrations usa date('now') (UTC) como DEFAULT: depois das 21h o dia viraria", async () => {
    db = await createTestDb();
    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    const utcDates: string[] = [];
    for (const { name } of tables) {
      for (const column of db.raw.prepare(`PRAGMA table_info(${name})`).all() as PragmaColumn[]) {
        const value = compact(column.dflt_value);
        if (value === "date('now')" || value === "current_date") utcDates.push(`${name}.${column.name}`);
      }
    }
    expect(utcDates).toEqual([]);
  });

  it("gravar sem a data usa o dia de hoje do computador (todayIso)", async () => {
    db = await createTestDb();
    const { companyId } = await insertTestCompany(db, { roles: ["ceo"] });
    const before = todayIso();
    await db.execute("INSERT INTO sales_orders (id, company_id, number) VALUES (?, ?, ?)", ["so-1", companyId, 1]);
    await db.execute("INSERT INTO invoices (id, company_id, number) VALUES (?, ?, ?)", ["inv-1", companyId, 1]);
    await db.execute("INSERT INTO purchase_orders (id, company_id, number) VALUES (?, ?, ?)", ["po-1", companyId, 1]);
    const after = todayIso();
    const [order] = await db.select<{ order_date: string }[]>("SELECT order_date FROM sales_orders WHERE id = ?", ["so-1"]);
    const [invoice] = await db.select<{ issue_date: string }[]>("SELECT issue_date FROM invoices WHERE id = ?", ["inv-1"]);
    const [purchase] = await db.select<{ order_date: string }[]>("SELECT order_date FROM purchase_orders WHERE id = ?", ["po-1"]);
    for (const value of [order.order_date, invoice.issue_date, purchase.order_date]) expect([before, after]).toContain(value);
  });
});

describe("SKU de produto (0008)", () => {
  it("SKU vazio não conta como SKU: vários produtos sem código convivem na mesma empresa", async () => {
    db = await createTestDb();
    const { companyId } = await insertTestCompany(db, { roles: ["ceo"] });
    await db.execute("INSERT INTO products (id, company_id, sku, name) VALUES (?, ?, ?, ?)", ["p1", companyId, "", "Sem código 1"]);
    await db.execute("INSERT INTO products (id, company_id, sku, name) VALUES (?, ?, ?, ?)", ["p2", companyId, "", "Sem código 2"]);
    await db.execute("INSERT INTO products (id, company_id, sku, name) VALUES (?, ?, ?, ?)", ["p3", companyId, null, "Sem código 3"]);
    await db.execute("INSERT INTO products (id, company_id, sku, name) VALUES (?, ?, ?, ?)", ["p4", companyId, "SKU-1", "Com código"]);
    await expect(db.execute("INSERT INTO products (id, company_id, sku, name) VALUES (?, ?, ?, ?)", ["p5", companyId, "sku-1", "Repetido"])).rejects.toThrow(/UNIQUE/);
    const [{ n }] = await db.select<{ n: number }[]>("SELECT count(*) AS n FROM products WHERE company_id = ?", [companyId]);
    expect(n).toBe(4);
  });
});
