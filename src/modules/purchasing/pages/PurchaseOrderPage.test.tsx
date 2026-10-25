// Pedido de compra pela tela: criar com custo sugerido, itens editados na tabela, dados do pedido no próprio lugar,
// aprovar (gerência), enviar, receber em parte no painel da página e estornar na ficha do recebimento (sem modal).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { createPurchaseOrder } from "@/lib/erp/receiving";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import { buttonIn, choose, click, field, mountPage, typeInto, until, type Mounted } from "@/modules/catalog/testHarness";
import { addRow, cellText, editCell, saveTable, startEditing, tableOf } from "@/modules/finance/testing/tableActions";
import type { GoodsReceipt, Payable, PurchaseOrder, PurchaseOrderItem, StockBalance } from "@/types";
import GoodsReceiptsPage from "./GoodsReceiptsPage";
import PurchaseOrderPage from "./PurchaseOrderPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let fx: TradeFixture;
let page: Mounted;

beforeEach(async () => {
  const { companyId } = await insertTestCompany(testDb(), { roles: ["ceo", "gerente", "estoquista"] });
  fx = await seedTradeFixture(testDb(), companyId, "test-user-estoquista");
});

afterEach(() => page?.unmount());

const text = () => page.container.textContent ?? "";
const routes = [
  { path: "/purchasing/pedidos/:id", element: <PurchaseOrderPage /> },
  { path: "/purchasing/recebimentos", element: <GoodsReceiptsPage /> },
];
const open = (role: "ceo" | "gerente" | "estoquista", path: string) => mountPage({ companyId: fx.companyId, role, path, routes });
const order = async () => (await testDb().select<PurchaseOrder[]>("SELECT * FROM purchase_orders WHERE company_id = ?", [fx.companyId]))[0];
const lines = async (orderId: string) => testDb().select<PurchaseOrderItem[]>("SELECT * FROM purchase_order_items WHERE order_id = ? AND deleted_at IS NULL ORDER BY position", [orderId]);
const balance = async (itemId: string, locationId: string) => Number((await testDb().select<StockBalance[]>("SELECT * FROM stock_balances WHERE item_id = ? AND location_id = ?", [itemId, locationId]))[0]?.quantity ?? 0);
const panel = (title: string) => {
  const found = page.container.querySelector<HTMLElement>(`section[aria-label="${title}"]`);
  if (!found) throw new Error(`painel "${title}" não aberto`);
  return found;
};

