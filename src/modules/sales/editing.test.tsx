// Contrato da Tarefa 6 (grupo comercial) em Vendas: listas de pedidos e faturas e os itens do pedido são EditableTable;
// Editar/Adicionar e as ações do pedido (editar, faturar) não abrem diálogo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { expectInlineEditing, expectNoDialog } from "@/test/inlineEditing";
import { confirmSalesOrder, createSalesOrder, invoiceSalesOrder } from "@/lib/erp/orders";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import { buttonIn, click, mountPage, until, type Mounted } from "@/modules/catalog/testHarness";
import { addRow, cellField, editCell, tableOf } from "@/modules/finance/testing/tableActions";
import InvoicesPage from "./pages/InvoicesPage";
import SalesOrderPage from "./pages/SalesOrderPage";
import SalesPage from "./pages/SalesPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let fx: TradeFixture;
let page: Mounted;
let orderId: string;

beforeEach(async () => {
  const { companyId } = await insertTestCompany(testDb(), { roles: ["ceo"] });
  fx = await seedTradeFixture(testDb(), companyId, "test-user-ceo");
  const billed = await createSalesOrder(testDb(), { companyId, customerId: fx.customerId, items: [{ productId: fx.products.visita, qty: 1 }] });
  await confirmSalesOrder(testDb(), billed, { companyId });
  await invoiceSalesOrder(testDb(), billed, { companyId });
  orderId = await createSalesOrder(testDb(), { companyId, customerId: fx.otherCustomerId, items: [{ productId: fx.products.mouse, qty: 2 }] });
  await confirmSalesOrder(testDb(), orderId, { companyId });
});

afterEach(() => page?.unmount());

const routes = [
  { path: "/sales", element: <SalesPage /> },
  { path: "/sales/faturas", element: <InvoicesPage /> },
  { path: "/sales/pedidos/:id", element: <SalesOrderPage /> },
];
const open = (path: string) => mountPage({ companyId: fx.companyId, role: "ceo", path, routes });
const text = () => page.container.textContent ?? "";

describe("Vendas: edição direto na tabela", () => {
  it("pedidos de venda", async () => {
    page = await open("/sales");
    await until(() => text().includes("PV-00002"), "lista de pedidos");
    await expectInlineEditing(page.container, ["sales_orders"]);
  });

  it("faturas", async () => {
    page = await open("/sales/faturas");
    await until(() => text().includes("FAT-00001"), "lista de faturas");
    await expectInlineEditing(page.container, ["invoices"]);
  });

  it("itens do pedido, editar o pedido e faturar sem diálogo", async () => {
    page = await open(`/sales/pedidos/${orderId}`);
    await until(() => text().includes("Pedido PV-00002") && text().includes("Mouse USB"), "pedido aberto");
    await expectInlineEditing(page.container, ["sales_orders"]);
    await click(buttonIn(page.container, "Faturar"));
    await until(() => Boolean(page.container.querySelector("[aria-label='Faturar pedido PV-00002']")), "painel de faturamento");
    expectNoDialog("Faturar");
    await click(buttonIn(page.container, "Editar pedido"));
    await until(() => text().includes("Editar pedido PV-00002"), "editor do pedido na página");
    expectNoDialog("Editar pedido");
    expect(page.container.querySelector("select[aria-label='Produto do item 1']")).not.toBeNull();
  });

  it("pedido novo continua na tabela depois de ver o calendário", async () => {
    page = await open("/sales");
    await until(() => text().includes("PV-00002"), "lista de pedidos");
    await addRow(tableOf(page.container, "sales_orders"));
    await editCell(tableOf(page.container, "sales_orders"), "nova", "customer_id", fx.customerId);
    await click(buttonIn(page.container, "Calendário"));
    await until(() => Boolean(page.container.querySelector("[data-calendar-view]")), "calendário dos pedidos");
    await click(buttonIn(page.container, "Lista"));
    expect(cellField(tableOf(page.container, "sales_orders"), "nova", "customer_id").value).toBe(fx.customerId);
  });
});
