// Itens do estoque pela tabela editável: só o que mudou é gravado, nada é gravado se uma linha tem erro, linha nova
// com o id da tela não duplica ao salvar de novo, e a permissão é conferida na camada de dados.
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/sqlite";
import type { InventoryItem } from "@/types";
import { deleteInventoryItem, saveInventoryItemRows } from "./items";
import { PermissionError } from "./permission";
import { StockError } from "./stock";
import { seedStockFixture } from "./testFixtures";

let db: TestDb;
let companyId: string;
const estoquista = { role: "estoquista" as const, userId: "test-user-estoquista" };

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId } = await seedStockFixture(db));
});

const item = async (id: string) => (await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE id=?", [id]))[0];
const activeCount = async () => (await db.select<{ n: number }[]>("SELECT count(*) AS n FROM inventory_items WHERE company_id=? AND deleted_at IS NULL", [companyId]))[0].n;

describe("saveInventoryItemRows", () => {
  it("grava só os campos alterados e cria a linha nova com o id da tela", async () => {
    const before = await item("item-1");
    const result = await saveInventoryItemRows(db, companyId, estoquista, {
      updated: [{ id: "item-1", cost: 12.345, max_stock: null }],
      created: [{ id: "novo-1", name: "  Parafuso   M6 ", unit: null, min_stock: 100, cost: 0.35, supplier_id: "sup-2" }],
    });
    expect(result.updated.map((row) => row.id)).toEqual(["item-1"]);
    expect(result.created.map((row) => row.id)).toEqual(["novo-1"]);
    expect(await item("item-1")).toMatchObject({ name: before.name, sku: before.sku, min_stock: 5, max_stock: null, cost: 12.35, supplier_id: "sup-1" });
    expect(await item("novo-1")).toMatchObject({ company_id: companyId, name: "Parafuso M6", unit: "un", min_stock: 100, max_stock: null, cost: 0.35, supplier_id: "sup-2" });
  });

  it("salvar de novo depois de uma falha não duplica a linha nova já gravada", async () => {
    const changes = { updated: [], created: [{ id: "novo-1", name: "Parafuso" }] };
    await saveInventoryItemRows(db, companyId, estoquista, changes);
    await saveInventoryItemRows(db, companyId, estoquista, changes);
    expect((await db.select<unknown[]>("SELECT * FROM inventory_items WHERE id='novo-1'")).length).toBe(1);
    expect(await activeCount()).toBe(5);
  });

  it("uma linha com erro: nenhuma linha é gravada", async () => {
    const attempt = saveInventoryItemRows(db, companyId, estoquista, {
      updated: [{ id: "item-1", name: "Cabo Cat6 azul" }, { id: "item-2", max_stock: 1 }],
      created: [{ id: "novo-1", name: "Parafuso" }],
    });
    await expect(attempt).rejects.toThrow(/máximo não pode ser menor que o mínimo/);
    expect((await item("item-1")).name).toBe("Cabo Cat6");
    expect(await item("novo-1")).toBeUndefined();
  });

  it("recusa nome vazio, número negativo, fornecedor de outra empresa e SKU repetido (inclusive entre linhas novas)", async () => {
    await expect(saveInventoryItemRows(db, companyId, estoquista, { updated: [{ id: "item-1", name: "  " }], created: [] })).rejects.toThrow(/nome do item/);
    await expect(saveInventoryItemRows(db, companyId, estoquista, { updated: [{ id: "item-1", cost: -1 }], created: [] })).rejects.toThrow(/custo/);
    await db.execute("INSERT INTO companies (id, name) VALUES ('outra', 'Outra')");
    await db.execute("INSERT INTO suppliers (id, company_id, name) VALUES ('sup-x', 'outra', 'De fora')");
    await expect(saveInventoryItemRows(db, companyId, estoquista, { updated: [{ id: "item-1", supplier_id: "sup-x" }], created: [] })).rejects.toThrow(/fornecedor não encontrado/);
    await expect(saveInventoryItemRows(db, companyId, estoquista, { updated: [{ id: "item-1", sku: "item-2" }], created: [] })).rejects.toThrow("Já existe um item com o SKU item-2: Switch 24p.");
    await expect(
      saveInventoryItemRows(db, companyId, estoquista, { updated: [], created: [{ id: "a", name: "A", sku: "NOVO" }, { id: "b", name: "B", sku: "novo" }] }),
    ).rejects.toBeInstanceOf(StockError);
    expect(await activeCount()).toBe(4);
    // Trocar dois SKUs entre si numa gravação só vale (o resultado final não repete).
    await saveInventoryItemRows(db, companyId, estoquista, { updated: [{ id: "item-1", sku: "ITEM-2" }, { id: "item-2", sku: "ITEM-1" }], created: [] });
    expect([(await item("item-1")).sku, (await item("item-2")).sku]).toEqual(["ITEM-2", "ITEM-1"]);
  });

  it("item excluído ou de outra empresa não é editado", async () => {
    await db.execute("UPDATE inventory_items SET deleted_at=datetime('now') WHERE id='item-4'");
    await expect(saveInventoryItemRows(db, companyId, estoquista, { updated: [{ id: "item-4", name: "Volta" }], created: [] })).rejects.toThrow(/não encontrado/);
    expect((await item("item-4")).name).toBe("SSD 1 TB");
  });

  it("fornecedor excluído depois não trava a edição dos outros campos do item; escolher o excluído continua recusado", async () => {
    await db.execute("UPDATE suppliers SET deleted_at=datetime('now') WHERE id='sup-1'");
    await saveInventoryItemRows(db, companyId, estoquista, { updated: [{ id: "item-1", min_stock: 7, name: "Cabo Cat6 azul" }], created: [] });
    expect(await item("item-1")).toMatchObject({ name: "Cabo Cat6 azul", min_stock: 7, supplier_id: "sup-1" });
    await expect(saveInventoryItemRows(db, companyId, estoquista, { updated: [{ id: "item-3", supplier_id: "sup-1" }], created: [] })).rejects.toThrow(/fornecedor não encontrado/);
    await expect(saveInventoryItemRows(db, companyId, estoquista, { updated: [], created: [{ id: "novo-1", name: "Parafuso", supplier_id: "sup-1" }] })).rejects.toThrow(
      /fornecedor não encontrado/,
    );
    expect((await item("item-3")).supplier_id).toBe("sup-2");
    expect(await item("novo-1")).toBeUndefined();
  });

  it("permissão na camada de dados: gerência e auditoria só consultam", async () => {
    for (const role of ["gerente", "auditor", "tecnico"] as const) {
      const actor = { role, userId: `test-user-${role}` };
      await expect(saveInventoryItemRows(db, companyId, actor, { updated: [{ id: "item-1", name: "X" }], created: [] })).rejects.toBeInstanceOf(PermissionError);
      await expect(saveInventoryItemRows(db, companyId, actor, { updated: [], created: [{ id: "x", name: "X" }] })).rejects.toThrow("Seu perfil não tem permissão para adicionar itens do estoque.");
      await expect(deleteInventoryItem(db, companyId, actor, "item-1")).rejects.toBeInstanceOf(PermissionError);
    }
    expect((await item("item-1")).name).toBe("Cabo Cat6");
    expect(await activeCount()).toBe(4);
  });

  it("exclui (soft delete) com permissão", async () => {
    await deleteInventoryItem(db, companyId, estoquista, "item-4");
    expect((await item("item-4")).deleted_at).toBeTruthy();
    await expect(deleteInventoryItem(db, companyId, estoquista, "item-4")).rejects.toBeInstanceOf(StockError);
  });
});
