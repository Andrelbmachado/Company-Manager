// Relatório de vendas: pedidos confirmados, faturados e entregues no período (data do pedido), por período, cliente,
// vendedor e produto. Rascunho e cancelado não são venda; pedido excluído não entra.
import type { DatabaseLike } from "@/lib/db/demo";
import { roundMoney, sumMoney } from "@/lib/money";
import { addDays, dayLabel, daysBetween, localDayOf, monthLabel, monthOf, monthsBetween, num, periodLabel, sharePercent, text, type DbRow, type ReportColumn, type ReportTable } from "./common";

export const SOLD_STATUSES = ["confirmado", "faturado", "entregue"] as const;

export type SalesGranularity = "dia" | "mes";
export type SalesView = "periodo" | "cliente" | "vendedor" | "produto";

export interface SalesData {
  orders: DbRow[];
  items: DbRow[];
  customers: Map<string, string>;
  products: Map<string, string>;
  users: Map<string, string>;
}

export interface SalesPeriodRow {
  key: string;
  label: string;
  orders: number;
  total: number;
}

export interface SalesGroupRow {
  key: string;
  label: string;
  orders: number;
  total: number;
  share: number;
}

export interface SalesProductRow extends SalesGroupRow {
  quantity: number;
}

export interface SalesReport {
  from: string;
  to: string;
  granularity: SalesGranularity;
  orders: number;
  total: number;
  averageTicket: number;
  byPeriod: SalesPeriodRow[];
  byCustomer: SalesGroupRow[];
  bySeller: SalesGroupRow[];
  byProduct: SalesProductRow[];
  /** Soma dos itens (sem frete e desconto do pedido): base da participação por produto. */
  itemsTotal: number;
}

function names(rows: DbRow[]): Map<string, string> {
  return new Map(rows.map((row) => [String(row.id), String(row.name ?? "")]));
}

export async function loadSalesData(db: DatabaseLike, companyId: string): Promise<SalesData> {
  const [orders, items, customers, products, users] = await Promise.all([
    db.select<DbRow[]>("SELECT * FROM sales_orders WHERE company_id=? AND deleted_at IS NULL", [companyId]),
    db.select<DbRow[]>("SELECT * FROM sales_order_items WHERE company_id=? AND deleted_at IS NULL", [companyId]),
    // Clientes e produtos excluídos continuam com nome nas vendas antigas.
    db.select<DbRow[]>("SELECT * FROM customers WHERE company_id=?", [companyId]),
    db.select<DbRow[]>("SELECT * FROM products WHERE company_id=?", [companyId]),
    db.select<DbRow[]>("SELECT id, name FROM users"),
  ]);
  return { orders, items, customers: names(customers), products: names(products), users: names(users) };
}

/** Até ~2 meses, série diária; acima, mensal. */
export function defaultGranularity(from: string, to: string): SalesGranularity {
  return daysBetween(from, to) <= 62 ? "dia" : "mes";
}

interface Bucket {
  key: string;
  label: string;
  orders: Set<string>;
  values: number[];
  quantity: number;
}

function grouped<T extends string>(entries: { key: string; label: string; order: string; value: number; quantity?: number }[], keys?: readonly T[]): Map<string, Bucket> {
  const map = new Map<string, Bucket>();
  for (const key of keys ?? []) map.set(key, { key, label: key, orders: new Set(), values: [], quantity: 0 });
  for (const entry of entries) {
    const bucket = map.get(entry.key) ?? { key: entry.key, label: entry.label, orders: new Set<string>(), values: [], quantity: 0 };
    bucket.label = entry.label;
    bucket.orders.add(entry.order);
    bucket.values.push(entry.value);
    bucket.quantity += entry.quantity ?? 0;
    map.set(entry.key, bucket);
  }
  return map;
}

function ranked(map: Map<string, Bucket>, total: number): SalesGroupRow[] {
  return [...map.values()]
    .map((bucket) => {
      const value = sumMoney(bucket.values);
      return { key: bucket.key, label: bucket.label, orders: bucket.orders.size, total: value, share: sharePercent(value, total) };
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "pt-BR"));
}

