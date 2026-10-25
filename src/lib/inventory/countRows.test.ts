// Inventário pelas tabelas editáveis: abrir contagens (lista) e lançar o contado de cada item (folha), com o id da
// tela (sem duplicar ao salvar de novo), tudo conferido antes de gravar e a permissão na camada de dados.
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/sqlite";
import type { InventoryCount, InventoryCountItem } from "@/types";
import { saveCountLineRows, saveCountRows } from "./countRows";
import { finishInventoryCount, openInventoryCount } from "./counts";
import { PermissionError } from "./permission";
import { seedStockFixture } from "./testFixtures";

let db: TestDb;
let companyId: string;
const estoquista = { role: "estoquista" as const, userId: "test-user-estoquista" };
const gerente = { role: "gerente" as const, userId: "test-user-gerente" };

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId } = await seedStockFixture(db));
});

const counts = async () => db.select<InventoryCount[]>("SELECT * FROM inventory_counts WHERE company_id=? AND deleted_at IS NULL ORDER BY number", [companyId]);
const lines = async (countId: string) =>
  db.select<InventoryCountItem[]>("SELECT * FROM inventory_count_items WHERE count_id=? AND deleted_at IS NULL ORDER BY item_id", [countId]);

describe("saveCountRows (lista de contagens)", () => {
  it("abre a contagem no local da linha nova, com o id da tela, sem duplicar ao salvar de novo", async () => {
    const changes = { updated: [], created: [{ id: "cnt-1", location_id: "loc-a", notes: " Mensal " }] };
    const result = await saveCountRows(db, companyId, estoquista, changes);
    expect(result.created).toEqual([{ id: "cnt-1", number: 1 }]);
    await saveCountRows(db, companyId, estoquista, changes);
    expect((await counts()).map((row) => [row.id, row.location_id, row.status, row.notes, row.counted_by])).toEqual([["cnt-1", "loc-a", "aberta", "Mensal", "test-user-estoquista"]]);
    expect((await lines("cnt-1")).map((row) => row.item_id)).toEqual(["item-1", "item-3"]);
  });

  it("local com contagem aberta (no banco ou em outra linha nova) é recusado sem abrir nenhuma", async () => {
    await openInventoryCount(db, { companyId, locationId: "loc-a" });
    await expect(saveCountRows(db, companyId, estoquista, { updated: [], created: [{ id: "n1", location_id: "loc-b" }, { id: "n2", location_id: "loc-a" }] })).rejects.toThrow(/já existe a contagem INV-00001 aberta/i);
    await expect(saveCountRows(db, companyId, estoquista, { updated: [], created: [{ id: "n1", location_id: "loc-b" }, { id: "n2", location_id: "loc-b" }] })).rejects.toThrow(/duas contagens/);
    await expect(saveCountRows(db, companyId, estoquista, { updated: [], created: [{ id: "n1", location_id: null }] })).rejects.toThrow(/escolha o local/);
    expect(await counts()).toHaveLength(1);
  });

  it("muda a observação; o local de uma contagem não muda", async () => {
    const { id } = await openInventoryCount(db, { companyId, locationId: "loc-a" });
    await expect(saveCountRows(db, companyId, estoquista, { updated: [{ id, location_id: "loc-b" }], created: [] })).rejects.toThrow(/local de uma contagem não muda/);
    await saveCountRows(db, companyId, estoquista, { updated: [{ id, notes: "Prateleiras A e B" }], created: [] });
    expect((await counts())[0]).toMatchObject({ location_id: "loc-a", notes: "Prateleiras A e B" });
  });

  it("permissão na camada de dados", async () => {
    const { id } = await openInventoryCount(db, { companyId, locationId: "loc-a" });
    await expect(saveCountRows(db, companyId, gerente, { updated: [], created: [{ id: "n1", location_id: "loc-b" }] })).rejects.toBeInstanceOf(PermissionError);
    await expect(saveCountRows(db, companyId, gerente, { updated: [{ id, notes: "x" }], created: [] })).rejects.toBeInstanceOf(PermissionError);
    expect(await counts()).toHaveLength(1);
  });
});

