// Movimentações e transferências pela tabela editável: linha nova vira lançamento pelo motor de estoque (com o id da
// tela, sem duplicar ao salvar de novo), o lote inteiro é conferido antes de gravar, e lançamento gravado só muda a
// observação (o saldo já foi acertado).
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/sqlite";
import type { StockMovement } from "@/types";
import { listStockMovements } from "./queries";
import { movementKindOf, saveMovementRows, saveTransferRows, toMovementTableRows, toTransferTableRows, type MovementInput } from "./movementRows";
import { PermissionError } from "./permission";
import { recordStockMovement, StockError, transferStock } from "./stock";
import { balanceOf, seedStockFixture } from "./testFixtures";

let db: TestDb;
let companyId: string;
const estoquista = { role: "estoquista" as const, userId: "test-user-estoquista" };

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId } = await seedStockFixture(db));
});

const movements = async () => db.select<StockMovement[]>("SELECT * FROM stock_movements WHERE company_id=? ORDER BY created_at, id", [companyId]);

describe("movimentações pela tabela", () => {
  it("tipo da linha: entrada, saída, ajuste de falta/sobra e transferência", () => {
    expect(movementKindOf({ type: "entrada", from_location_id: null, to_location_id: "a" })).toBe("entrada");
    expect(movementKindOf({ type: "saida", from_location_id: "a", to_location_id: null })).toBe("saida");
    expect(movementKindOf({ type: "ajuste", from_location_id: "a", to_location_id: null })).toBe("ajuste_falta");
    expect(movementKindOf({ type: "ajuste", from_location_id: null, to_location_id: "a" })).toBe("ajuste_sobra");
    expect(movementKindOf({ type: "transferencia", from_location_id: "a", to_location_id: "b" })).toBe("transferencia");
  });

  it("linhas novas viram entrada, saída e ajustes no local, com o custo digitado só na entrada", async () => {
    const result = await saveMovementRows(db, companyId, estoquista, {
      updated: [],
      created: [
        { id: "m-1", kind: "entrada", item_id: "item-1", location_id: "loc-b", quantity: 4, unit_cost: 12.345, note: "Compra avulsa" },
        { id: "m-2", kind: "saida", item_id: "item-1", location_id: "loc-a", quantity: 3, unit_cost: 99, note: null },
        { id: "m-3", kind: "ajuste_falta", item_id: "item-3", location_id: "loc-b", quantity: 1 },
        { id: "m-4", kind: "ajuste_sobra", item_id: "item-3", location_id: "loc-a", quantity: 2 },
      ],
    });
    expect(result.created).toEqual(["m-1", "m-2", "m-3", "m-4"]);
    expect([await balanceOf(db, "item-1", "loc-a"), await balanceOf(db, "item-1", "loc-b")]).toEqual([7, 4]);
    expect([await balanceOf(db, "item-3", "loc-a"), await balanceOf(db, "item-3", "loc-b")]).toEqual([6, 2]);
    const rows = await movements();
    expect(rows.find((row) => row.id === "m-1")).toMatchObject({ type: "entrada", to_location_id: "loc-b", unit_cost: 12.35, ref_type: "manual", user_id: "test-user-estoquista", note: "Compra avulsa" });
    expect(rows.find((row) => row.id === "m-2")).toMatchObject({ type: "saida", from_location_id: "loc-a", unit_cost: 10 });
    expect(rows.find((row) => row.id === "m-3")).toMatchObject({ type: "ajuste", from_location_id: "loc-b", to_location_id: null });
    expect(rows.find((row) => row.id === "m-4")).toMatchObject({ type: "ajuste", from_location_id: null, to_location_id: "loc-a" });
  });

  it("salvar de novo depois de uma falha não lança de novo o que já foi gravado", async () => {
    const created = [{ id: "m-1", kind: "entrada" as const, item_id: "item-1", location_id: "loc-a", quantity: 2 }];
    await saveMovementRows(db, companyId, estoquista, { updated: [], created });
    await saveMovementRows(db, companyId, estoquista, { updated: [], created });
    expect(await movements()).toHaveLength(1);
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(12);
  });

  it("o lote inteiro é conferido antes de gravar: a segunda saída sem saldo barra a primeira", async () => {
    const attempt = saveMovementRows(db, companyId, estoquista, {
      updated: [],
      created: [
        { id: "m-1", kind: "saida", item_id: "item-1", location_id: "loc-a", quantity: 6 },
        { id: "m-2", kind: "saida", item_id: "item-1", location_id: "loc-a", quantity: 6 },
      ],
    });
    await expect(attempt).rejects.toMatchObject({ code: "saldo_insuficiente" });
    await expect(attempt).rejects.toThrow(/Linha nova 2/);
    expect(await movements()).toEqual([]);
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(10);
  });

  it("linha nova incompleta é recusada com o motivo", async () => {
    const save = (row: Partial<MovementInput>) => saveMovementRows(db, companyId, estoquista, { updated: [], created: [{ id: "m", kind: "entrada", item_id: "item-1", location_id: "loc-a", quantity: 1, ...row }] });
    await expect(save({ kind: null })).rejects.toThrow(/escolha o tipo/);
    await expect(save({ kind: "transferencia" })).rejects.toThrow(/Transferências/);
    await expect(save({ item_id: null })).rejects.toThrow(/escolha o item/);
    await expect(save({ location_id: "" })).rejects.toThrow(/escolha o local/);
    await expect(save({ quantity: 0 })).rejects.toBeInstanceOf(StockError);
    expect(await movements()).toEqual([]);
  });

  it("lançamento gravado: só a observação muda; outro campo é recusado sem gravar nada", async () => {
    await recordStockMovement(db, { companyId, id: "m-1", itemId: "item-1", type: "entrada", quantity: 2, toLocationId: "loc-a", note: "antes" });
    await expect(
      saveMovementRows(db, companyId, estoquista, { updated: [{ id: "m-1", note: "depois" }, { id: "m-1", quantity: 5 }], created: [] }),
    ).rejects.toThrow(/só a observação/);
    expect((await movements())[0].note).toBe("antes");
    const result = await saveMovementRows(db, companyId, estoquista, { updated: [{ id: "m-1", note: "  Nota fiscal 123 " }], created: [] });
    expect(result.updated).toEqual(["m-1"]);
    expect((await movements())[0]).toMatchObject({ note: "Nota fiscal 123", quantity: 2 });
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(12);
  });

  it("permissão na camada de dados: lançar exige create, mudar a observação exige edit em inventory", async () => {
    await recordStockMovement(db, { companyId, id: "m-1", itemId: "item-1", type: "entrada", quantity: 2, toLocationId: "loc-a" });
    for (const role of ["gerente", "auditor", "tecnico"] as const) {
      const actor = { role, userId: `test-user-${role}` };
      await expect(saveMovementRows(db, companyId, actor, { updated: [], created: [{ id: "x", kind: "entrada", item_id: "item-1", location_id: "loc-a", quantity: 1 }] })).rejects.toBeInstanceOf(PermissionError);
      await expect(saveMovementRows(db, companyId, actor, { updated: [{ id: "m-1", note: "x" }], created: [] })).rejects.toBeInstanceOf(PermissionError);
    }
    expect(await movements()).toHaveLength(1);
  });

  it("linhas da tabela a partir das movimentações listadas", async () => {
    await recordStockMovement(db, { companyId, id: "m-1", itemId: "item-1", type: "saida", quantity: 2, fromLocationId: "loc-a" });
    const [row] = toMovementTableRows(await listStockMovements(db, companyId));
    expect(row).toMatchObject({ id: "m-1", kind: "saida", item_id: "item-1", location_id: "loc-a", quantity: 2, unit_cost: 10, item_name: "Cabo Cat6" });
  });
});

