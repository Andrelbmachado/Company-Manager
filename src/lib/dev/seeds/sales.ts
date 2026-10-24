// TEMPORÁRIO (dados de exemplo): vendas — pedidos em rascunho, confirmado, faturado, entregue e cancelado. O faturado
// tem fatura em 3 parcelas a receber; o entregue tem fatura paga e baixa no estoque (saída com custo, saldo acertado).
// Precisa de clientes e produtos do catálogo; sem eles não grava nada (nem a flag).
import { getDb } from "@/lib/db/client";
import { formatSequence, nextSequenceNumber } from "@/lib/db/sequence";
import { lineTotal, orderTotals, splitInstallments } from "@/lib/money";
import { applyStockMovement, day, hasSeedFlag, insertRows, memberFor, membersByRole, selectAll, selectRows, setSeedFlag, ts, type SeedRow } from "../seedUtils";

const AREA = "sales";

interface CustomerRow {
  id: string;
  name: string;
}
interface ProductRow {
  id: string;
  sku?: string | null;
  name: string;
  kind?: string | null;
  unit?: string | null;
  price: number;
  cost?: number | null;
  inventory_item_id?: string | null;
}
interface CodeRow {
  id: string;
  code?: string | null;
  is_default?: number | boolean | string | null;
}
interface BalanceRow {
  id: string;
  item_id: string;
  location_id: string;
  quantity: number;
}

type SalesStatus = "rascunho" | "confirmado" | "faturado" | "entregue" | "cancelado";

interface SaleSeed {
  status: SalesStatus;
  customer: number;
  /** [SKU, quantidade, desconto do item em R$]. */
  lines: [string, number, number][];
  orderDay: number;
  discount?: number;
  shipping?: number;
  /** Fatura: vencimento de cada parcela (dias a partir de hoje) e se já foi paga. */
  invoice?: { day: number; dues: number[]; paid: boolean };
}

const SALES: SaleSeed[] = [
  { status: "confirmado", customer: 0, lines: [["SW-GER-24", 1, 0], ["SRV-PONTO", 8, 0], ["CAB-CAT6-305", 1, 0]], orderDay: -2 },
  { status: "faturado", customer: 1, lines: [["AP-WIFI6", 4, 0], ["SRV-HORA", 6, 0]], orderDay: -9, discount: 150, invoice: { day: -7, dues: [10, 40, 70], paid: false } },
  { status: "entregue", customer: 2, lines: [["SSD-NVME-1T", 2, 0], ["MOUSE-USB", 5, 15], ["SRV-VISITA", 1, 0]], orderDay: -21, shipping: 45, invoice: { day: -18, dues: [-3], paid: true } },
  { status: "rascunho", customer: 3, lines: [["MON-24FHD", 3, 0]], orderDay: 0 },
  { status: "cancelado", customer: 4, lines: [["NOB-1200", 2, 0]], orderDay: -14 },
];

const isTrue = (value: unknown) => value === 1 || value === true || value === "1" || value === "true";

