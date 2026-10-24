// Motor de estoque (SQLite real): entradas, saídas, ajustes e transferências entre locais, sem saldo negativo.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/sqlite";
import type { DatabaseLike } from "@/lib/db/demo";
import { recordStockMovement, StockError, transferStock } from "./stock";
import { balanceOf, countRows, seedStockFixture } from "./testFixtures";

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
  expect((error as StockError).message).not.toBe("");
}

describe("recordStockMovement", () => {
  it("entrada soma no local e cria o saldo quando o local ainda não tem o item; custo padrão = custo do item", async () => {
    const id = await recordStockMovement(db, { companyId: C, itemId: "item-2", type: "entrada", quantity: 4, toLocationId: "loc-a", userId: user, note: "Compra avulsa" });
    expect(await balanceOf(db, "item-2", "loc-a")).toBe(4);
    await recordStockMovement(db, { companyId: C, itemId: "item-2", type: "entrada", quantity: 1.5, toLocationId: "loc-a", unitCost: 2000 });
    expect(await balanceOf(db, "item-2", "loc-a")).toBe(5.5);

    const [movement] = await db.select<Row[]>("SELECT * FROM stock_movements WHERE id=?", [id]);
    expect(movement).toMatchObject({ company_id: C, item_id: "item-2", type: "entrada", quantity: 4, from_location_id: null, to_location_id: "loc-a", unit_cost: 2180.5, user_id: user, note: "Compra avulsa", ref_type: "manual" });
    expect(await countRows(db, "stock_balances")).toBe(4);
  });

  it("saída baixa o saldo; saída maior que o saldo é recusada sem gravar nada", async () => {
    await recordStockMovement(db, { companyId: C, itemId: "item-1", type: "saida", quantity: 3, fromLocationId: "loc-a" });
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(7);

    await expectStockError(recordStockMovement(db, { companyId: C, itemId: "item-1", type: "saida", quantity: 8, fromLocationId: "loc-a" }), "saldo_insuficiente");
    await expectStockError(recordStockMovement(db, { companyId: C, itemId: "item-2", type: "saida", quantity: 1, fromLocationId: "loc-a" }), "saldo_insuficiente");
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(7);
    expect(await countRows(db, "stock_movements")).toBe(1);
  });

  it("saída que zera o saldo é aceita (zero não é negativo)", async () => {
    await recordStockMovement(db, { companyId: C, itemId: "item-1", type: "saida", quantity: 10, fromLocationId: "loc-a" });
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(0);
  });

  it("ajuste: falta sai do local (from), sobra entra (to); os dois locais ao mesmo tempo é recusado", async () => {
    await recordStockMovement(db, { companyId: C, itemId: "item-1", type: "ajuste", quantity: 2, fromLocationId: "loc-a", note: "falta" });
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(8);
    await recordStockMovement(db, { companyId: C, itemId: "item-1", type: "ajuste", quantity: 5, toLocationId: "loc-a", note: "sobra" });
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(13);
    await expectStockError(recordStockMovement(db, { companyId: C, itemId: "item-1", type: "ajuste", quantity: 1, fromLocationId: "loc-a", toLocationId: "loc-b" }), "locais_invalidos");
  });

  it("confere o sentido de cada tipo: entrada sem destino, saída sem origem e transferência sem os dois locais são recusadas", async () => {
    await expectStockError(recordStockMovement(db, { companyId: C, itemId: "item-1", type: "entrada", quantity: 1 }), "locais_invalidos");
    await expectStockError(recordStockMovement(db, { companyId: C, itemId: "item-1", type: "entrada", quantity: 1, fromLocationId: "loc-a", toLocationId: "loc-b" }), "locais_invalidos");
    await expectStockError(recordStockMovement(db, { companyId: C, itemId: "item-1", type: "saida", quantity: 1, toLocationId: "loc-a" }), "locais_invalidos");
    await expectStockError(recordStockMovement(db, { companyId: C, itemId: "item-1", type: "transferencia", quantity: 1, fromLocationId: "loc-a" }), "locais_invalidos");
    await expectStockError(recordStockMovement(db, { companyId: C, itemId: "item-1", type: "transferencia", quantity: 1, fromLocationId: "loc-a", toLocationId: "loc-a" }), "mesmo_local");
    expect(await countRows(db, "stock_movements")).toBe(0);
  });

  it("recusa quantidade zero, negativa ou que não é número", async () => {
    for (const quantity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expectStockError(recordStockMovement(db, { companyId: C, itemId: "item-1", type: "entrada", quantity, toLocationId: "loc-a" }), "quantidade_invalida");
    }
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(10);
  });

  it("recusa item ou local excluído ou de outra empresa", async () => {
    await db.execute("INSERT INTO companies (id, name) VALUES ('outra', 'Outra')");
    await db.execute("INSERT INTO stock_locations (id, company_id, name) VALUES ('loc-x', 'outra', 'Depósito da outra')");
    await db.execute("INSERT INTO inventory_items (id, company_id, name) VALUES ('item-x', 'outra', 'Item da outra')");
    await db.execute("UPDATE stock_locations SET deleted_at=datetime('now') WHERE id='loc-b'");

    await expectStockError(recordStockMovement(db, { companyId: C, itemId: "item-x", type: "entrada", quantity: 1, toLocationId: "loc-a" }), "item_invalido");
    await expectStockError(recordStockMovement(db, { companyId: C, itemId: "item-1", type: "entrada", quantity: 1, toLocationId: "loc-x" }), "local_invalido");
    await expectStockError(recordStockMovement(db, { companyId: C, itemId: "item-1", type: "entrada", quantity: 1, toLocationId: "loc-b" }), "local_invalido");
    await db.execute("UPDATE inventory_items SET deleted_at=datetime('now') WHERE id='item-1'");
    await expectStockError(recordStockMovement(db, { companyId: C, itemId: "item-1", type: "saida", quantity: 1, fromLocationId: "loc-a" }), "item_invalido");
    expect(await countRows(db, "stock_movements")).toBe(0);
  });

  it("quantidade fracionada não acumula erro de ponto flutuante (0,1 + 0,2 = 0,3)", async () => {
    await recordStockMovement(db, { companyId: C, itemId: "item-4", type: "entrada", quantity: 0.1, toLocationId: "loc-b" });
    await recordStockMovement(db, { companyId: C, itemId: "item-4", type: "entrada", quantity: 0.2, toLocationId: "loc-b" });
    expect(await balanceOf(db, "item-4", "loc-b")).toBe(0.3);
  });

  it("se o saldo mudar entre a leitura e a gravação (outra janela), recusa em vez de deixar saldo negativo", async () => {
    let raced = false;
    const racing: DatabaseLike = {
      select: (sql, binds) => db.select(sql, binds),
      execute: async (sql, binds) => {
        if (!raced && /UPDATE stock_balances/i.test(sql)) {
          raced = true;
          // Outra gravação levou quase tudo do local antes desta.
          await db.execute("UPDATE stock_balances SET quantity=1 WHERE item_id='item-1' AND location_id='loc-a'");
        }
        return db.execute(sql, binds);
      },
    };
    await expectStockError(recordStockMovement(racing, { companyId: C, itemId: "item-1", type: "saida", quantity: 5, fromLocationId: "loc-a" }), "conflito");
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(1);
    expect(await countRows(db, "stock_movements")).toBe(0);
  });

  it("se o destino falhar depois de baixar a origem, devolve o saldo da origem", async () => {
    const failing: DatabaseLike = {
      select: (sql, binds) => db.select(sql, binds),
      execute: async (sql, binds) => {
        if (/INSERT INTO stock_movements/i.test(sql)) throw new Error("disco cheio");
        return db.execute(sql, binds);
      },
    };
    await expect(recordStockMovement(failing, { companyId: C, itemId: "item-1", type: "transferencia", quantity: 4, fromLocationId: "loc-a", toLocationId: "loc-b" })).rejects.toThrow(/disco cheio/);
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(10);
    expect(await balanceOf(db, "item-1", "loc-b") ?? 0).toBe(0);
  });
});