export function buildSalesReport(data: SalesData, options: { from: string; to: string; granularity?: SalesGranularity }): SalesReport {
  const { from, to } = options;
  const granularity = options.granularity ?? defaultGranularity(from, to);
  const sold = new Set<string>(SOLD_STATUSES);
  const orders = data.orders
    .map((order) => ({ order, day: localDayOf(text(order.order_date)) ?? localDayOf(text(order.created_at)) }))
    .filter((entry): entry is { order: DbRow; day: string } => entry.day !== null && entry.day >= from && entry.day <= to && sold.has(String(entry.order.status)));
  const total = sumMoney(orders.map(({ order }) => num(order.total)));

  const periodKeys: string[] = [];
  if (granularity === "dia") for (let day = from; day <= to && periodKeys.length < 3700; day = addDays(day, 1)) periodKeys.push(day);
  else periodKeys.push(...monthsBetween(monthOf(from), monthOf(to)));
  const periods = grouped(
    orders.map(({ order, day }) => ({ key: granularity === "dia" ? day : monthOf(day), label: "", order: String(order.id), value: num(order.total) })),
    periodKeys,
  );
  const byPeriod = periodKeys.map((key) => {
    const bucket = periods.get(key)!;
    return { key, label: granularity === "dia" ? dayLabel(key).slice(0, 5) : monthLabel(key), orders: bucket.orders.size, total: sumMoney(bucket.values) };
  });

  const party = (id: string | null, map: Map<string, string>, none: string, missing: string) => (id ? { key: id, label: map.get(id) || missing } : { key: "none", label: none });
  const byCustomer = ranked(
    grouped(orders.map(({ order }) => ({ ...party(text(order.customer_id), data.customers, "Sem cliente", "Cliente removido"), order: String(order.id), value: num(order.total) }))),
    total,
  );
  const bySeller = ranked(
    grouped(orders.map(({ order }) => ({ ...party(text(order.seller_id), data.users, "Sem vendedor", "Usuário removido"), order: String(order.id), value: num(order.total) }))),
    total,
  );

  const counted = new Set(orders.map(({ order }) => String(order.id)));
  const items = data.items.filter((item) => counted.has(String(item.order_id)));
  const itemsTotal = sumMoney(items.map((item) => num(item.total)));
  const productBuckets = grouped(
    items.map((item) => {
      const productId = text(item.product_id);
      const description = text(item.description) ?? "Item sem descrição";
      return {
        key: productId ?? `item:${description.toLocaleLowerCase("pt-BR")}`,
        label: (productId && data.products.get(productId)) || description,
        order: String(item.order_id),
        value: num(item.total),
        quantity: num(item.qty),
      };
    }),
  );
  const byProduct = ranked(productBuckets, itemsTotal).map((row) => ({ ...row, quantity: Math.round(productBuckets.get(row.key)!.quantity * 1000) / 1000 }));

  return {
    from,
    to,
    granularity,
    orders: orders.length,
    total,
    averageTicket: orders.length ? roundMoney(total / orders.length) : 0,
    byPeriod,
    byCustomer,
    bySeller,
    byProduct,
    itemsTotal,
  };
}

const VIEW_TITLES: Record<SalesView, string> = {
  periodo: "Vendas por período",
  cliente: "Vendas por cliente",
  vendedor: "Vendas por vendedor",
  produto: "Vendas por produto",
};

const ORDERS: ReportColumn = { key: "orders", label: "Pedidos", kind: "integer" };
const TOTAL: ReportColumn = { key: "total", label: "Total (R$)", kind: "money" };
const SHARE: ReportColumn = { key: "share", label: "Participação (%)", kind: "percent" };

/** Tabela de uma visão do relatório, pronta para a tela e a exportação. */
export function salesTable(report: SalesReport, view: SalesView): ReportTable {
  const base = {
    title: VIEW_TITLES[view],
    subtitle: `${periodLabel(report.from, report.to)} · pedidos confirmados, faturados e entregues`,
    fileName: `relatorio-vendas-por-${view}-${report.from}-a-${report.to}`,
  };
  if (view === "periodo") {
    return {
      ...base,
      columns: [{ key: "label", label: report.granularity === "dia" ? "Dia" : "Mês", kind: "text" }, ORDERS, TOTAL, { key: "averageTicket", label: "Ticket médio (R$)", kind: "money" }],
      rows: report.byPeriod.map((row) => ({ label: row.label, orders: row.orders, total: row.total, averageTicket: row.orders ? roundMoney(row.total / row.orders) : 0 })),
      totals: { label: "Total", orders: report.orders, total: report.total, averageTicket: report.averageTicket },
    };
  }
  if (view === "produto") {
    return {
      ...base,
      columns: [{ key: "label", label: "Produto", kind: "text" }, ORDERS, { key: "quantity", label: "Quantidade", kind: "number" }, TOTAL, SHARE],
      rows: report.byProduct.map((row) => ({ label: row.label, orders: row.orders, quantity: row.quantity, total: row.total, share: row.share })),
      totals: { label: "Total", orders: report.orders, total: report.itemsTotal, share: report.itemsTotal ? 100 : 0 },
    };
  }
  const rows = view === "cliente" ? report.byCustomer : report.bySeller;
  return {
    ...base,
    columns: [{ key: "label", label: view === "cliente" ? "Cliente" : "Vendedor", kind: "text" }, ORDERS, TOTAL, SHARE],
    rows: rows.map((row) => ({ label: row.label, orders: row.orders, total: row.total, share: row.share })),
    totals: { label: "Total", orders: report.orders, total: report.total, share: report.total ? 100 : 0 },
  };
}
