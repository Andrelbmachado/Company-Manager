// Gravações das tabelas de Compras: permissão conferida na camada de dados, pedido em rascunho editado por inteiro
// (cabeçalho e itens), pedido aprovado só muda previsão e observações, recebimento pela linha nova e fornecedor
// conferido antes de gravar.
import { describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { approvePurchaseOrder, createPurchaseOrder, loadPurchaseOrderItems } from "@/lib/erp/receiving";
import { seedTradeFixture } from "@/lib/erp/tradeFixtures";
import type { GoodsReceipt, PurchaseOrder, PurchaseOrderItem, Role, Supplier } from "@/types";
import { approveOrder, receiveOrder } from "./orderActions";
import { purchaseItemRow, removePurchaseItem, savePurchaseItemChanges } from "./purchaseItemEditing";
import { savePurchaseOrderChanges } from "./purchaseOrderEditing";
import { saveReceiptChanges } from "./receiptEditing";
import { saveSupplierChanges } from "./supplierEditing";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();

async function setup(role: Role = "estoquista") {
  const db = testDb();
  const { companyId } = await insertTestCompany(db, { companyId: "empresa-compras", roles: [role] });
  const fx = await seedTradeFixture(db, companyId, `test-user-${role}`);
  const orderId = await createPurchaseOrder(db, { companyId, supplierId: fx.supplierId, locationId: fx.emptyLocationId, items: [{ productId: fx.products.mouse, qty: 2, unitPrice: 40 }] });
  return { db, fx, orderId, ctx: { companyId, role, userId: `test-user-${role}` } };
}

const order = async (id: string) => (await testDb().select<PurchaseOrder[]>("SELECT * FROM purchase_orders WHERE id = ?", [id]))[0];
const items = async (companyId: string, id: string) => loadPurchaseOrderItems(testDb(), companyId, id);

describe("savePurchaseOrderChanges", () => {
  it("edita o rascunho mantendo itens, desconto e frete; adiciona pedido com o 1º item", async () => {
    const { db, ctx, fx, orderId } = await setup();
    await testDb().execute("UPDATE purchase_orders SET discount = 5, shipping = 10, total = total - 5 + 10 WHERE id = ?", [orderId]);
    const created = await savePurchaseOrderChanges(db, ctx, {
      updated: [{ id: orderId, expected_date: "2099-03-10", payment_terms: "28 dias", installments: 2 }],
      created: [{ supplier_id: fx.supplierId, order_date: "2099-01-05", notes: "Reposição", first_item: `p:${fx.products.mouse}`, first_qty: 3 }],
    });
    expect(await order(orderId)).toMatchObject({ expected_date: "2099-03-10", payment_terms: "28 dias", installments: 2, discount: 5, shipping: 10, total: 85, location_id: fx.emptyLocationId });
    expect((await items(ctx.companyId, orderId)).map((item) => [item.description, item.qty, item.unit_price])).toEqual([["Mouse USB", 2, 40]]);
    expect(created).toHaveLength(1);
    expect(await order(created[0])).toMatchObject({ status: "rascunho", supplier_id: fx.supplierId, order_date: "2099-01-05", notes: "Reposição", total: 120 });
    await expect(savePurchaseOrderChanges(db, ctx, { updated: [], created: [{ supplier_id: fx.supplierId }] })).rejects.toThrow(/1º item/);
  });

  it("trocar só o 1º item do rascunho mantém a quantidade; descrição e custo vêm do novo produto", async () => {
    const { db, ctx, fx, orderId } = await setup();
    await savePurchaseOrderChanges(db, ctx, { updated: [{ id: orderId, first_item: `p:${fx.products.switch}` }], created: [] });
    expect((await items(ctx.companyId, orderId)).map((item) => [item.description, item.qty, item.unit_price])).toEqual([["Switch 24 portas", 2, 2000]]);
    expect(await order(orderId)).toMatchObject({ total: 4000 });
  });

  it("pedido aprovado só muda previsão e observações; nada é gravado se uma linha tem erro", async () => {
    const { db, ctx, orderId } = await setup("ceo");
    await approvePurchaseOrder(db, orderId, { companyId: ctx.companyId });
    await savePurchaseOrderChanges(db, ctx, { updated: [{ id: orderId, expected_date: "2099-04-01", notes: "Atrasou" }], created: [] });
    expect(await order(orderId)).toMatchObject({ status: "aprovado", expected_date: "2099-04-01", notes: "Atrasou" });
    await expect(savePurchaseOrderChanges(db, ctx, { updated: [{ id: orderId, installments: 3, notes: "Outra" }], created: [] })).rejects.toThrow(/PC-00001: .*previsão de entrega e as observações/);
    expect(await order(orderId)).toMatchObject({ installments: 1, notes: "Atrasou" });
  });

  it("papel sem permissão é barrado antes de gravar", async () => {
    const { db, ctx, orderId } = await setup("gerente");
    await expect(savePurchaseOrderChanges(db, ctx, { updated: [{ id: orderId, notes: "x" }], created: [] })).rejects.toThrow(/permissão para editar/);
    await expect(savePurchaseOrderChanges(db, ctx, { updated: [], created: [{ notes: "x" }] })).rejects.toThrow(/permissão para adicionar/);
    await expect(approveOrder(db, { ...ctx, role: "estoquista" }, orderId)).rejects.toThrow(/permissão/);
    expect(await order(orderId)).toMatchObject({ status: "rascunho", notes: null });
  });
});

describe("savePurchaseItemChanges", () => {
  it("altera, adiciona e remove itens do rascunho (custo sugerido quando vazio)", async () => {
    const { db, ctx, fx, orderId } = await setup();
    const [mouse] = await items(ctx.companyId, orderId);
    expect(purchaseItemRow(mouse)).toMatchObject({ ref: `p:${fx.products.mouse}`, qty: 2, received: "0 de 2" });
    await savePurchaseItemChanges(db, ctx, orderId, {
      updated: [{ id: mouse.id, qty: 5 }],
      created: [{ ref: `p:${fx.products.switch}`, qty: 1 }],
    });
    let lines = await items(ctx.companyId, orderId);
    expect(lines.map((item) => [item.description, item.qty])).toEqual([["Mouse USB", 5], ["Switch 24 portas", 1]]);
    expect(lines[1].unit_price).toBeGreaterThan(0);
    expect((await order(orderId)).total).toBe(200 + lines[1].unit_price);

    await removePurchaseItem(db, ctx, orderId, lines[1].id);
    lines = await items(ctx.companyId, orderId);
    expect(lines.map((item) => item.description)).toEqual(["Mouse USB"]);
    expect((await order(orderId)).total).toBe(200);
    await expect(removePurchaseItem(db, ctx, orderId, lines[0].id)).rejects.toThrow(/ao menos um item/);
  });

  it("trocar só o produto do item mantém quantidade, desconto e imposto", async () => {
    const { db, ctx, fx, orderId } = await setup();
    const [mouse] = await items(ctx.companyId, orderId);
    await savePurchaseItemChanges(db, ctx, orderId, { updated: [{ id: mouse.id, discount: 5, tax_rate: 10 }], created: [] });
    const [edited] = await items(ctx.companyId, orderId);
    await savePurchaseItemChanges(db, ctx, orderId, { updated: [{ id: edited.id, ref: `p:${fx.products.switch}` }], created: [] });
    expect((await items(ctx.companyId, orderId)).map((item) => [item.description, item.qty, item.unit_price, item.discount, item.tax_rate])).toEqual([["Switch 24 portas", 2, 2000, 5, 10]]);
  });

  it("pedido aprovado não muda itens; papel sem permissão é barrado", async () => {
    const { db, ctx, orderId } = await setup("ceo");
    const [mouse] = await items(ctx.companyId, orderId);
    await expect(savePurchaseItemChanges(db, { ...ctx, role: "gerente" }, orderId, { updated: [{ id: mouse.id, qty: 9 }], created: [] })).rejects.toThrow(/permissão para editar/);
    await approvePurchaseOrder(db, orderId, { companyId: ctx.companyId });
    await expect(savePurchaseItemChanges(db, ctx, orderId, { updated: [{ id: mouse.id, qty: 9 }], created: [] })).rejects.toThrow(/rascunho/);
    expect((await items(ctx.companyId, orderId)).map((item: PurchaseOrderItem) => item.qty)).toEqual([2]);
  });
});

describe("saveReceiptChanges", () => {
  it("linha nova recebe o que falta no local do pedido; NF e observações mudam depois", async () => {
    const { db, ctx, orderId } = await setup("ceo");
    await approvePurchaseOrder(db, orderId, { companyId: ctx.companyId });
    await saveReceiptChanges(db, ctx, { updated: [], created: [{ purchase_order_id: orderId, supplier_invoice_number: "NF-77" }] });
    const [receipt] = await db.select<GoodsReceipt[]>("SELECT * FROM goods_receipts WHERE company_id = ?", [ctx.companyId]);
    expect(receipt).toMatchObject({ status: "conferido", supplier_invoice_number: "NF-77", total: 80 });
    expect(await order(orderId)).toMatchObject({ status: "recebido" });

    await saveReceiptChanges(db, ctx, { updated: [{ id: receipt.id, supplier_invoice_number: "NF-78", notes: "Caixa amassada" }], created: [] });
    expect((await db.select<GoodsReceipt[]>("SELECT * FROM goods_receipts WHERE id = ?", [receipt.id]))[0]).toMatchObject({ supplier_invoice_number: "NF-78", notes: "Caixa amassada", total: 80 });
    await expect(saveReceiptChanges(db, ctx, { updated: [{ id: receipt.id, purchase_order_id: "outro" }], created: [] })).rejects.toThrow(/REC-00001: o pedido do recebimento não muda/);
  });

  it("sem permissão de receber é barrado; pedido em rascunho não recebe", async () => {
    const { db, ctx, orderId } = await setup("ceo");
    await expect(saveReceiptChanges(db, ctx, { updated: [], created: [{ purchase_order_id: orderId }] })).rejects.toThrow(/Aprove o pedido/);
    await approvePurchaseOrder(db, orderId, { companyId: ctx.companyId });
    await expect(saveReceiptChanges(db, { ...ctx, role: "financeiro" }, { updated: [], created: [{ purchase_order_id: orderId }] })).rejects.toThrow(/permissão/);
    await expect(receiveOrder(db, { ...ctx, role: "gerente" }, orderId, [], {})).rejects.toThrow(/entrada de mercadoria/);
    expect(await db.select<GoodsReceipt[]>("SELECT * FROM goods_receipts WHERE company_id = ?", [ctx.companyId])).toHaveLength(0);
  });
});

describe("saveSupplierChanges", () => {
  it("grava endereço e avaliação, recusa CNPJ repetido sem gravar nada", async () => {
    const { db, ctx, fx } = await setup();
    const [id] = await saveSupplierChanges(db, ctx, {
      updated: [{ id: fx.supplierId, terms: "30 dias", rating: "4" }],
      created: [{ name: "Eletro Peças Ltda", document: "45.723.174/0001-10", email: "Vendas@EletroPecas.com.br", cidade: "Sorocaba", uf: "SP" }],
    });
    const rows = await db.select<Supplier[]>("SELECT * FROM suppliers WHERE company_id = ? ORDER BY name", [ctx.companyId]);
    expect(rows.find((row) => row.id === fx.supplierId)).toMatchObject({ terms: "30 dias", rating: 4, name: "Distribuidora Teste" });
    const created = rows.find((row) => row.id === id)!;
    expect(created).toMatchObject({ email: "vendas@eletropecas.com.br", document: "45.723.174/0001-10" });
    expect(JSON.parse(created.address_json)).toEqual({ cidade: "Sorocaba", uf: "SP" });

    await expect(saveSupplierChanges(db, ctx, { updated: [{ id, notes: "ok" }], created: [{ name: "Repetido", document: "11222333000181" }] })).rejects.toThrow("Repetido: Já existe um fornecedor com este CNPJ/CPF: Distribuidora Teste.");
    expect((await db.select<Supplier[]>("SELECT * FROM suppliers WHERE id = ?", [id]))[0].notes).toBeNull();
  });

  it("papel sem permissão é barrado", async () => {
    const { db, ctx, fx } = await setup("gerente");
    await expect(saveSupplierChanges(db, ctx, { updated: [{ id: fx.supplierId, name: "Outro" }], created: [] })).rejects.toThrow(/permissão para editar/);
  });
});
