// Fornecedores pela tabela editável: só os campos alterados (endereço mesclado), linha nova com o id da tela (sem
// duplicar), tudo conferido antes de gravar (documento único também entre as linhas novas) e a permissão na camada de dados.
import { afterEach, describe, expect, it } from "vitest";
import { PermissionError } from "@/lib/inventory/permission";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import type { Supplier } from "@/types";
import { createPurchaseOrder } from "./receiving";
import { deleteSupplierRow, saveSupplierRows, toSupplierTableRows } from "./supplierRows";
import { supplierAddress } from "./suppliers";
import { seedTradeFixture, type TradeFixture } from "./tradeFixtures";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

const estoquista = { role: "estoquista" as const, userId: "test-user-estoquista" };

async function setup(): Promise<{ db: TestDb; fx: TradeFixture }> {
  db = await createTestDb();
  const { companyId, userIds } = await insertTestCompany(db, { roles: ["ceo", "estoquista", "financeiro", "gerente"] });
  return { db, fx: await seedTradeFixture(db, companyId, userIds.estoquista!) };
}

const one = async (id: string): Promise<Supplier> => (await db!.select<Supplier[]>("SELECT * FROM suppliers WHERE id=?", [id]))[0];

describe("saveSupplierRows", () => {
  it("edita só os campos alterados e mescla o endereço com o gravado", async () => {
    const { db, fx } = await setup();
    await db.execute("UPDATE suppliers SET address_json=?, email=? WHERE id=?", [JSON.stringify({ cidade: "Sorocaba", uf: "SP" }), "a@b.com", fx.supplierId]);
    await saveSupplierRows(db, fx.companyId, estoquista, { updated: [{ id: fx.supplierId, phone: "(11) 3333-4444", cep: "18000-000", rating: "4" }], created: [] });
    const row = await one(fx.supplierId);
    expect(row).toMatchObject({ name: "Distribuidora Teste", document: "11.222.333/0001-81", terms: "28 dias", email: "a@b.com", phone: "(11) 3333-4444", rating: 4 });
    expect(supplierAddress(row)).toEqual({ cidade: "Sorocaba", uf: "SP", cep: "18000-000" });
  });

  it("cria com o id da tela, e-mail em minúsculas e sem duplicar ao salvar de novo", async () => {
    const { db, fx } = await setup();
    const changes = { updated: [], created: [{ id: "sup-novo", name: " Rede Forte ", email: " Vendas@Rede.COM ", cidade: "Itu" }] };
    expect(await saveSupplierRows(db, fx.companyId, estoquista, changes)).toEqual({ created: ["sup-novo"], updated: [] });
    await saveSupplierRows(db, fx.companyId, estoquista, changes);
    expect((await db.select<Supplier[]>("SELECT * FROM suppliers WHERE company_id=? AND name=?", [fx.companyId, "Rede Forte"])).length).toBe(1);
    const row = await one("sup-novo");
    expect(row).toMatchObject({ email: "vendas@rede.com", rating: null });
    expect(supplierAddress(row)).toEqual({ cidade: "Itu" });
  });

  it("documento repetido (no banco ou entre linhas novas), e-mail, avaliação e nome: nada é gravado", async () => {
    const { db, fx } = await setup();
    const save = (row: Record<string, unknown>) =>
      saveSupplierRows(db, fx.companyId, estoquista, { updated: [{ id: fx.supplierId, terms: "45 dias" }], created: [{ id: "ok", name: "Ok" }, { id: "x", name: "X", ...row }] });
    await expect(save({ document: "11222333000181" })).rejects.toThrow(/Já existe um fornecedor com este CNPJ\/CPF: Distribuidora Teste/);
    await expect(save({ email: "sem-arroba" })).rejects.toThrow(/E-mail inválido/);
    await expect(save({ rating: 6 })).rejects.toThrow(/avaliação vai de 1 a 5/);
    await expect(save({ name: "  " })).rejects.toThrow(/Linha nova 2: informe o nome/i);
    await expect(save({ document: "123" })).rejects.toThrow(/Documento inválido/);
    await expect(
      saveSupplierRows(db, fx.companyId, estoquista, { updated: [], created: [{ id: "a", name: "A", document: "45.723.174/0001-10" }, { id: "b", name: "B", document: "45723174000110" }] }),
    ).rejects.toThrow(/CNPJ\/CPF/);
    expect((await one(fx.supplierId)).terms).toBe("28 dias");
    expect(await one("ok")).toBeUndefined();
    // Trocar documentos entre dois cadastros na mesma gravação vale.
    await saveSupplierRows(db, fx.companyId, estoquista, { updated: [], created: [{ id: "c", name: "C", document: "45.723.174/0001-10" }] });
    await saveSupplierRows(db, fx.companyId, estoquista, {
      updated: [
        { id: "c", document: "11.222.333/0001-81" },
        { id: fx.supplierId, document: "45.723.174/0001-10" },
      ],
      created: [],
    });
    expect((await one("c")).document).toBe("11.222.333/0001-81");
  });

  it("permissão: financeiro edita e cria, gerente só consulta; excluir exige delete e respeita pedidos em andamento", async () => {
    const { db, fx } = await setup();
    const financeiro = { role: "financeiro" as const, userId: "test-user-financeiro" };
    const gerente = { role: "gerente" as const, userId: "test-user-gerente" };
    await saveSupplierRows(db, fx.companyId, financeiro, { updated: [{ id: fx.supplierId, terms: "30 dias" }], created: [{ id: "f1", name: "Fin" }] });
    await expect(saveSupplierRows(db, fx.companyId, gerente, { updated: [{ id: fx.supplierId, terms: "1 dia" }], created: [] })).rejects.toBeInstanceOf(PermissionError);
    await expect(saveSupplierRows(db, fx.companyId, gerente, { updated: [], created: [{ id: "g1", name: "G" }] })).rejects.toBeInstanceOf(PermissionError);
    await expect(deleteSupplierRow(db, fx.companyId, financeiro, "f1")).rejects.toBeInstanceOf(PermissionError);
    await createPurchaseOrder(db, { companyId: fx.companyId, supplierId: fx.supplierId, items: [{ inventoryItemId: fx.items.mouse, qty: 1, unitPrice: 40 }] });
    await expect(deleteSupplierRow(db, fx.companyId, estoquista, fx.supplierId)).rejects.toThrow(/pedido/i);
    await deleteSupplierRow(db, fx.companyId, estoquista, "f1");
    expect((await one("f1")).deleted_at).toBeTruthy();
  });
});

describe("toSupplierTableRows", () => {
  it("abre o endereço em colunas e conta os pedidos em andamento", () => {
    const supplier = { id: "s", company_id: "c", name: "S", address_json: JSON.stringify({ cidade: "Itu", uf: "SP" }), created_at: "", updated_at: "" };
    const [row] = toSupplierTableRows([supplier], [
      { supplier_id: "s", status: "enviado" },
      { supplier_id: "s", status: "recebido" },
      { supplier_id: "s", status: "rascunho" },
      { supplier_id: "outro", status: "enviado" },
    ]);
    expect(row).toMatchObject({ id: "s", cidade: "Itu", uf: "SP", logradouro: null, open_orders: 2 });
  });
});