describe("transferStock", () => {
  it("move a quantidade entre locais, cria o saldo no destino e agrupa as linhas pela transferência", async () => {
    const result = await transferStock(db, { companyId: C, fromLocationId: "loc-a", toLocationId: "loc-b", lines: [{ itemId: "item-1", quantity: 4 }, { itemId: "item-3", quantity: 4 }], userId: user, note: "Reposição da loja" });
    expect(result.movementIds).toHaveLength(2);
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(6);
    expect(await balanceOf(db, "item-1", "loc-b")).toBe(4);
    expect(await balanceOf(db, "item-3", "loc-a")).toBe(0);
    expect(await balanceOf(db, "item-3", "loc-b")).toBe(7);

    const rows = await db.select<Row[]>("SELECT * FROM stock_movements ORDER BY item_id");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ type: "transferencia", from_location_id: "loc-a", to_location_id: "loc-b", ref_type: "transfer", ref_id: result.transferId, user_id: user, note: "Reposição da loja" });
    }
  });

  it("estoque nunca negativo: transferir mais que o saldo da origem é recusado e nada é gravado (nem as linhas boas)", async () => {
    await expectStockError(
      transferStock(db, { companyId: C, fromLocationId: "loc-a", toLocationId: "loc-b", lines: [{ itemId: "item-3", quantity: 2 }, { itemId: "item-1", quantity: 11 }] }),
      "saldo_insuficiente",
    );
    await expectStockError(
      transferStock(db, { companyId: C, fromLocationId: "loc-b", toLocationId: "loc-a", lines: [{ itemId: "item-1", quantity: 1 }] }),
      "saldo_insuficiente",
    );
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(10);
    expect(await balanceOf(db, "item-3", "loc-a")).toBe(4);
    expect(await balanceOf(db, "item-3", "loc-b")).toBe(3);
    expect(await countRows(db, "stock_movements")).toBe(0);
  });

  it("o mesmo item em duas linhas soma antes de conferir o saldo e vira uma movimentação só", async () => {
    await expectStockError(
      transferStock(db, { companyId: C, fromLocationId: "loc-a", toLocationId: "loc-b", lines: [{ itemId: "item-1", quantity: 6 }, { itemId: "item-1", quantity: 5 }] }),
      "saldo_insuficiente",
    );
    expect(await countRows(db, "stock_movements")).toBe(0);

    const result = await transferStock(db, { companyId: C, fromLocationId: "loc-a", toLocationId: "loc-b", lines: [{ itemId: "item-1", quantity: 6 }, { itemId: "item-1", quantity: 4 }] });
    expect(result.movementIds).toHaveLength(1);
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(0);
    expect(await balanceOf(db, "item-1", "loc-b")).toBe(10);
  });

  it("se uma linha falhar no meio da gravação, desfaz as anteriores: nada é transferido", async () => {
    let movementInserts = 0;
    const failing: DatabaseLike = {
      select: (sql, binds) => db.select(sql, binds),
      execute: async (sql, binds) => {
        if (/INSERT INTO stock_movements/i.test(sql) && ++movementInserts === 2) throw new Error("disco cheio");
        return db.execute(sql, binds);
      },
    };
    await expect(
      transferStock(failing, { companyId: C, fromLocationId: "loc-a", toLocationId: "loc-b", lines: [{ itemId: "item-1", quantity: 4 }, { itemId: "item-3", quantity: 2 }] }),
    ).rejects.toThrow(/disco cheio/);
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(10);
    expect((await balanceOf(db, "item-1", "loc-b")) ?? 0).toBe(0);
    expect(await balanceOf(db, "item-3", "loc-a")).toBe(4);
    expect(await balanceOf(db, "item-3", "loc-b")).toBe(3);
    expect(await countRows(db, "stock_movements")).toBe(0);
  });

  it("se outra gravação criar o saldo do destino no meio do caminho, recusa (conflito) e devolve a origem", async () => {
    let raced = false;
    const racing: DatabaseLike = {
      select: (sql, binds) => db.select(sql, binds),
      execute: async (sql, binds) => {
        if (!raced && /INSERT INTO stock_balances/i.test(sql)) {
          raced = true;
          await db.execute("INSERT INTO stock_balances (id, company_id, item_id, location_id, quantity) VALUES ('bal-1b', ?, 'item-1', 'loc-b', 1)", [C]);
        }
        return db.execute(sql, binds);
      },
    };
    await expectStockError(transferStock(racing, { companyId: C, fromLocationId: "loc-a", toLocationId: "loc-b", lines: [{ itemId: "item-1", quantity: 4 }] }), "conflito");
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(10);
    expect(await balanceOf(db, "item-1", "loc-b")).toBe(1);
    expect(await countRows(db, "stock_movements")).toBe(0);
  });

  it("recusa transferência sem linhas, para o mesmo local ou com quantidade inválida", async () => {
    await expectStockError(transferStock(db, { companyId: C, fromLocationId: "loc-a", toLocationId: "loc-b", lines: [] }), "sem_itens");
    await expectStockError(transferStock(db, { companyId: C, fromLocationId: "loc-a", toLocationId: "loc-a", lines: [{ itemId: "item-1", quantity: 1 }] }), "mesmo_local");
    await expectStockError(transferStock(db, { companyId: C, fromLocationId: "loc-a", toLocationId: "loc-b", lines: [{ itemId: "item-1", quantity: -2 }] }), "quantidade_invalida");
    await expectStockError(transferStock(db, { companyId: C, fromLocationId: "loc-a", toLocationId: "loc-z", lines: [{ itemId: "item-1", quantity: 1 }] }), "local_invalido");
    expect(await countRows(db, "stock_movements")).toBe(0);
  });
});
