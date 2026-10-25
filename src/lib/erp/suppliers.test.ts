import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import type { Supplier } from "@/types";
import { createPurchaseOrder } from "./receiving";
import { deleteSupplier, saveSupplier, supplierAddress } from "./suppliers";
import { seedTradeFixture, type TradeFixture } from "./tradeFixtures";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

async function setup(): Promise<{ db: TestDb; fx: TradeFixture }> {
  db = await createTestDb();
  const { companyId, userIds } = await insertTestCompany(db, { roles: ["ceo", "estoquista"] });
  return { db, fx: await seedTradeFixture(db, companyId, userIds.estoquista!) };
}

const one = async (id: string): Promise<Supplier> => (await db!.select<Supplier[]>("SELECT * FROM suppliers WHERE id=?", [id]))[0];

describe("fornecedores", () => {
  it("cadastra com e-mail em minúsculas, endereço em JSON e campos vazios como NULL", async () => {
    const { db, fx } = await setup();
    const id = await saveSupplier(db, fx.companyId, {
      name: " Rede Forte Ltda ",
      tradeName: "Rede Forte",
      document: "45.723.174/0001-10",
      email: " Vendas@RedeForte.COM.br ",
      phone: "(11) 3333-4444",
      contactName: "Marcos",
      category: "Rede",
      terms: "30 dias",
      rating: 4,
      website: "",
      address: { logradouro: "Rua A", numero: "10", cidade: "Sorocaba", uf: "SP", cep: "18000-000" },
    });
    const row = await one(id);
    expect(row).toMatchObject({ name: "Rede Forte Ltda", trade_name: "Rede Forte", email: "vendas@redeforte.com.br", rating: 4, website: null, category: "Rede" });
    expect(supplierAddress(row)).toMatchObject({ cidade: "Sorocaba", uf: "SP" });
  });

  it("recusa documento repetido (só dígitos), e-mail inválido e avaliação fora de 1 a 5", async () => {
    const { db, fx } = await setup();
    await expect(saveSupplier(db, fx.companyId, { name: "Duplicado", document: "11222333000181" })).rejects.toThrow(/CNPJ|documento/i);
    await expect(saveSupplier(db, fx.companyId, { name: "X", email: "sem-arroba" })).rejects.toThrow(/e-mail/i);
    await expect(saveSupplier(db, fx.companyId, { name: "X", rating: 6 })).rejects.toThrow(/avaliação/i);
    await expect(saveSupplier(db, fx.companyId, { name: "" })).rejects.toThrow(/nome/i);
    // Editar o próprio cadastro mantendo o documento não conflita.
    await saveSupplier(db, fx.companyId, { name: "Distribuidora Teste S/A", document: "11.222.333/0001-81" }, fx.supplierId);
    expect((await one(fx.supplierId)).name).toBe("Distribuidora Teste S/A");
  });

  it("exclui (soft delete) só sem pedido de compra em andamento", async () => {
    const { db, fx } = await setup();
    await createPurchaseOrder(db, { companyId: fx.companyId, supplierId: fx.supplierId, items: [{ inventoryItemId: fx.items.mouse, qty: 1, unitPrice: 40 }] });
    await expect(deleteSupplier(db, fx.companyId, fx.supplierId)).rejects.toThrow(/pedido/i);
    const other = await saveSupplier(db, fx.companyId, { name: "Sem pedidos" });
    await deleteSupplier(db, fx.companyId, other);
    expect((await one(other)).deleted_at).toBeTruthy();
  });
});