describe("saveCountLineRows (folha da contagem)", () => {
  let countId: string;
  let lineOf: (itemId: string) => Promise<InventoryCountItem>;

  beforeEach(async () => {
    ({ id: countId } = await openInventoryCount(db, { companyId, locationId: "loc-a" }));
    lineOf = async (itemId) => (await lines(countId)).find((row) => row.item_id === itemId)!;
  });

  it("grava contado e observação das linhas alteradas e inclui o item da linha nova (com o contado digitado)", async () => {
    const cabo = await lineOf("item-1");
    const result = await saveCountLineRows(db, companyId, estoquista, countId, {
      updated: [{ id: cabo.id, counted_qty: 8.5, notes: "Caixa aberta" }],
      created: [{ id: "linha-nova", item_id: "item-2", counted_qty: 1 }],
    });
    expect(result).toEqual({ created: ["linha-nova"], updated: [cabo.id] });
    expect(await lineOf("item-1")).toMatchObject({ counted_qty: 8.5, notes: "Caixa aberta" });
    expect(await lineOf("item-2")).toMatchObject({ id: "linha-nova", expected_qty: 0, counted_qty: 1 });
    await saveCountLineRows(db, companyId, estoquista, countId, { updated: [], created: [{ id: "linha-nova", item_id: "item-2" }] });
    expect(await lines(countId)).toHaveLength(3);
  });

  it("limpa o contado (null) e recusa número negativo, item repetido e troca de item sem gravar nada", async () => {
    const cabo = await lineOf("item-1");
    const mouse = await lineOf("item-3");
    await saveCountLineRows(db, companyId, estoquista, countId, { updated: [{ id: cabo.id, counted_qty: 3 }], created: [] });
    await expect(
      saveCountLineRows(db, companyId, estoquista, countId, { updated: [{ id: cabo.id, counted_qty: null }, { id: mouse.id, counted_qty: -1 }], created: [] }),
    ).rejects.toThrow(/igual ou maior que zero/);
    expect((await lineOf("item-1")).counted_qty).toBe(3);
    await expect(saveCountLineRows(db, companyId, estoquista, countId, { updated: [], created: [{ id: "n", item_id: "item-1" }] })).rejects.toThrow(/já está nesta contagem/);
    await expect(saveCountLineRows(db, companyId, estoquista, countId, { updated: [{ id: cabo.id, item_id: "item-2" }], created: [] })).rejects.toThrow(/item da linha não muda/);
    await saveCountLineRows(db, companyId, estoquista, countId, { updated: [{ id: cabo.id, counted_qty: null }], created: [] });
    expect((await lineOf("item-1")).counted_qty).toBeNull();
  });

  it("contagem concluída não muda; permissão na camada de dados", async () => {
    const cabo = await lineOf("item-1");
    await expect(saveCountLineRows(db, companyId, gerente, countId, { updated: [{ id: cabo.id, counted_qty: 1 }], created: [] })).rejects.toBeInstanceOf(PermissionError);
    await expect(saveCountLineRows(db, companyId, gerente, countId, { updated: [], created: [{ id: "n", item_id: "item-2" }] })).rejects.toBeInstanceOf(PermissionError);
    for (const line of await lines(countId)) await saveCountLineRows(db, companyId, estoquista, countId, { updated: [{ id: line.id, counted_qty: 1 }], created: [] });
    await finishInventoryCount(db, { companyId, countId, userId: "test-user-estoquista" });
    await expect(saveCountLineRows(db, companyId, estoquista, countId, { updated: [{ id: cabo.id, counted_qty: 2 }], created: [] })).rejects.toThrow(/já está concluída/);
  });
});
