// TEMPORÁRIO (dados de exemplo): compras — pedidos em rascunho, enviado, recebido e recebido em parte. Cada
// recebimento dá entrada no estoque (movimentação com custo, saldo acertado) e gera as contas a pagar em parcelas.
// Precisa de fornecedores, itens de estoque e um local; sem eles não grava nada (nem a flag).
import { getDb } from "@/lib/db/client";
import { nextSequenceNumber } from "@/lib/db/sequence";
import { lineTotal, orderTotals, splitInstallments, sumMoney } from "@/lib/money";
import { applyStockMovement, day, hasSeedFlag, insertRows, memberFor, membersByRole, selectRows, setSeedFlag, ts, type SeedRow } from "../seedUtils";

const AREA = "purchasing";

interface SupplierRow {
  id: string;
  name: string;
  terms?: string | null;
}
interface ItemRow {
  id: string;
  sku?: string | null;
  name: string;
  unit?: string | null;
  cost?: number | null;
}
interface ProductRow {
  id: string;
  inventory_item_id?: string | null;
}
interface CodeRow {
  id: string;
  code?: string | null;
}

type PurchaseStatus = "rascunho" | "enviado" | "recebido" | "recebido_parcial";

interface PurchaseSeed {
  status: PurchaseStatus;
  supplier: number;
  /** [SKU do item de estoque, quantidade pedida, quantidade recebida]; sem o SKU, usa outro item da empresa. */
  lines: [string, number, number][];
  orderDay: number;
  expectedDay: number;
  /** Recebimento: dia, número da NF do fornecedor e vencimentos das parcelas (dias a partir de hoje; a vencida já foi paga). */
  receipt?: { day: number; invoice: string; dues: number[] };
}

const PURCHASES: PurchaseSeed[] = [
  { status: "rascunho", supplier: 0, lines: [["MOUSE-USB", 20, 0], ["TEC-ABNT2", 10, 0]], orderDay: -1, expectedDay: 12 },
  { status: "enviado", supplier: 1, lines: [["AP-WIFI6", 4, 0], ["SW-GER-24", 2, 0]], orderDay: -5, expectedDay: 4 },
  { status: "recebido", supplier: 2, lines: [["SSD-NVME-1T", 4, 4], ["MEM-DDR4-16", 6, 6]], orderDay: -42, expectedDay: -35, receipt: { day: -35, invoice: "NF 004521", dues: [-5, 25] } },
  { status: "recebido_parcial", supplier: 3, lines: [["PC-CAT6-15", 50, 30], ["RJ45-100", 4, 4]], orderDay: -12, expectedDay: -4, receipt: { day: -4, invoice: "NF 118803", dues: [26] } },
];

