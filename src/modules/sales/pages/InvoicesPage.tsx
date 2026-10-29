// Faturas numa tabela editável: Adicionar fatura um pedido confirmado (emissão, parcelas, forma de pagamento, nota
// fiscal); na fatura emitida mudam só nota fiscal e forma de pagamento (o resto se refaz cancelando a fatura).
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge, statusLabel } from "@/components/shared/StatusBadge";
import { useRequiredSession } from "@/hooks/useSession";
import { saveInvoiceRows } from "@/lib/commercial/salesEdits";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { invoiceDisplayStatus, isActiveReceivable, isReceivableOverdue, receivedOf } from "@/lib/erp/orders";
import { emit } from "@/lib/events/bus";
import { sumMoney } from "@/lib/money";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { ROW_ACTION, refreshTrade, useEditActor } from "@/modules/catalog/components/inline";
import { INPUT, PAYMENT_METHODS, byId, invalidateTrade, paymentMethodLabel, useCustomers, useInvoices, useReceivables, useSalesOrders } from "@/modules/catalog/components/tradeKit";
import type { Invoice, InvoiceStatus, Receivable } from "@/types";

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

type InvoiceRow = Invoice & { display: InvoiceStatus; received: number; open_amount: number; next_due: string | null; overdue: Receivable[] };

