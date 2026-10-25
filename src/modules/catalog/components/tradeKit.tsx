// Peças comuns das telas de Catálogo, Vendas e Compras: classes de formulário, mensagem de erro, consultas de apoio
// (produtos, clientes, fornecedores, locais, tabelas de preço) e a invalidação depois de gravar.
// Consultas só com SELECT * ... WHERE company_id=? (padrão do banco demo); junções e somas ficam no TypeScript.
import type { ReactNode } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { errorMessage, toNumber } from "@/lib/erp/tradeDb";
import { cn } from "@/lib/utils";
import type { Customer, GoodsReceipt, InventoryItem, Invoice, Payable, PriceList, PriceListItem, Product, PurchaseOrder, Receivable, SalesOrder, StockBalance, StockLocation, Supplier } from "@/types";

export const INPUT = "flex h-9 w-full rounded-md border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
export const BUTTON = "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
export const PRIMARY = "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
export const DANGER = "inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50";
export const TH = "px-4 py-3 text-left font-medium text-muted-foreground";
export const TD = "px-4 py-3";

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("space-y-1.5 text-sm font-medium", className)}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  return <p role="alert" className={cn("text-sm text-destructive", className)}>{errorMessage(error)}</p>;
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function LoadingRows() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-lg bg-muted/30" />)}
    </div>
  );
}

/** Número digitado (aceita vírgula); vazio ou inválido vira `fallback`. */
export function num(value: string | number | null | undefined, fallback = 0): number {
  const parsed = toNumber(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

export const PAYMENT_METHODS = [
  { value: "boleto", label: "Boleto" },
  { value: "pix", label: "Pix" },
  { value: "transferencia", label: "Transferência" },
  { value: "cartao_credito", label: "Cartão de crédito" },
  { value: "cartao_debito", label: "Cartão de débito" },
  { value: "dinheiro", label: "Dinheiro" },
] as const;

export function paymentMethodLabel(value: string | null | undefined): string {
  return PAYMENT_METHODS.find((method) => method.value === value)?.label ?? value ?? "—";
}

async function companyRows<T>(sql: string, companyId: string): Promise<T[]> {
  return (await getDb()).select<T[]>(sql, [companyId]);
}

export function useProducts(companyId: string) {
  return useQuery({ queryKey: ["products", companyId], queryFn: () => companyRows<Product>("SELECT * FROM products WHERE company_id=? AND deleted_at IS NULL ORDER BY name", companyId) });
}

/** Produtos inclusive os excluídos do catálogo, para ler documentos já gravados que ainda apontam para eles. */
export function useProductsWithDeleted(companyId: string) {
  return useQuery({ queryKey: ["products", companyId, "com-excluidos"], queryFn: () => companyRows<Product>("SELECT * FROM products WHERE company_id=? ORDER BY name", companyId) });
}

export function useCustomers(companyId: string) {
  return useQuery({ queryKey: ["customers", companyId, "trade"], queryFn: () => companyRows<Customer>("SELECT * FROM customers WHERE company_id=? AND deleted_at IS NULL ORDER BY name", companyId) });
}

export function useSuppliers(companyId: string) {
  return useQuery({ queryKey: ["suppliers", companyId], queryFn: () => companyRows<Supplier>("SELECT * FROM suppliers WHERE company_id=? AND deleted_at IS NULL ORDER BY name", companyId) });
}

export function useLocations(companyId: string) {
  return useQuery({ queryKey: ["stock-locations", companyId], queryFn: () => companyRows<StockLocation>("SELECT * FROM stock_locations WHERE company_id=? AND deleted_at IS NULL ORDER BY name", companyId) });
}

export function useInventoryItems(companyId: string) {
  return useQuery({ queryKey: ["inventory", companyId, "trade-items"], queryFn: () => companyRows<InventoryItem>("SELECT * FROM inventory_items WHERE company_id=? AND deleted_at IS NULL ORDER BY name", companyId) });
}

export function useStockBalances(companyId: string) {
  return useQuery({ queryKey: ["stock-balances", companyId], queryFn: () => companyRows<StockBalance>("SELECT * FROM stock_balances WHERE company_id=?", companyId) });
}

export function usePriceLists(companyId: string) {
  return useQuery({ queryKey: ["price-lists", companyId], queryFn: () => companyRows<PriceList>("SELECT * FROM price_lists WHERE company_id=? AND deleted_at IS NULL ORDER BY name", companyId) });
}

export function usePriceListItems(companyId: string) {
  return useQuery({ queryKey: ["price-list-items", companyId], queryFn: () => companyRows<PriceListItem>("SELECT * FROM price_list_items WHERE company_id=? AND deleted_at IS NULL", companyId) });
}

// Mesma chave e mesmo formato da tela do Financeiro (FinancePage): o cache é compartilhado.
export function useReceivables(companyId: string, enabled = true) {
  return useQuery({ queryKey: ["receivables", companyId], enabled, queryFn: () => companyRows<Receivable>("SELECT * FROM receivables WHERE company_id=? AND deleted_at IS NULL ORDER BY due_date ASC", companyId) });
}

export function usePayables(companyId: string, enabled = true) {
  return useQuery({ queryKey: ["payables", companyId], enabled, queryFn: () => companyRows<Payable>("SELECT * FROM payables WHERE company_id=? AND deleted_at IS NULL ORDER BY due_date ASC", companyId) });
}

export function useSalesOrders(companyId: string, enabled = true) {
  return useQuery({ queryKey: ["sales_orders", companyId], enabled, queryFn: () => companyRows<SalesOrder>("SELECT * FROM sales_orders WHERE company_id=? AND deleted_at IS NULL ORDER BY number DESC", companyId) });
}

export function useInvoices(companyId: string, enabled = true) {
  return useQuery({ queryKey: ["invoices", companyId], enabled, queryFn: () => companyRows<Invoice>("SELECT * FROM invoices WHERE company_id=? AND deleted_at IS NULL ORDER BY number DESC", companyId) });
}

export function usePurchaseOrders(companyId: string, enabled = true) {
  return useQuery({ queryKey: ["purchase_orders", companyId], enabled, queryFn: () => companyRows<PurchaseOrder>("SELECT * FROM purchase_orders WHERE company_id=? AND deleted_at IS NULL ORDER BY number DESC", companyId) });
}

export function useGoodsReceipts(companyId: string, enabled = true) {
  return useQuery({ queryKey: ["goods_receipts", companyId], enabled, queryFn: () => companyRows<GoodsReceipt>("SELECT * FROM goods_receipts WHERE company_id=? AND deleted_at IS NULL ORDER BY number DESC", companyId) });
}

const TRADE_QUERY_ROOTS = [
  "products",
  "price-lists",
  "price-list-items",
  "sales_orders",
  "invoices",
  "purchase_orders",
  "goods_receipts",
  "receivables",
  "payables",
  "stock-balances",
  "stock-movements",
  "inventory",
  "suppliers",
  "customers",
  "dashboard-kpis",
] as const;

/** Depois de gravar: pedidos, faturas, estoque e contas mudam juntos, então tudo do comércio é recarregado. */
export function invalidateTrade(qc: QueryClient): void {
  for (const root of TRADE_QUERY_ROOTS) void qc.invalidateQueries({ queryKey: [root] });
}