export async function seed(companyId: string): Promise<void> {
  if (await hasSeedFlag(AREA, companyId)) return;

  const customers = await selectRows<CustomerRow>("customers", companyId);
  const products = await selectRows<ProductRow>("products", companyId);
  if (customers.length < 2 || products.length < 3) return;

  const db = await getDb();
  const members = await membersByRole(companyId);
  const seller = memberFor(members, "comercial", "gerente", "ceo", "admin");
  const billing = memberFor(members, "financeiro", "admin", "ceo");
  const stockUser = memberFor(members, "estoquista", "admin", "ceo");
  const bySku = new Map(products.filter((product) => product.sku).map((product) => [String(product.sku).toUpperCase(), product]));
  const categories = await selectRows<CodeRow>("finance_categories", companyId);
  const revenueCategory = categories.find((category) => category.code === "1.1")?.id ?? null;
  const accounts = await selectRows<CodeRow>("bank_accounts", companyId);
  const bankAccount = (accounts.find((account) => isTrue(account.is_default)) ?? accounts[0])?.id ?? null;
  const location = (await selectRows<{ id: string }>("stock_locations", companyId))[0]?.id ?? null;

  for (const [index, sale] of SALES.entries()) {
    const orderId = `dev-sales-order-${index + 1}`;
    const existing = await db.select<unknown[]>("SELECT * FROM sales_orders WHERE company_id=? AND id=?", [companyId, orderId]);
    if (existing.length > 0) continue;

    const lines = sale.lines.map(([sku, qty, discount], position) => {
      const product = bySku.get(sku) ?? products[(index + position) % products.length];
      return { id: `${orderId}-item-${position + 1}`, product, qty, discount, total: lineTotal(qty, product.price, discount), position: position + 1 };
    });
    const totals = orderTotals(lines.map((line) => ({ qty: line.qty, unit_price: line.product.price, discount: line.discount })), { discount: sale.discount, shipping: sale.shipping });
    const customer = customers[sale.customer % customers.length];
    const confirmed = sale.status !== "rascunho";
    const invoiced = sale.invoice != null;
    const delivered = sale.status === "entregue";
    const orderNumber = await nextSequenceNumber(db, "sales_orders", companyId);

    await insertRows("sales_orders", companyId, [{
      id: orderId,
      number: orderNumber,
      customer_id: customer.id,
      seller_id: seller,
      location_id: location,
      status: sale.status,
      order_date: day(sale.orderDay),
      delivery_date: delivered ? day(sale.orderDay + 4) : sale.status === "confirmado" ? day(5) : null,
      payment_terms: sale.invoice ? (sale.invoice.dues.length > 1 ? "30/60/90 dias" : "À vista") : "A combinar",
      installments: sale.invoice?.dues.length ?? 1,
      ...totals,
      notes: sale.status === "rascunho" ? "Aguardando o cliente confirmar a quantidade." : null,
      internal_notes: delivered ? "Entregue pelo técnico junto com a visita." : null,
      confirmed_at: confirmed ? ts(sale.orderDay, 11) : null,
      invoiced_at: sale.invoice ? ts(sale.invoice.day, 15) : null,
      delivered_at: delivered ? ts(sale.orderDay + 4, 16) : null,
      cancelled_at: sale.status === "cancelado" ? ts(sale.orderDay + 2, 9) : null,
      cancel_reason: sale.status === "cancelado" ? "Cliente adiou a compra para o próximo trimestre." : null,
      created_by: seller,
      created_at: ts(sale.orderDay, 10),
    }]);
    await insertRows("sales_order_items", companyId, lines.map((line) => ({
      id: line.id,
      order_id: orderId,
      product_id: line.product.id,
      description: line.product.name,
      unit: line.product.unit ?? "un",
      qty: line.qty,
      unit_price: line.product.price,
      discount: line.discount,
      tax_rate: 0,
      total: line.total,
      delivered_qty: delivered ? line.qty : 0,
      invoiced_qty: invoiced ? line.qty : 0,
      position: line.position,
    })));

    // ---- Saída do estoque do pedido entregue (só produtos ligados a item de estoque com saldo) ------------------
    if (delivered) {
      const balances = await selectAll<BalanceRow>("stock_balances", companyId);
      for (const line of lines) {
        const itemId = line.product.kind === "servico" ? null : line.product.inventory_item_id;
        if (!itemId) continue;
        const from = balances.filter((row) => row.item_id === itemId && Number(row.quantity) >= line.qty).sort((a, b) => Number(b.quantity) - Number(a.quantity))[0];
        if (!from) continue;
        await applyStockMovement(companyId, {
          id: `${orderId}-move-${line.position}`,
          item_id: itemId,
          type: "saida",
          quantity: line.qty,
          from_location_id: from.location_id,
          unit_cost: Number(line.product.cost ?? 0),
          ref_type: "sales_order",
          ref_id: orderId,
          user_id: stockUser,
          note: `Entrega do pedido ${formatSequence("sales_orders", orderNumber)} - ${customer.name}`,
          created_at: ts(sale.orderDay + 4, 16),
        });
      }
    }

    if (!sale.invoice) continue;

    // ---- Fatura, itens e parcelas em contas a receber ------------------------------------------------------------
    const invoiceId = `dev-sales-invoice-${index + 1}`;
    const invoiceNumber = await nextSequenceNumber(db, "invoices", companyId);
    const invoiceLabel = formatSequence("invoices", invoiceNumber);
    const { dues, paid } = sale.invoice;
    await insertRows("invoices", companyId, [{
      id: invoiceId,
      number: invoiceNumber,
      sales_order_id: orderId,
      customer_id: customer.id,
      status: paid ? "paga" : "emitida",
      issue_date: day(sale.invoice.day),
      due_date: day(dues[dues.length - 1]),
      installments: dues.length,
      payment_terms: dues.length > 1 ? "30/60/90 dias" : "À vista",
      payment_method: dues.length > 1 ? "boleto" : "pix",
      ...totals,
      paid_amount: paid ? totals.total : 0,
      category_id: revenueCategory,
      bank_account_id: bankAccount,
      notes: null,
      created_by: billing,
      created_at: ts(sale.invoice.day, 15),
    }]);
    await insertRows("invoice_items", companyId, lines.map((line) => ({
      id: `${invoiceId}-item-${line.position}`,
      invoice_id: invoiceId,
      sales_order_item_id: line.id,
      product_id: line.product.id,
      description: line.product.name,
      unit: line.product.unit ?? "un",
      qty: line.qty,
      unit_price: line.product.price,
      discount: line.discount,
      tax_rate: 0,
      total: line.total,
      position: line.position,
    })));
    const parts = splitInstallments(totals.total, dues.length);
    const receivables: SeedRow[] = dues.map((due, installment) => ({
      id: `${invoiceId}-receivable-${installment + 1}`,
      customer_id: customer.id,
      ref_type: "invoice",
      ref_id: invoiceId,
      description: `${invoiceLabel} - ${customer.name} (${installment + 1}/${dues.length})`,
      amount: parts[installment],
      due_date: day(due),
      status: paid ? "recebida" : "aberta",
      received_at: paid ? ts(due, 11) : null,
      received_amount: paid ? parts[installment] : 0,
      category_id: revenueCategory,
      bank_account_id: bankAccount,
      installment_number: installment + 1,
      installment_count: dues.length,
      payment_method: dues.length > 1 ? "boleto" : "pix",
      document_number: invoiceLabel,
      issue_date: day(sale.invoice!.day),
      competence: day(sale.invoice!.day).slice(0, 7),
      invoice_id: invoiceId,
      sales_order_id: orderId,
    }));
    await insertRows("receivables", companyId, receivables);
  }

  await setSeedFlag(AREA, companyId);
}