export default function InvoicesPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const actor = useEditActor();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const today = todayIso();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("abertas");
  const { data: invoices = [], isLoading } = useInvoices(companyId);
  const { data: receivables = [] } = useReceivables(companyId);
  const { data: customers = [] } = useCustomers(companyId);
  const { data: orders = [] } = useSalesOrders(companyId);
  const customersById = useMemo(() => byId(customers), [customers]);
  const ordersById = useMemo(() => byId(orders), [orders]);

  const rows = useMemo<InvoiceRow[]>(() => {
    const byInvoice = new Map<string, Receivable[]>();
    for (const receivable of receivables) {
      if (!receivable.invoice_id) continue;
      byInvoice.set(receivable.invoice_id, [...(byInvoice.get(receivable.invoice_id) ?? []), receivable]);
    }
    return invoices.map((invoice) => {
      const parcels = (byInvoice.get(invoice.id) ?? []).filter(isActiveReceivable);
      const received = sumMoney(parcels.map(receivedOf));
      const nextDue = parcels.filter((parcel) => parcel.status !== "recebida" && receivedOf(parcel) < Number(parcel.amount)).map((parcel) => parcel.due_date ?? "").filter(Boolean).sort()[0] ?? null;
      return { ...invoice, display: invoiceDisplayStatus(invoice, parcels, today), received, open_amount: Math.max(0, sumMoney([Number(invoice.total), -received])), next_due: nextDue, overdue: parcels.filter((parcel) => isReceivableOverdue(parcel, today)) };
    });
  }, [invoices, receivables, today]);

  const filtered = rows.filter((row) => {
    if (filter === "abertas" ? !OPEN.has(row.display) : filter !== "todas" && row.display !== filter) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    const customer = row.customer_id ? customersById.get(row.customer_id)?.name ?? "" : "";
    const order = row.sales_order_id ? ordersById.get(row.sales_order_id) : undefined;
    return [formatSequence("invoices", row.number), customer, order ? formatSequence("sales_orders", order.number) : "", row.fiscal_number ?? ""].some((value) => value.toLowerCase().includes(term));
  });

  const live = rows.filter((row) => row.display !== "cancelada");
  const openRows = live.filter((row) => OPEN.has(row.display));
  const overdue = live.flatMap((row) => row.overdue);
  const month = today.slice(0, 7);
  const issuedThisMonth = live.filter((row) => row.issue_date?.slice(0, 7) === month);

  const orderLabel = (orderId: string | null | undefined) => {
    const order = orderId ? ordersById.get(orderId) : undefined;
    return order ? formatSequence("sales_orders", order.number) : "—";
  };
  const invoiceable = (status: string, invoicedAt: string | null | undefined) => (status === "confirmado" || status === "entregue") && !invoicedAt;
  const columns: EditableColumn<InvoiceRow>[] = [
    {
      key: "number",
      header: "Fatura",
      kind: "number",
      readOnly: true,
      render: (row) => (
        <button type="button" className="font-medium hover:underline" onClick={() => navigate(`/sales/faturas/${row.id}`)}>
          {formatSequence("invoices", row.number)}
        </button>
      ),
    },
    {
      key: "sales_order_id",
      header: "Pedido",
      kind: "select",
      required: true,
      width: 220,
      options: orders
        .filter((order) => order.status !== "cancelado")
        .map((order) => ({
          value: order.id,
          label: `${formatSequence("sales_orders", order.number)} · ${order.customer_id ? customersById.get(order.customer_id)?.name ?? "" : ""} · ${formatCurrency(Number(order.total))}${invoiceable(order.status, order.invoiced_at) ? "" : order.status === "rascunho" ? " (rascunho)" : " (já faturado)"}`,
        })),
      render: (row) => <span className="text-muted-foreground">{orderLabel(row.sales_order_id)}</span>,
    },
    { key: "customer_id", header: "Cliente", kind: "text", readOnly: true, sortValue: (row) => (row.customer_id ? customersById.get(row.customer_id)?.name ?? "Cliente removido" : null), render: (row) => (row.customer_id ? customersById.get(row.customer_id)?.name ?? "Cliente removido" : "—") },
    { key: "issue_date", header: "Emissão", kind: "date" },
    { key: "installments", header: "Parcelas", kind: "number", width: 80, placeholder: "do pedido" },
    { key: "payment_method", header: "Forma de pagamento", kind: "select", options: PAYMENT_METHODS.map((method) => ({ value: method.value, label: method.label })), render: (row) => paymentMethodLabel(row.payment_method) },
    { key: "fiscal_number", header: "Nota fiscal", kind: "text", width: 110 },
    { key: "next_due", header: "Próx. vencimento", kind: "date", readOnly: true, render: (row) => <span className={row.display === "vencida" ? "text-destructive" : "text-muted-foreground"}>{row.display === "cancelada" || row.display === "paga" ? "—" : formatDay(row.next_due)}</span> },
    { key: "display", header: "Status", kind: "select", readOnly: true, sortValue: (row) => statusLabel(row.display), render: (row) => <StatusBadge status={row.display} /> },
    { key: "total", header: "Total", kind: "money", readOnly: true, render: (row) => <span className="tabular-nums">{formatCurrency(Number(row.total))}</span> },
    { key: "open_amount", header: "Em aberto", kind: "money", readOnly: true, render: (row) => <span className={cn("font-medium tabular-nums")}>{row.display === "cancelada" ? "—" : formatCurrency(row.open_amount)}</span> },
  ];

  async function save(changes: EditableTableChanges<InvoiceRow>) {
    const result = await saveInvoiceRows(await getDb(), companyId, actor, changes);
    const labels = new Map(invoices.map((invoice) => [invoice.id, formatSequence("invoices", invoice.number)]));
    for (const id of result.updated) await emit({ type: "invoice.updated", companyId, actorId: session.user.id, entityType: "invoice", entityId: id, title: `Fatura ${labels.get(id) ?? ""} alterada`, module: "sales" });
    for (const [index, id] of result.created.entries()) {
      await emit({ type: "invoice.created", companyId, actorId: session.user.id, entityType: "invoice", entityId: id, title: `Fatura do pedido ${orderLabel(changes.created[index]?.sales_order_id)}`, module: "sales" });
    }
    invalidateTrade(qc);
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Faturas" />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="A receber" value={formatCurrency(sumMoney(openRows.map((row) => row.open_amount)))} />
        <StatCard title="Vencido" value={formatCurrency(sumMoney(overdue.flatMap((parcel) => [Number(parcel.amount), -receivedOf(parcel)])))} />
        <StatCard title="Faturado no mês" value={formatCurrency(sumMoney(issuedThisMonth.map((row) => Number(row.total))))} />
      </div>

      <EditableTable<InvoiceRow>
        actions={
          <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por fatura, pedido ou cliente...">
            <select aria-label="Filtrar por status" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className={`${INPUT} w-44`}>
              {FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </PageToolbar>
        }
        resource="invoices"
        title="Faturas"
        label="Faturas"
        rows={filtered}
        columns={columns}
        loading={isLoading}
        onSave={save}
        onRefresh={() => refreshTrade(qc)}
        newRow={() => ({ issue_date: today })}
        emptyMessage={invoices.length ? "Nenhuma fatura neste filtro" : "Nenhuma fatura emitida"}
        rowActions={(row) => (
          <button type="button" className={ROW_ACTION} aria-label={`Abrir fatura ${formatSequence("invoices", row.number)}`} onClick={() => navigate(`/sales/faturas/${row.id}`)}>
            <ExternalLink size={13} /> Abrir
          </button>
        )}
      />
    </div>
  );
}
