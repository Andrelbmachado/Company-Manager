// Faturas pela tela: status derivado das parcelas na lista, detalhe com parcelas e cancelamento com motivo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { confirmSalesOrder, createSalesOrder, invoiceSalesOrder } from "@/lib/erp/orders";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import { buttonIn, click, dialog, field, mountPage, typeInto, until, type Mounted } from "@/modules/catalog/testHarness";
import type { Invoice, Receivable, SalesOrder } from "@/types";
import InvoicePage from "./InvoicePage";
import InvoicesPage from "./InvoicesPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
let fx: TradeFixture;
let page: Mounted;
let invoiceId: string;
let orderId: string;

beforeEach(async () => {
  const { companyId } = await insertTestCompany(testDb(), { roles: ["financeiro", "comercial"] });
  fx = await seedTradeFixture(testDb(), companyId, "test-user-financeiro");
  orderId = await createSalesOrder(testDb(), { companyId, customerId: fx.customerId, items: [{ productId: fx.products.visita, qty: 2 }] });
  await confirmSalesOrder(testDb(), orderId, { companyId });
  ({ invoiceId } = await invoiceSalesOrder(testDb(), orderId, { companyId, installments: 2, issueDate: "2020-01-10" }));
});

afterEach(() => page?.unmount());

const text = () => page.container.textContent ?? "";
const routes = [
  { path: "/sales/faturas", element: <InvoicesPage /> },
  { path: "/sales/faturas/:id", element: <InvoicePage /> },
];

describe("Faturas", () => {
  it("lista com status pelas parcelas (vencida) e abre o detalhe", async () => {
    page = await mountPage({ companyId: fx.companyId, role: "comercial", path: "/sales/faturas", routes });
    await until(() => text().includes("FAT-00001"), "lista de faturas");
    expect(text()).toContain("Vencida");
    expect(text()).toContain("PV-00001");
    await click([...page.container.querySelectorAll("tr")].find((row) => row.textContent?.includes("FAT-00001")));
    await until(() => page.path() === `/sales/faturas/${invoiceId}` && text().includes("Parcelas (contas a receber)") && text().includes("2/2"), "detalhe da fatura");
    expect(buttonIn(page.container, "Cancelar fatura")).toBeUndefined();
  });

  it("financeiro cancela com motivo e o pedido pode ser faturado de novo", async () => {
    page = await mountPage({ companyId: fx.companyId, role: "financeiro", path: `/sales/faturas/${invoiceId}`, routes });
    await until(() => Boolean(buttonIn(page.container, "Cancelar fatura")), "detalhe");
    await click(buttonIn(page.container, "Cancelar fatura"));
    const form = dialog("Cancelar fatura FAT-00001?");
    await typeInto(field(form, "Motivo"), "Emitida com o valor errado");
    await click(buttonIn(form, "Cancelar fatura"));
    await until(async () => (await testDb().select<Invoice[]>("SELECT * FROM invoices WHERE id = ?", [invoiceId]))[0].status === "cancelada", "fatura cancelada");
    const parcels = await testDb().select<Receivable[]>("SELECT * FROM receivables WHERE invoice_id = ?", [invoiceId]);
    expect(parcels.map((row) => row.status)).toEqual(["cancelada", "cancelada"]);
    expect((await testDb().select<SalesOrder[]>("SELECT * FROM sales_orders WHERE id = ?", [orderId]))[0]).toMatchObject({ status: "confirmado", invoiced_at: null });
    await until(() => text().includes("Cancelada"), "status na tela");
  });

  it("'nova' explica que fatura nasce do pedido", async () => {
    page = await mountPage({ companyId: fx.companyId, role: "financeiro", path: "/sales/faturas/nova", routes });
    await until(() => text().includes("Faturas nascem dos pedidos de venda"), "explicação");
  });
});
