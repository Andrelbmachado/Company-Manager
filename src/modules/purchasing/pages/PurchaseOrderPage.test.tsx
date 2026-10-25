// Pedido de compra pela tela: criar com custo sugerido, aprovar (gerência), enviar, receber em parte e estornar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import { buttonIn, choose, click, dialog, field, mountPage, typeInto, until, type Mounted } from "@/modules/catalog/testHarness";
import type { GoodsReceipt, Payable, PurchaseOrder, StockBalance } from "@/types";
import GoodsReceiptsPage from "./GoodsReceiptsPage";
import PurchaseOrderPage from "./PurchaseOrderPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

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
const balance = async (itemId: string, locationId: string) => Number((await testDb().select<StockBalance[]>("SELECT * FROM stock_balances WHERE item_id = ? AND location_id = ?", [itemId, locationId]))[0]?.quantity ?? 0);

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

  it("aprova, envia, recebe em parte e estorna pela lista de recebimentos", async () => {
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
    const receiveDialog = dialog("Receber mercadoria · PC-00001");
    expect(receiveDialog.querySelector<HTMLSelectElement>("select[aria-label='Local de Mouse USB']")?.value).toBe(fx.emptyLocationId);
    await typeInto(receiveDialog.querySelector("input[aria-label='Quantidade recebida de Mouse USB']"), "4");
    await typeInto(field(receiveDialog, "Nota fiscal"), "NF-123");
    await click(buttonIn(receiveDialog, "Confirmar recebimento"));
    await until(async () => (await order()).status === "recebido_parcial", "recebido em parte");
    expect(await balance(fx.items.mouse, fx.emptyLocationId)).toBe(4);
    const payables = await testDb().select<Payable[]>("SELECT * FROM payables WHERE company_id = ?", [fx.companyId]);
    expect(payables.map((row) => row.amount)).toEqual([160]);
    await until(() => text().includes("REC-00001"), "recebimento listado");

    page.unmount();
    const [receipt] = await testDb().select<GoodsReceipt[]>("SELECT * FROM goods_receipts WHERE company_id = ?", [fx.companyId]);
    page = await open("estoquista", `/purchasing/recebimentos?rec=${receipt.id}`);
    await until(() => Boolean(document.querySelector("[role=dialog][aria-label='Recebimento REC-00001']")) && (document.body.textContent ?? "").includes("NF-123"), "detalhe do recebimento");
    await click(buttonIn(dialog("Recebimento REC-00001"), "Estornar recebimento"));
    await click(buttonIn(dialog("Estornar REC-00001?"), "Estornar"));
    await until(async () => (await testDb().select<GoodsReceipt[]>("SELECT * FROM goods_receipts WHERE id = ?", [receipt.id]))[0].status === "estornado", "estornado");
    expect(await balance(fx.items.mouse, fx.emptyLocationId)).toBe(0);
    expect((await order()).status).toBe("enviado");
  });

  it("gerência só aprova: sem editar, receber nem excluir", async () => {
    const { createPurchaseOrder } = await import("@/lib/erp/receiving");
    const id = await createPurchaseOrder(testDb(), { companyId: fx.companyId, supplierId: fx.supplierId, items: [{ productId: fx.products.switch, qty: 1 }] });
    page = await open("gerente", `/purchasing/pedidos/${id}`);
    await until(() => Boolean(buttonIn(page.container, "Aprovar")), "botão aprovar");
    expect(buttonIn(page.container, "Editar")).toBeUndefined();
    expect(buttonIn(page.container, "Excluir")).toBeUndefined();
    await click(buttonIn(page.container, "Aprovar"));
    await until(async () => (await order()).status === "aprovado", "aprovado");
    expect((await order()).approved_by).toBe("test-user-gerente");
    expect(buttonIn(page.container, "Receber mercadoria")).toBeUndefined();
  });
});
