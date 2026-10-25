// Locais de estoque (SQLite real): cadastro, nome único e arquivamento só sem saldo.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/sqlite";
import { archiveStockLocation, listLocationSummaries, saveStockLocation } from "./locations";
import { openInventoryCount } from "./counts";
import { recordStockMovement, StockError } from "./stock";
import { seedStockFixture } from "./testFixtures";

let db: TestDb;
let C: string;
let user: string;

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId: C, userId: user } = await seedStockFixture(db));
});
afterEach(() => db.close());

type Row = Record<string, unknown>;

async function expectStockError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error, `esperava StockError(${code})`).toBeInstanceOf(StockError);
  expect((error as StockError).code).toBe(code);
}

describe("saveStockLocation", () => {
  it("cria e edita local com nome sem espaços sobrando e tipo padrão depósito", async () => {
    const id = await saveStockLocation(db, { companyId: C, name: "  Furgão 1 ", type: "veiculo", address: "Placa ABC-1234" });
    let [row] = await db.select<Row[]>("SELECT * FROM stock_locations WHERE id=?", [id]);
    expect(row).toMatchObject({ company_id: C, name: "Furgão 1", type: "veiculo", address: "Placa ABC-1234", deleted_at: null });

    await saveStockLocation(db, { companyId: C, id, name: "Furgão 2", type: "", address: "" });
    [row] = await db.select<Row[]>("SELECT * FROM stock_locations WHERE id=?", [id]);
    expect(row).toMatchObject({ name: "Furgão 2", type: "deposito", address: null });
  });

  it("recusa nome vazio ou repetido (sem diferenciar maiúsculas e acentos) entre os locais ativos", async () => {
    await expectStockError(saveStockLocation(db, { companyId: C, name: "   " }), "nome_invalido");
    await expectStockError(saveStockLocation(db, { companyId: C, name: "deposito central" }), "nome_repetido");
    // O próprio local pode manter o nome.
    await saveStockLocation(db, { companyId: C, id: "loc-a", name: "Depósito Central", address: "Rua 1" });
    // Local arquivado libera o nome.
    await db.execute("UPDATE stock_locations SET deleted_at=datetime('now') WHERE id='loc-b'");
    await saveStockLocation(db, { companyId: C, name: "Loja" });
    await expectStockError(saveStockLocation(db, { companyId: C, id: "loc-x", name: "Outro" }), "local_invalido");
  });
});

describe("archiveStockLocation", () => {
  it("só arquiva local sem saldo e sem contagem aberta", async () => {
    await expectStockError(archiveStockLocation(db, { companyId: C, locationId: "loc-b" }), "local_com_saldo");

    await recordStockMovement(db, { companyId: C, itemId: "item-3", type: "saida", quantity: 3, fromLocationId: "loc-b" });
    const count = await openInventoryCount(db, { companyId: C, locationId: "loc-b", userId: user });
    await expectStockError(archiveStockLocation(db, { companyId: C, locationId: "loc-b" }), "contagem_aberta");

    await db.execute("UPDATE inventory_counts SET status='cancelada' WHERE id=?", [count.id]);
    await archiveStockLocation(db, { companyId: C, locationId: "loc-b" });
    const [row] = await db.select<Row[]>("SELECT * FROM stock_locations WHERE id='loc-b'");
    expect(row.deleted_at).toBeTruthy();
    await expectStockError(archiveStockLocation(db, { companyId: C, locationId: "loc-b" }), "local_invalido");
  });

  it("saldo de item excluído não prende o local: a lista já mostra o local vazio e o item não pode mais ser movimentado", async () => {
    // A Loja só tem Mouse USB (3), que é excluído com saldo (a tela de itens deixa, com aviso).
    await db.execute("UPDATE inventory_items SET deleted_at=datetime('now') WHERE id='item-3'");
    expect((await listLocationSummaries(db, C)).find((row) => row.id === "loc-b")).toMatchObject({ item_count: 0, total_qty: 0 });
    await expectStockError(recordStockMovement(db, { companyId: C, itemId: "item-3", type: "saida", quantity: 3, fromLocationId: "loc-b" }), "item_invalido");

    await archiveStockLocation(db, { companyId: C, locationId: "loc-b" });
    const [row] = await db.select<Row[]>("SELECT * FROM stock_locations WHERE id='loc-b'");
    expect(row.deleted_at).toBeTruthy();
    // Item ativo com saldo continua impedindo.
    await expectStockError(archiveStockLocation(db, { companyId: C, locationId: "loc-a" }), "local_com_saldo");
  });
});

describe("listLocationSummaries", () => {
  it("resume itens, unidades e valor (custo) de cada local ativo, por nome", async () => {
    const list = await listLocationSummaries(db, C);
    expect(list.map((row) => [row.name, row.item_count, row.total_qty, row.stock_value, row.open_count_number])).toEqual([
      ["Depósito Central", 2, 14, 295.6, null],
      ["Loja", 1, 3, 146.7, null],
    ]);
    await openInventoryCount(db, { companyId: C, locationId: "loc-b", userId: user });
    expect((await listLocationSummaries(db, C))[1].open_count_number).toBe(1);
  });
});