describe("PurchaseOrderPage", () => {
  it("estoquista cria com custo sugerido; não aprova", async () => {
    page = await open("estoquista", `/purchasing/pedidos/nova?fornecedor=${fx.supplierId}`);
    await until(() => text().includes("Distribuidora Teste") && text().includes("Mouse USB"), "fornecedor e itens carregados");
    expect(field<HTMLSelectElement>(page.container, "Fornecedor").value).toBe(fx.supplierId);
    await choose(page.container.querySelector("select[aria-label='Produto do item 1']"), `p:${fx.products.mouse}`);
    expect(page.container.querySelector<HTMLInputElement>("input[aria-label='Custo unit. do item 1']")?.value).toBe("40");
    await typeInto(page.container.querySelector("input[aria-label='Quantidade do item 1']"), "10");
    await click(buttonIn(page.container, "Salvar rascunho"));
    await until(async () => (await order())?.status === "rascunho" && text().includes("Pedido de compra PC-00001"), "pedido aberto");
    expect(await order()).toMatchObject({ total: 400, supplier_id: fx.supplierId });
    expect(buttonIn(page.container, "Aprovar")).toBeUndefined();
    expect(text()).toContain("Aguardando aprovação da gerência.");
  });

  it("itens e dados do rascunho mudam no próprio lugar, sem modal", async () => {
    const id = await createPurchaseOrder(testDb(), { companyId: fx.companyId, supplierId: fx.supplierId, items: [{ productId: fx.products.mouse, qty: 2, unitPrice: 40 }] });
    const [mouse] = await lines(id);
    page = await open("estoquista", `/purchasing/pedidos/${id}`);
    await until(() => Boolean(page.container.querySelector(`tr[data-row-key="${mouse.id}"]`)), "itens na tabela");
    const items = tableOf(page.container, "purchase_orders");
    expect(cellText(items, mouse.id, "received")).toBe("0 de 2");

    await startEditing(items);
    await editCell(items, mouse.id, "qty", "5");
    await addRow(items);
    await editCell(items, "nova", "ref", `p:${fx.products.switch}`);
    await editCell(items, "nova", "qty", "1");
    await saveTable(items);
    await until(async () => (await lines(id)).length === 2, "itens gravados");
    expect((await lines(id)).map((line) => [line.description, line.qty])).toEqual([["Mouse USB", 5], ["Switch 24 portas", 1]]);
    expect(document.querySelector("[role=dialog]")).toBeNull();

    await click(buttonIn(page.container, "Editar dados do pedido"));
    const form = page.container.querySelector<HTMLFormElement>("form[aria-label='Dados do pedido PC-00001']")!;
    expect(form).not.toBeNull();
    await typeInto(field(form, "Frete"), "1.234,56");
    await typeInto(field(form, "Previsão de entrega"), "2099-05-20");
    await click(buttonIn(form, "Salvar dados"));
    await until(async () => Number((await order()).shipping) === 1234.56, "frete gravado");
    expect(await order()).toMatchObject({ expected_date: "2099-05-20" });
    expect((await lines(id)).map((line) => line.qty)).toEqual([5, 1]);
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("aprova, envia, recebe em parte e estorna pela ficha do recebimento", async () => {
    page = await open("ceo", "/purchasing/pedidos/nova");
    await until(() => text().includes("Distribuidora Teste"), "fornecedores carregados");
    await choose(field<HTMLSelectElement>(page.container, "Fornecedor"), fx.supplierId);
    await choose(field<HTMLSelectElement>(page.container, "Local de entrada"), fx.emptyLocationId);
    await choose(page.container.querySelector("select[aria-label='Produto do item 1']"), `p:${fx.products.mouse}`);
    await typeInto(page.container.querySelector("input[aria-label='Quantidade do item 1']"), "10");
    await click(buttonIn(page.container, "Salvar rascunho"));
    await until(() => Boolean(buttonIn(page.container, "Aprovar")), "pedido aberto");

    await click(buttonIn(page.container, "Aprovar"));
    await until(async () => (await order()).status === "aprovado", "aprovado");
    await until(() => Boolean(buttonIn(page.container, "Marcar como enviado")), "botão enviar");
    await click(buttonIn(page.container, "Marcar como enviado"));
    await until(async () => (await order()).status === "enviado", "enviado");

    await until(() => Boolean(buttonIn(page.container, "Receber mercadoria")), "botão receber");
    await click(buttonIn(page.container, "Receber mercadoria"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    const receive = panel("Receber mercadoria · PC-00001");
    expect(receive.querySelector<HTMLSelectElement>("select[aria-label='Local de Mouse USB']")?.value).toBe(fx.emptyLocationId);
    await typeInto(receive.querySelector("input[aria-label='Quantidade recebida de Mouse USB']"), "4");
    await typeInto(field(receive, "Nota fiscal"), "NF-123");
    await click(buttonIn(receive, "Confirmar recebimento"));
    await until(async () => (await order()).status === "recebido_parcial", "recebido em parte");
    expect(await balance(fx.items.mouse, fx.emptyLocationId)).toBe(4);
    const payables = await testDb().select<Payable[]>("SELECT * FROM payables WHERE company_id = ?", [fx.companyId]);
    expect(payables.map((row) => row.amount)).toEqual([160]);
    await until(() => text().includes("REC-00001") && text().includes("4 de 10"), "recebimento listado");

    page.unmount();
    const [receipt] = await testDb().select<GoodsReceipt[]>("SELECT * FROM goods_receipts WHERE company_id = ?", [fx.companyId]);
    page = await open("estoquista", `/purchasing/recebimentos?rec=${receipt.id}`);
    await until(() => Boolean(page.container.querySelector("section[aria-label='Recebimento REC-00001']")) && text().includes("NF-123"), "ficha do recebimento");
    await click(buttonIn(panel("Recebimento REC-00001"), "Estornar recebimento"));
    await click(buttonIn(panel("Recebimento REC-00001"), "Confirmar estorno"));
    await until(async () => (await testDb().select<GoodsReceipt[]>("SELECT * FROM goods_receipts WHERE id = ?", [receipt.id]))[0].status === "estornado", "estornado");
    expect(await balance(fx.items.mouse, fx.emptyLocationId)).toBe(0);
    expect((await order()).status).toBe("enviado");
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("gerência só aprova: itens e dados bloqueados, sem receber nem excluir", async () => {
    const id = await createPurchaseOrder(testDb(), { companyId: fx.companyId, supplierId: fx.supplierId, items: [{ productId: fx.products.switch, qty: 1 }] });
    page = await open("gerente", `/purchasing/pedidos/${id}`);
    await until(() => Boolean(buttonIn(page.container, "Aprovar")), "botão aprovar");
    expect(buttonIn(page.container, "Editar dados do pedido")).toBeUndefined();
    expect(buttonIn(page.container, "Excluir")).toBeUndefined();
    const items = tableOf(page.container, "purchase_orders");
    const edit = [...items.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Editar")!;
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe("Seu perfil não tem permissão para editar este cadastro.");
    await click(buttonIn(page.container, "Aprovar"));
    await until(async () => (await order()).status === "aprovado", "aprovado");
    expect((await order()).approved_by).toBe("test-user-gerente");
    expect(buttonIn(page.container, "Receber mercadoria")).toBeUndefined();
  });

  it("pedido sem fornecedor (gerado pela reposição do estoque) mostra o fornecedor a definir, não removido", async () => {
    const id = await createPurchaseOrder(testDb(), { companyId: fx.companyId, supplierId: null, items: [{ productId: fx.products.mouse, qty: 2 }] });
    page = await open("estoquista", `/purchasing/pedidos/${id}`);
    await until(() => text().includes("Pedido de compra PC-00001"), "pedido aberto");
    expect(text()).toContain("A definir");
    expect(text()).not.toContain("Fornecedor removido");
  });
});
