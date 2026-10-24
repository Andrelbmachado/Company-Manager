import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { formatSequence, nextSequenceNumber } from "./sequence";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

describe("numeração sequencial por empresa", () => {
  it("começa em 1, segue o maior número (inclusive excluídos) e não mistura empresas", async () => {
    db = await createTestDb();
    const { companyId } = await insertTestCompany(db, { roles: ["ceo"] });
    await insertTestCompany(db, { companyId: "outra", roles: ["admin"] });
    expect(await nextSequenceNumber(db, "sales_orders", companyId)).toBe(1);
    await db.execute("INSERT INTO sales_orders (id, company_id, number) VALUES (?, ?, ?)", ["a", companyId, 1]);
    await db.execute("INSERT INTO sales_orders (id, company_id, number, deleted_at) VALUES (?, ?, ?, datetime('now'))", ["b", companyId, 7]);
    await db.execute("INSERT INTO sales_orders (id, company_id, number) VALUES (?, ?, ?)", ["c", "outra", 40]);
    expect(await nextSequenceNumber(db, "sales_orders", companyId)).toBe(8);
    expect(await nextSequenceNumber(db, "sales_orders", "outra")).toBe(41);
    expect(await nextSequenceNumber(db, "invoices", companyId)).toBe(1);
  });

  it("propostas antigas sem número não atrapalham", async () => {
    db = await createTestDb();
    const { companyId } = await insertTestCompany(db, { roles: ["ceo"] });
    await db.execute("INSERT INTO proposals (id, company_id) VALUES (?, ?)", ["p0", companyId]);
    expect(await nextSequenceNumber(db, "proposals", companyId)).toBe(1);
  });

  it("formata com prefixo do documento", () => {
    expect(formatSequence("sales_orders", 12)).toBe("PV-00012");
    expect(formatSequence("invoices", 3)).toBe("FAT-00003");
    expect(formatSequence("purchase_orders", 123456)).toBe("PC-123456");
    expect(formatSequence("goods_receipts", 1)).toBe("REC-00001");
    expect(formatSequence("proposals", null)).toBe("—");
  });
});
