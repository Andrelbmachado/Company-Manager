import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Receipt } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useRequiredSession } from "@/hooks/useSession";
import { formatSequence } from "@/lib/db/sequence";
import { invoiceDisplayStatus, isActiveReceivable, isReceivableOverdue, receivedOf } from "@/lib/erp/orders";
import { sumMoney } from "@/lib/money";
import { formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { INPUT, LoadingRows, TD, TH, byId, useCustomers, useInvoices, useReceivables, useSalesOrders } from "@/modules/catalog/components/tradeKit";
import type { InvoiceStatus, Receivable } from "@/types";

const FILTERS: Array<{ value: "abertas" | "todas" | InvoiceStatus; label: string }> = [
  { value: "abertas", label: "A receber" },
  { value: "todas", label: "Todas" },
  { value: "emitida", label: "Emitidas" },
  { value: "vencida", label: "Vencidas" },
  { value: "paga_parcial", label: "Pagas em parte" },
  { value: "paga", label: "Pagas" },
  { value: "cancelada", label: "Canceladas" },
];

const OPEN = new Set<InvoiceStatus>(["emitida", "vencida", "paga_parcial"]);

export default function InvoicesPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const navigate = useNavigate();
  const today = todayIso();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("abertas");
  const { data: invoices = [], isLoading } = useInvoices(companyId);
  const { data: receivables = [] } = useReceivables(companyId);
  const { data: customers = [] } = useCustomers(companyId);
  const { data: orders = [] } = useSalesOrders(companyId);
  const customersById = useMemo(() => byId(customers), [customers]);
  const ordersById = useMemo(() => byId(orders), [orders]);

  const rows = useMemo(() => {
    const byInvoice = new Map<string, Receivable[]>();
    for (const receivable of receivables) {
      if (!receivable.invoice_id) continue;
      byInvoice.set(receivable.invoice_id, [...(byInvoice.get(receivable.invoice_id) ?? []), receivable]);
    }
    return invoices.map((invoice) => {
      const parcels = (byInvoice.get(invoice.id) ?? []).filter(isActiveReceivable);
      const received = sumMoney(parcels.map(receivedOf));
      const nextDue = parcels.filter((parcel) => parcel.status !== "recebida" && receivedOf(parcel) < Number(parcel.amount)).map((parcel) => parcel.due_date ?? "").filter(Boolean).sort()[0] ?? null;
      return { invoice, status: invoiceDisplayStatus(invoice, parcels, today), received, open: Math.max(0, sumMoney([Number(invoice.total), -received])), nextDue, overdue: parcels.filter((parcel) => isReceivableOverdue(parcel, today)) };
    });
  }, [invoices, receivables, today]);

  const filtered = rows.filter((row) => {
    if (filter === "abertas" ? !OPEN.has(row.status) : filter !== "todas" && row.status !== filter) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    const customer = row.invoice.customer_id ? customersById.get(row.invoice.customer_id)?.name ?? "" : "";
    const order = row.invoice.sales_order_id ? ordersById.get(row.invoice.sales_order_id) : undefined;
    return [formatSequence("invoices", row.invoice.number), customer, order ? formatSequence("sales_orders", order.number) : "", row.invoice.fiscal_number ?? ""].some((value) => value.toLowerCase().includes(term));
  });

  const live = rows.filter((row) => row.status !== "cancelada");
  const openRows = live.filter((row) => OPEN.has(row.status));
  const overdue = live.flatMap((row) => row.overdue);
  const month = today.slice(0, 7);
  const issuedThisMonth = live.filter((row) => row.invoice.issue_date?.slice(0, 7) === month);

  return (
    <div className="space-y-5">
      <PageHeader title="Faturas" description="Faturas emitidas a partir dos pedidos de venda. As parcelas ficam em contas a receber; a baixa é feita no Financeiro." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="A receber" value={formatCurrency(sumMoney(openRows.map((row) => row.open)))} hint={`${openRows.length} fatura(s) em aberto`} />
        <StatCard title="Vencido" value={formatCurrency(sumMoney(overdue.flatMap((parcel) => [Number(parcel.amount), -receivedOf(parcel)])))} hint={`${overdue.length} parcela(s) vencida(s)`} />
        <StatCard title="Faturado no mês" value={formatCurrency(sumMoney(issuedThisMonth.map((row) => Number(row.invoice.total))))} hint={`${issuedThisMonth.length} fatura(s)`} />
      </div>

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por fatura, pedido ou cliente...">
        <select aria-label="Filtrar por status" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className={`${INPUT} w-44`}>
          {FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </PageToolbar>

      {isLoading ? <LoadingRows /> : filtered.length === 0 ? (
        <EmptyState icon={Receipt} title={invoices.length ? "Nenhuma fatura neste filtro" : "Nenhuma fatura emitida"} description={invoices.length ? "Mude o status ou a busca." : "Faturas nascem dos pedidos de venda confirmados (botão Faturar no pedido)."} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className={TH}>Fatura</th>
                <th className={TH}>Cliente</th>
                <th className={TH}>Pedido</th>
                <th className={TH}>Emissão</th>
                <th className={TH}>Próx. vencimento</th>
                <th className={TH}>Status</th>
                <th className={`${TH} text-right`}>Total</th>
                <th className={`${TH} text-right`}>Em aberto</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(({ invoice, status, open, nextDue }) => {
                const order = invoice.sales_order_id ? ordersById.get(invoice.sales_order_id) : undefined;
                return (
                  <tr key={invoice.id} className="cursor-pointer transition-colors hover:bg-muted/20" onClick={() => navigate(`/sales/faturas/${invoice.id}`)}>
                    <td className={TD}>
                      <button type="button" className="font-medium hover:underline" onClick={(event) => { event.stopPropagation(); navigate(`/sales/faturas/${invoice.id}`); }}>{formatSequence("invoices", invoice.number)}</button>
                    </td>
                    <td className={TD}>{invoice.customer_id ? customersById.get(invoice.customer_id)?.name ?? "Cliente removido" : "—"}</td>
                    <td className={`${TD} text-muted-foreground`}>{order ? formatSequence("sales_orders", order.number) : "—"}</td>
                    <td className={`${TD} text-muted-foreground`}>{formatDay(invoice.issue_date)}</td>
                    <td className={`${TD} ${status === "vencida" ? "text-destructive" : "text-muted-foreground"}`}>{status === "cancelada" || status === "paga" ? "—" : formatDay(nextDue)}</td>
                    <td className={TD}><StatusBadge status={status} /></td>
                    <td className={`${TD} text-right tabular-nums`}>{formatCurrency(Number(invoice.total))}</td>
                    <td className={`${TD} text-right font-medium tabular-nums`}>{status === "cancelada" ? "—" : formatCurrency(open)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
