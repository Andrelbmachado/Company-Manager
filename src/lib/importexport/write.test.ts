// @vitest-environment jsdom
// Gravação em lote nos dois bancos: SQLite real (várias linhas por comando) e demo do navegador (uma por comando).
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID, type DatabaseLike } from "@/lib/db/demo";
import { createTestDb, insertTestCompany } from "@/test/sqlite";
import { detectBackend, insertRows, sqliteNow, undoJournal, updateRows, WriteJournal } from "./write";

type Row = Record<string, unknown>;

beforeEach(() => localStorage.clear());

const backends: { name: string; open: () => Promise<{ db: DatabaseLike; companyId: string }> }[] = [
  {
    name: "SQLite",
    open: async () => {
      const db = await createTestDb();
      const { companyId } = await insertTestCompany(db, { roles: ["ceo"] });
      return { db, companyId };
    },
  },
  { name: "demo", open: async () => ({ db: createDemoDb(), companyId: DEMO_COMPANY_ID }) },
];

const customers = (db: DatabaseLike, companyId: string) =>
  db.select<Row[]>("SELECT * FROM customers WHERE company_id=? AND deleted_at IS NULL", [companyId]);

describe("detectBackend", () => {
  it("reconhece o SQLite e o demo", async () => {
    expect(await detectBackend(await createTestDb())).toBe("sqlite");
    expect(await detectBackend(createDemoDb())).toBe("demo");
  });
});

for (const backend of backends) {
  describe(`gravação em lote (${backend.name})`, () => {
    it("insere com DEFAULT nas colunas nulas, atualiza só o que foi pedido e desfaz tudo pelo diário", async () => {
      const { db, companyId } = await backend.open();
      const before = (await customers(db, companyId)).length;
      const journal = new WriteJournal();
      await insertRows(db, "customers", [
        { id: "imp-1", company_id: companyId, name: "Alfa", email: "a@x.com", type: null },
        { id: "imp-2", company_id: companyId, name: "Beta", email: null, phone: "(11) 3020-1188" },
      ], journal);
      let rows = await customers(db, companyId);
      expect(rows).toHaveLength(before + 2);
      const alfa = rows.find((row) => row.id === "imp-1")!;
      expect(alfa).toMatchObject({ name: "Alfa", email: "a@x.com", type: "PJ", status: "active" });

      const now = sqliteNow();
      await updateRows(db, "customers", companyId, [
        { id: "imp-1", values: { segment: "Varejo", updated_at: now }, previous: { segment: alfa.segment ?? null, updated_at: alfa.updated_at } },
      ], journal);
      rows = await customers(db, companyId);
      expect(rows.find((row) => row.id === "imp-1")).toMatchObject({ name: "Alfa", email: "a@x.com", segment: "Varejo", updated_at: now });

      // Cliente que já existia: alteração e volta ao valor exato (inclusive NULL).
      const existing = rows.find((row) => !String(row.id).startsWith("imp-"));
      if (existing) {
        await updateRows(db, "customers", companyId, [{ id: String(existing.id), values: { segment: "Mudou", notes: "x" }, previous: { segment: existing.segment ?? null, notes: existing.notes ?? null } }], journal);
        await updateRows(db, "customers", companyId, [{ id: String(existing.id), values: { segment: "Mudou de novo" }, previous: { segment: "Mudou" } }], journal);
      }

      await undoJournal(db, companyId, journal);
      expect(journal.isEmpty).toBe(true);
      rows = await customers(db, companyId);
      expect(rows).toHaveLength(before);
      expect(rows.some((row) => String(row.id).startsWith("imp-"))).toBe(false);
      if (existing) {
        const restored = rows.find((row) => row.id === existing.id)!;
        expect(restored.segment ?? null).toBe(existing.segment ?? null);
        expect(restored.notes ?? null).toBe(existing.notes ?? null);
      }
    });

    it("lotes maiores que um comando e atualização em massa", async () => {
      const { db, companyId } = await backend.open();
      // No SQLite passa de 2 comandos de 500; o demo grava o localStorage a cada linha (só visualização), então menos.
      const total = backend.name === "SQLite" ? 1200 : 150;
      const rows = Array.from({ length: total }, (_, index) => ({ id: `bulk-${index}`, company_id: companyId, name: `Produto ${index}`, sku: `SKU-${index}`, price: index / 4 }));
      let progress = 0;
      await insertRows(db, "products", rows, undefined, (count) => (progress += count));
      expect(progress).toBe(total);
      await updateRows(db, "products", companyId, rows.map((row) => ({ id: row.id, values: { price: row.price * 2 } })));
      const stored = await db.select<Row[]>("SELECT * FROM products WHERE company_id=? AND deleted_at IS NULL", [companyId]);
      const bulk = stored.filter((row) => String(row.id).startsWith("bulk-"));
      expect(bulk).toHaveLength(total);
      expect(bulk.find((row) => row.id === `bulk-${total - 1}`)).toMatchObject({ price: (total - 1) / 2, kind: "produto", unit: "un", active: 1 });
    });
  });
}

describe("gravação em lote: segurança", () => {
  it("recusa nome de tabela ou coluna fora do padrão", async () => {
    const db = await createTestDb();
    await expect(insertRows(db, "customers; DROP TABLE users", [{ id: "x" }])).rejects.toThrow(/inválido/);
    await expect(insertRows(db, "customers", [{ id: "x", "name) VALUES ('a'); --": "y" }])).rejects.toThrow(/inválido/);
  });

  it("não altera linha de outra empresa", async () => {
    const db = await createTestDb();
    const { companyId } = await insertTestCompany(db, { roles: ["ceo"] });
    await insertTestCompany(db, { companyId: "outra", roles: ["admin"] });
    await insertRows(db, "customers", [{ id: "c-outra", company_id: "outra", name: "Da outra" }]);
    await updateRows(db, "customers", companyId, [{ id: "c-outra", values: { name: "Invadido" } }]);
    expect(await db.select<Row[]>("SELECT name FROM customers WHERE id = ?", ["c-outra"])).toEqual([{ name: "Da outra" }]);
  });
});