describe("transferências pela tabela", () => {
  it("linhas novas com a mesma origem, destino e observação viram uma transferência com vários itens", async () => {
    const result = await saveTransferRows(db, companyId, estoquista, {
      updated: [],
      created: [
        { id: "t-1", from_location_id: "loc-a", to_location_id: "loc-b", item_id: "item-1", quantity: 3, note: "Vitrine" },
        { id: "t-2", from_location_id: "loc-a", to_location_id: "loc-b", item_id: "item-3", quantity: 4, note: "Vitrine" },
        { id: "t-3", from_location_id: "loc-b", to_location_id: "loc-a", item_id: "item-3", quantity: 1, note: null },
      ],
    });
    expect(result.transfers).toEqual([
      { id: "t-1", from_location_id: "loc-a", to_location_id: "loc-b", lines: 2 },
      { id: "t-3", from_location_id: "loc-b", to_location_id: "loc-a", lines: 1 },
    ]);
    expect([await balanceOf(db, "item-1", "loc-a"), await balanceOf(db, "item-1", "loc-b")]).toEqual([7, 3]);
    expect([await balanceOf(db, "item-3", "loc-a"), await balanceOf(db, "item-3", "loc-b")]).toEqual([1, 6]);
    const rows = await movements();
    expect(rows.filter((row) => row.ref_id === "t-1").map((row) => [row.item_id, row.note])).toEqual(expect.arrayContaining([["item-1", "Vitrine"], ["item-3", "Vitrine"]]));
    const table = toTransferTableRows(await listStockMovements(db, companyId));
    expect(table).toHaveLength(3);
    expect(table.find((row) => row.item_id === "item-1")).toMatchObject({ from_location_id: "loc-a", to_location_id: "loc-b", quantity: 3, transfer_id: "t-1" });
  });

  it("salvar de novo não transfere de novo; o lote é conferido antes (nada é transferido se uma linha não tem saldo)", async () => {
    const created = [{ id: "t-1", from_location_id: "loc-a", to_location_id: "loc-b", item_id: "item-1", quantity: 2 }];
    await saveTransferRows(db, companyId, estoquista, { updated: [], created });
    await saveTransferRows(db, companyId, estoquista, { updated: [], created });
    expect(await balanceOf(db, "item-1", "loc-b")).toBe(2);

    const attempt = saveTransferRows(db, companyId, estoquista, {
      updated: [],
      created: [
        { id: "t-2", from_location_id: "loc-a", to_location_id: "loc-b", item_id: "item-1", quantity: 1 },
        { id: "t-3", from_location_id: "loc-b", to_location_id: "loc-a", item_id: "item-3", quantity: 50, note: "outra" },
      ],
    });
    await expect(attempt).rejects.toMatchObject({ code: "saldo_insuficiente" });
    expect(await balanceOf(db, "item-1", "loc-b")).toBe(2);
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(8);
  });

  it("recusa origem igual ao destino e linha sem item; transferência gravada só muda a observação", async () => {
    await expect(saveTransferRows(db, companyId, estoquista, { updated: [], created: [{ id: "t", from_location_id: "loc-a", to_location_id: "loc-a", item_id: "item-1", quantity: 1 }] })).rejects.toMatchObject({ code: "mesmo_local" });
    await expect(saveTransferRows(db, companyId, estoquista, { updated: [], created: [{ id: "t", from_location_id: "loc-a", to_location_id: "loc-b", item_id: null, quantity: 1 }] })).rejects.toThrow(/escolha o item/);
    const { movementIds } = await transferStock(db, { companyId, fromLocationId: "loc-a", toLocationId: "loc-b", lines: [{ itemId: "item-1", quantity: 1 }] });
    await expect(saveTransferRows(db, companyId, estoquista, { updated: [{ id: movementIds[0], quantity: 9 }], created: [] })).rejects.toThrow(/só a observação/);
    await saveTransferRows(db, companyId, estoquista, { updated: [{ id: movementIds[0], note: "Reposição da loja" }], created: [] });
    expect((await movements())[0]).toMatchObject({ note: "Reposição da loja", quantity: 1 });
  });

  it("permissão: transferir exige transfer em inventory", async () => {
    const created = [{ id: "t-1", from_location_id: "loc-a", to_location_id: "loc-b", item_id: "item-1", quantity: 1 }];
    await expect(saveTransferRows(db, companyId, { role: "gerente", userId: "test-user-gerente" }, { updated: [], created })).rejects.toThrow("Seu perfil não tem permissão para transferir itens entre locais.");
    expect(await movements()).toEqual([]);
  });
});
