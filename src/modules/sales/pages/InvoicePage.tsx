import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, Receipt } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { FileAttachments } from "@/components/shared/FileAttachments";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge, statusLabel } from "@/components/shared/StatusBadge";
import { NoFilterMatchRow, SortableHeader, TableFilterBar, TableFilterToolbar, useSortFilter, type SortFilterColumn } from "@/components/shared/table";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { cancelInvoice, invoiceDisplayStatus, isActiveReceivable, isReceivableOverdue, receivedOf } from "@/lib/erp/orders";
import { activeRowsBy, documentById, errorMessage } from "@/lib/erp/tradeDb";
import { emit } from "@/lib/events/bus";
import { sumMoney } from "@/lib/money";
import { formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { InfoGrid as DetailGrid, InfoItem as DetailItem, InlinePanel } from "@/modules/catalog/components/inline";
import { DocumentItemsTable } from "@/modules/catalog/components/DocumentItemsTable";
import { TotalsSummary } from "@/modules/catalog/components/LineItemsEditor";
import { BUTTON, DANGER, ErrorNote, Field, INPUT, LoadingRows, PRIMARY, Section, TD, invalidateTrade, paymentMethodLabel, useCustomers, useReceivables, useSalesOrders } from "@/modules/catalog/components/tradeKit";
import type { Invoice, InvoiceItem, Receivable } from "@/types";

interface ParcelRow {
  parcel: Receivable;
  number: number;
  count: number;
  overdue: boolean;
}

/** Cabeçalho ordenável no padrão do TH das telas de compra/venda (o alinhamento vem do `align`). */
const SORT_TH = "px-4 py-3 text-sm";

const PARCEL_COLUMNS: SortFilterColumn<ParcelRow>[] = [
  { key: "number", header: "Parcela", kind: "integer", sortValue: (row) => row.number },
  { key: "due_date", header: "Vencimento", kind: "date", sortValue: (row) => row.parcel.due_date },
  { key: "status", header: "Status", kind: "select", sortValue: (row) => statusLabel(row.overdue ? "vencida" : row.parcel.status) },
  { key: "received_at", header: "Recebido em", kind: "date", sortValue: (row) => row.parcel.received_at },
  { key: "amount", header: "Valor", kind: "money", sortValue: (row) => Number(row.parcel.amount) },
  { key: "received", header: "Recebido", kind: "money", sortValue: (row) => receivedOf(row.parcel) },
];

function BackLink() {
  return <Link to="/sales/faturas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Faturas</Link>;
}

export default function InvoicePage() {
  const { id = "nova" } = useParams();
  const navigate = useNavigate();
  if (id === "nova") {
    return (
      <div className="space-y-5">
        <BackLink />
        <PageHeader title="Nova fatura" />
        <EmptyState
          icon={Receipt}
          title="Faturas nascem dos pedidos de venda"
          description="Abra um pedido confirmado e use Faturar (ou Adicionar na lista de faturas): a fatura copia os itens e gera as parcelas em contas a receber."
          action={<button type="button" className={PRIMARY} onClick={() => navigate("/sales")}>Ver pedidos de venda</button>}
        />
      </div>
    );
  }
  return <InvoiceDetail key={id} invoiceId={id} />;
}

function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const canCancel = usePermission("edit", "invoices");
  const canSeeOrders = usePermission("view", "sales_orders");
  const canSeeFinance = usePermission("view", "receivables");
  const today = todayIso();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState("");

  const query = useQuery({
    queryKey: ["invoices", companyId, invoiceId],
    queryFn: async () => {
      const db = await getDb();
      const invoice = await documentById<Invoice>(db, "invoices", invoiceId, companyId, "Fatura");
      if (invoice.deleted_at) throw new Error("Fatura excluída.");
      const items = (await activeRowsBy<InvoiceItem>(db, "invoice_items", companyId, "invoice_id", invoiceId)).sort((a, b) => a.position - b.position);
      return { invoice, items };
    },
  });
  const { data: receivables = [] } = useReceivables(companyId);
  const { data: customers = [] } = useCustomers(companyId);
  const { data: orders = [] } = useSalesOrders(companyId, canSeeOrders);
  const parcels = useMemo(
    () =>
      receivables
        .filter((row) => row.invoice_id === invoiceId)
        .sort((a, b) => Number(a.installment_number ?? 0) - Number(b.installment_number ?? 0) || (a.due_date ?? "").localeCompare(b.due_date ?? "")),
    [receivables, invoiceId],
  );
  const parcelRows = useMemo<ParcelRow[]>(
    () => parcels.map((parcel, index) => ({ parcel, number: parcel.installment_number ?? index + 1, count: parcel.installment_count ?? parcels.length, overdue: isReceivableOverdue(parcel, today) })),
    [parcels, today],
  );
  const parcelView = useSortFilter(parcelRows, PARCEL_COLUMNS);

  const cancel = useMutation({
    mutationFn: async (label: string) => {
      await cancelInvoice(await getDb(), invoiceId, { companyId, userId: session.user.id, reason });
      await emit({ type: "invoice.cancelled", companyId, actorId: session.user.id, entityType: "invoice", entityId: invoiceId, title: `Fatura ${label} cancelada: ${reason.trim()}`, module: "sales" });
    },
    onSuccess: () => {
      invalidateTrade(qc);
      setConfirmCancel(false);
    },
  });

  if (query.isLoading) return <div className="space-y-5"><BackLink /><PageHeader title="Fatura" /><LoadingRows /></div>;
  const invoice = query.data?.invoice;
  if (!invoice) {
    return (
      <div className="space-y-5">
        <BackLink />
        <PageHeader title="Fatura" />
        <EmptyState icon={Receipt} title="Fatura não encontrada" description={query.error ? errorMessage(query.error) : "Ela pode ter sido excluída."} />
      </div>
    );
  }

  const label = formatSequence("invoices", invoice.number);
  const active = parcels.filter(isActiveReceivable);
  const status = invoiceDisplayStatus(invoice, active, today);
  const received = sumMoney(active.map(receivedOf));
  const customer = invoice.customer_id ? customers.find((row) => row.id === invoice.customer_id) : undefined;
  const order = invoice.sales_order_id ? orders.find((row) => row.id === invoice.sales_order_id) : undefined;

  return (
    <div className="space-y-6">
      <BackLink />
      <PageHeader
        title={`Fatura ${label}`}
        description={customer ? `${customer.name} · emitida em ${formatDay(invoice.issue_date)}` : `Emitida em ${formatDay(invoice.issue_date)}`}
        actions={
          <>
            {canSeeFinance && status !== "cancelada" && <Link to="/finance" className={BUTTON}>Receber no Financeiro</Link>}
            {canCancel && invoice.status !== "cancelada" && <button type="button" className={DANGER} onClick={() => { cancel.reset(); setReason(""); setConfirmCancel(true); }}><Ban size={14} /> Cancelar fatura</button>}
          </>
        }
      />

      {confirmCancel && (
        <InlinePanel title={`Cancelar fatura ${label}?`} label={`Cancelar fatura ${label}`} onClose={() => setConfirmCancel(false)}>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); cancel.mutate(label); }}>
            <Field label="Motivo" className="max-w-xl"><textarea rows={2} required className={`${INPUT} h-auto py-2`} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
            <p className="text-xs text-muted-foreground">As parcelas em contas a receber são canceladas e o pedido pode ser faturado de novo. Só dá para cancelar se nenhuma parcela foi recebida.</p>
            <ErrorNote error={cancel.error} />
            <div className="flex gap-2">
              <button type="submit" className={DANGER} disabled={cancel.isPending || !reason.trim()}><Ban size={14} /> Cancelar fatura</button>
              <button type="button" className={BUTTON} onClick={() => setConfirmCancel(false)}>Fechar</button>
            </div>
          </form>
        </InlinePanel>
      )}

      <div className="grid gap-5 rounded-xl border bg-card p-5 lg:grid-cols-[1fr_auto]">
        <DetailGrid>
          <DetailItem label="Status" value={<StatusBadge status={status} />} />
          <DetailItem label="Cliente" value={customer?.name ?? "Cliente removido"} />
          <DetailItem label="Pedido" value={invoice.sales_order_id ? (canSeeOrders ? <Link className="hover:underline" to={`/sales/pedidos/${invoice.sales_order_id}`}>{order ? formatSequence("sales_orders", order.number) : "Abrir pedido"}</Link> : order ? formatSequence("sales_orders", order.number) : "—") : "—"} />
          <DetailItem label="Emissão" value={formatDay(invoice.issue_date)} />
          <DetailItem label="Forma de pagamento" value={paymentMethodLabel(invoice.payment_method)} />
          <DetailItem label="Condição" value={invoice.payment_terms} />
          <DetailItem label="Nota fiscal" value={invoice.fiscal_number ? `${invoice.fiscal_number}${invoice.fiscal_series ? ` / série ${invoice.fiscal_series}` : ""}` : null} />
          {invoice.cancelled_at && <DetailItem label="Cancelada em" value={`${formatDay(invoice.cancelled_at)}${invoice.cancel_reason ? ` · ${invoice.cancel_reason}` : ""}`} />}
        </DetailGrid>
        <TotalsSummary rows={[
          { label: "Itens", value: Number(invoice.subtotal) },
          { label: "Desconto", value: Number(invoice.discount), negative: true },
          { label: "Frete", value: Number(invoice.shipping) },
          { label: "Impostos", value: Number(invoice.tax_total) },
          { label: "Total", value: Number(invoice.total), strong: true },
          ...(status === "cancelada" ? [] : [{ label: "Recebido", value: received }, { label: "Em aberto", value: Math.max(0, sumMoney([Number(invoice.total), -received])) }]),
        ]} />
      </div>

      <Section title="Parcelas (contas a receber)">
        {parcels.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma parcela encontrada.</p> : (
          <div className="rounded-xl border">
            <TableFilterToolbar view={parcelView} />
            <TableFilterBar view={parcelView} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    {PARCEL_COLUMNS.map((column) => (
                      <SortableHeader
                        key={column.key}
                        label={column.header}
                        sortKey={column.key}
                        sort={parcelView.sort}
                        onSort={parcelView.toggleSort}
                        align={column.kind === "money" ? "right" : "left"}
                        className={SORT_TH}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {parcelView.rows.map(({ parcel, number, count, overdue }) => (
                    <tr key={parcel.id}>
                      <td className={TD}>{number}/{count}</td>
                      <td className={`${TD} ${overdue ? "text-destructive" : "text-muted-foreground"}`}>{formatDay(parcel.due_date)}</td>
                      <td className={TD}><StatusBadge status={overdue ? "vencida" : parcel.status} /></td>
                      <td className={`${TD} text-muted-foreground`}>{formatDay(parcel.received_at)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatCurrency(Number(parcel.amount))}</td>
                      <td className={`${TD} text-right tabular-nums`}>{receivedOf(parcel) ? formatCurrency(receivedOf(parcel)) : "—"}</td>
                    </tr>
                  ))}
                  {!parcelView.rows.length && <NoFilterMatchRow colSpan={PARCEL_COLUMNS.length} />}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      <Section title="Itens">
        <DocumentItemsTable items={query.data?.items ?? []} />
      </Section>

      {invoice.notes && <DetailItem label="Observações" value={<p className="whitespace-pre-wrap">{invoice.notes}</p>} />}

      <Section title="Anexos">
        <FileAttachments entityType="invoice" entityId={invoiceId} canEdit={canCancel} />
      </Section>

    </div>
  );
}
