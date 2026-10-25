// Lista de pedidos de compra pela tela: pedido novo pela linha da tabela (abre o pedido), pedido aprovado só muda
// previsão e observações, a previsão de entrega no calendário e rascunho que não se perde ao ver o calendário.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { approvePurchaseOrder, createPurchaseOrder } from "@/lib/erp/receiving";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import { todayIso } from "@/lib/utils";
import { buttonIn, click, mountPage, until, type Mounted } from "@/modules/catalog/testHarness";
import { addRow, cellField, cellText, editCell, saveError, saveTable, startEditing, tableOf } from "@/modules/finance/testing/tableActions";
import type { PurchaseOrder } from "@/types";
import PurchasingPage from "./PurchasingPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let fx: TradeFixture;
let page: Mounted;

beforeEach(async () => {
  const { companyId } = await insertTestCompany(testDb(), { roles: ["estoquista"] });
  fx = await seedTradeFixture(testDb(), companyId, "test-user-estoquista");
});

afterEach(() => page?.unmount());

const open = () => mountPage({ companyId: fx.companyId, role: "estoquista", path: "/purchasing", routes: [{ path: "/purchasing", element: <PurchasingPage /> }, { path: "/purchasing/pedidos/:id", element: <p>tela do pedido</p> }] });
const orders = async () => testDb().select<PurchaseOrder[]>("SELECT * FROM purchase_orders WHERE company_id = ? ORDER BY number", [fx.companyId]);

describe("PurchasingPage", () => {
  it("adiciona o pedido pela tabela com o 1º item e abre o pedido", async () => {
    page = await open();
    await until(() => Boolean(page.container.querySelector('[data-editable-table="purchase_orders"] table:not([aria-busy="true"])')), "tabela carregada");
    const table = tableOf(page.container, "purchase_orders");
    await addRow(table);
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await editCell(table, "nova", "supplier_id", fx.supplierId);
    await editCell(table, "nova", "first_item", `p:${fx.products.mouse}`);
    await editCell(table, "nova", "first_qty", "3");
    // Salvar grava e já abre a tela do pedido (a tabela sai da tela).
    await click(buttonIn(table, "Salvar"));
    await until(async () => (await orders()).length === 1, "pedido gravado");
    const [created] = await orders();
    expect(created).toMatchObject({ status: "rascunho", supplier_id: fx.supplierId, total: 120 });
    await until(() => page.path() === `/purchasing/pedidos/${created.id}`, "pedido aberto");
  });

  it("linha nova continua na tabela depois de ver o calendário", async () => {
    page = await open();
    await until(() => Boolean(page.container.querySelector('[data-editable-table="purchase_orders"] table:not([aria-busy="true"])')), "tabela carregada");
    const table = tableOf(page.container, "purchase_orders");
    await addRow(table);
    await editCell(table, "nova", "supplier_id", fx.supplierId);
    const toggle = (label: string) => [...page.container.querySelectorAll("button")].find((button) => button.textContent?.trim() === label);
    await click(toggle("Calendário"));
    await click(toggle("Lista"));
    expect(cellField(tableOf(page.container, "purchase_orders"), "nova", "supplier_id").value).toBe(fx.supplierId);
  });

  it("pedido aprovado muda a previsão na tabela e aparece no calendário", async () => {
    const id = await createPurchaseOrder(testDb(), { companyId: fx.companyId, supplierId: fx.supplierId, items: [{ productId: fx.products.mouse, qty: 2 }] });
    await approvePurchaseOrder(testDb(), id, { companyId: fx.companyId });
    page = await open();
    await until(() => Boolean(page.container.querySelector(`tr[data-row-key="${id}"]`)), "pedido na lista");
    const table = tableOf(page.container, "purchase_orders");
    expect(cellText(table, id, "first_item")).toBe("Mouse USB");

    await startEditing(table);
    await editCell(table, id, "installments", "3");
    expect(await saveError(table)).toContain("PC-00001: pedido aprovado só muda a previsão de entrega e as observações");
    await click([...table.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Cancelar"));

    const today = todayIso();
    await startEditing(table);
    await editCell(table, id, "expected_date", today.split("-").reverse().join("/"));
    await saveTable(table);
    await until(async () => (await orders())[0].expected_date === today, "previsão gravada");
    expect((await orders())[0].installments).toBe(1);

    await click([...page.container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Calendário"));
    await until(() => Boolean(page.container.querySelector(`button[data-item-id="${id}"]`)), "pedido no calendário");
    await click(page.container.querySelector(`button[data-item-id="${id}"]`));
    await until(() => page.path() === `/purchasing/pedidos/${id}`, "pedido aberto pelo calendário");
  });
});
