// Recebimentos pela tela: linha nova recebe o que falta do pedido (no local do pedido), NF muda na própria tabela e
// quem não pode dar entrada vê Adicionar desativado.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { approvePurchaseOrder, createPurchaseOrder } from "@/lib/erp/receiving";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import { mountPage, until, type Mounted } from "@/modules/catalog/testHarness";
import { addRow, editCell, saveTable, startEditing, tableOf } from "@/modules/finance/testing/tableActions";
import type { GoodsReceipt, PurchaseOrder, StockBalance } from "@/types";
import GoodsReceiptsPage from "./GoodsReceiptsPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let fx: TradeFixture;
let page: Mounted;
let orderId: string;

beforeEach(async () => {
  const { companyId } = await insertTestCompany(testDb(), { roles: ["estoquista", "financeiro"] });
  fx = await seedTradeFixture(testDb(), companyId, "test-user-estoquista");
  orderId = await createPurchaseOrder(testDb(), { companyId, supplierId: fx.supplierId, locationId: fx.emptyLocationId, items: [{ productId: fx.products.mouse, qty: 3, unitPrice: 40 }] });
  await approvePurchaseOrder(testDb(), orderId, { companyId });
});

afterEach(() => page?.unmount());

const open = (role: "estoquista" | "financeiro") => mountPage({ companyId: fx.companyId, role, path: "/purchasing/recebimentos", routes: [{ path: "/purchasing/recebimentos", element: <GoodsReceiptsPage /> }] });
const receipts = async () => testDb().select<GoodsReceipt[]>("SELECT * FROM goods_receipts WHERE company_id = ?", [fx.companyId]);
const loaded = () => until(() => Boolean(page.container.querySelector('[data-editable-table="purchase_orders"] table:not([aria-busy="true"])')), "tabela carregada");

describe("GoodsReceiptsPage", () => {
  it("recebe o pedido pela linha nova e corrige a NF na tabela", async () => {
    page = await open("estoquista");
    await loaded();
    const table = tableOf(page.container, "purchase_orders");
    await addRow(table);
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await editCell(table, "nova", "purchase_order_id", orderId);
    await editCell(table, "nova", "supplier_invoice_number", "NF-55");
    await saveTable(table);
    await until(async () => (await receipts()).length === 1, "recebimento gravado");
    const [receipt] = await receipts();
    expect(receipt).toMatchObject({ supplier_invoice_number: "NF-55", total: 120, status: "conferido" });
    expect((await testDb().select<PurchaseOrder[]>("SELECT * FROM purchase_orders WHERE id = ?", [orderId]))[0].status).toBe("recebido");
    const [stock] = await testDb().select<StockBalance[]>("SELECT * FROM stock_balances WHERE item_id = ? AND location_id = ?", [fx.items.mouse, fx.emptyLocationId]);
    expect(Number(stock.quantity)).toBe(3);

    await until(() => Boolean(page.container.querySelector(`tr[data-row-key="${receipt.id}"]`)), "linha do recebimento");
    await startEditing(table);
    await editCell(table, receipt.id, "supplier_invoice_number", "NF-56");
    await saveTable(table);
    await until(async () => (await receipts())[0].supplier_invoice_number === "NF-56", "NF corrigida");
  });

  it("financeiro consulta, mas não dá entrada", async () => {
    page = await open("financeiro");
    await loaded();
    const add = [...tableOf(page.container, "purchase_orders").querySelectorAll("button")].find((button) => button.textContent?.trim() === "Adicionar")!;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe("Seu perfil não tem permissão para adicionar neste cadastro.");
  });
});