export async function seed(companyId: string): Promise<void> {
  if (await hasSeedFlag(AREA, companyId)) return;

  const suppliers = await selectRows<SupplierRow>("suppliers", companyId);
  const items = await selectRows<ItemRow>("inventory_items", companyId);
  const locations = await selectRows<{ id: string }>("stock_locations", companyId);
  if (suppliers.length === 0 || items.length < 2 || locations.length === 0) return;

  const db = await getDb();
  const members = await membersByRole(companyId);
  const buyer = memberFor(members, "estoquista", "admin", "ceo");
  const approver = memberFor(members, "gerente", "admin", "ceo");
  const products = await selectRows<ProductRow>("products", companyId);
  const productOf = new Map(products.filter((product) => product.inventory_item_id).map((product) => [String(product.inventory_item_id), product.id]));
  const categories = await selectRows<CodeRow>("finance_categories", companyId);
  const categoryId = categories.find((category) => category.code === "3.1")?.id ?? null;
  const costCenterId = (await selectRows<{ id: string }>("cost_centers", companyId))[0]?.id ?? null;
  const location = locations[0].id;
  const itemBySku = new Map(items.filter((item) => item.sku).map((item) => [String(item.sku).toUpperCase(), item]));

  for (const [index, purchase] of PURCHASES.entries()) {
    const orderId = `dev-purchasing-po-${index + 1}`;
    const supplier = suppliers[purchase.supplier % suppliers.length];
    const lines = purchase.lines.map(([sku, qty, received], position) => {
      const item = itemBySku.get(sku) ?? items[(index * 2 + position) % items.length];
      const unitPrice = Number(item.cost ?? 0) || 10;
      return { id: `${orderId}-item-${position + 1}`, item, qty, received, unitPrice, position: position + 1 };
    });
    const totals = orderTotals(lines.map((line) => ({ qty: line.qty, unit_price: line.unitPrice })));
    const sent = purchase.status !== "rascunho";

    const existing = await db.select<unknown[]>("SELECT * FROM purchase_orders WHERE company_id=? AND id=?", [companyId, orderId]);
    if (existing.length > 0) continue;
    await insertRows("purchase_orders", companyId, [{
      id: orderId,
      number: await nextSequenceNumber(db, "purchase_orders", companyId),
      supplier_id: supplier.id,
      status: purchase.status,
      order_date: day(purchase.orderDay),
      expected_date: day(purchase.expectedDay),
      location_id: location,
      payment_terms: supplier.terms ?? "30 dias",
      installments: purchase.receipt?.dues.length ?? 1,
      ...totals,
      category_id: categoryId,
      cost_center_id: costCenterId,
      notes: purchase.status === "rascunho" ? "Conferir preço com o fornecedor antes de enviar." : null,
      approved_by: sent ? approver : null,
      approved_at: sent ? ts(purchase.orderDay, 10) : null,
      sent_at: sent ? ts(purchase.orderDay, 11) : null,
      received_at: purchase.status === "recebido" && purchase.receipt ? ts(purchase.receipt.day, 14) : null,
      created_by: buyer,
      created_at: ts(purchase.orderDay, 9),
    }]);
    await insertRows("purchase_order_items", companyId, lines.map((line) => ({
      id: line.id,
      order_id: orderId,
      product_id: productOf.get(line.item.id) ?? null,
      inventory_item_id: line.item.id,
      description: line.item.name,
      unit: line.item.unit ?? "un",
      qty: line.qty,
      unit_price: line.unitPrice,
      discount: 0,
      tax_rate: 0,
      total: lineTotal(line.qty, line.unitPrice),
      received_qty: line.received,
      position: line.position,
    })));

    if (!purchase.receipt) continue;

    // ---- Recebimento: entrada no estoque e contas a pagar ------------------------------------------------------
    const receiptId = `dev-purchasing-receipt-${index + 1}`;
    const receivedLines = lines.filter((line) => line.received > 0);
    const receiptTotal = sumMoney(receivedLines.map((line) => lineTotal(line.received, line.unitPrice)));
    await insertRows("goods_receipts", companyId, [{
      id: receiptId,
      number: await nextSequenceNumber(db, "goods_receipts", companyId),
      purchase_order_id: orderId,
      supplier_id: supplier.id,
      location_id: location,
      status: "conferido",
      received_at: ts(purchase.receipt.day, 14),
      received_by: buyer,
      supplier_invoice_number: purchase.receipt.invoice,
      total: receiptTotal,
      notes: purchase.status === "recebido_parcial" ? "Restante com previsão para a próxima semana." : null,
    }]);
    const receiptItems: SeedRow[] = [];
    for (const [position, line] of receivedLines.entries()) {
      const movementId = `${receiptId}-move-${position + 1}`;
      await applyStockMovement(companyId, {
        id: movementId,
        item_id: line.item.id,
        type: "entrada",
        quantity: line.received,
        to_location_id: location,
        unit_cost: line.unitPrice,
        ref_type: "goods_receipt",
        ref_id: receiptId,
        user_id: buyer,
        note: `Recebimento ${purchase.receipt.invoice} - ${supplier.name}`,
        created_at: ts(purchase.receipt.day, 14),
      });
      receiptItems.push({
        id: `${receiptId}-item-${position + 1}`,
        receipt_id: receiptId,
        purchase_order_item_id: line.id,
        inventory_item_id: line.item.id,
        product_id: productOf.get(line.item.id) ?? null,
        qty: line.received,
        unit_cost: line.unitPrice,
        location_id: location,
        stock_movement_id: movementId,
      });
    }
    await insertRows("goods_receipt_items", companyId, receiptItems);

    const dues = purchase.receipt.dues;
    const parts = splitInstallments(receiptTotal, dues.length);
    await insertRows("payables", companyId, dues.map((due, installment) => {
      const paid = due < 0;
      return {
        id: `${receiptId}-payable-${installment + 1}`,
        description: `${supplier.name} - ${purchase.receipt!.invoice} (${installment + 1}/${dues.length})`,
        supplier_id: supplier.id,
        amount: parts[installment],
        due_date: day(due),
        status: paid ? "paga" : "aberta",
        cost_center_id: costCenterId,
        approver_id: paid ? approver : null,
        paid_at: paid ? ts(due, 10) : null,
        paid_amount: paid ? parts[installment] : 0,
        category_id: categoryId,
        installment_number: installment + 1,
        installment_count: dues.length,
        payment_method: "boleto",
        document_number: purchase.receipt!.invoice,
        issue_date: day(purchase.receipt!.day),
        competence: day(purchase.receipt!.day).slice(0, 7),
        ref_type: "goods_receipt",
        ref_id: receiptId,
        purchase_order_id: orderId,
        goods_receipt_id: receiptId,
      };
    }));
  }

  await setSeedFlag(AREA, companyId);
}
