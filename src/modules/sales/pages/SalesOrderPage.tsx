import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Ban, Check, FileText, ShoppingCart, Trash2, Truck } from "lucide-react";
import { IconButton, TABLE_ICONS } from "@/components/shared/table";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { FileAttachments } from "@/components/shared/FileAttachments";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { removeSalesOrderItem, saveSalesOrderItemRows } from "@/lib/commercial/salesEdits";
import { confirmAction } from "@/lib/confirm";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import {
  cancelSalesOrder,
  confirmSalesOrder,
  createSalesOrder,
  deleteSalesOrder,
  deliverSalesOrder,
  invoiceDisplayStatus,
  invoiceSalesOrder,
  isSalesOrderEditable,
  loadSalesOrder,
  loadSalesOrderItems,
  resolveDueDates,
  updateSalesOrder,
} from "@/lib/erp/orders";
import { formatQty, roundQty } from "@/lib/erp/stockPosting";
import { errorMessage, isTrue } from "@/lib/erp/tradeDb";
import { emit } from "@/lib/events/bus";
import { splitInstallments } from "@/lib/money";
import { formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { InfoGrid as DetailGrid, InfoItem as DetailItem, InlinePanel, ROW_DANGER, refreshTrade, useEditActor } from "@/modules/catalog/components/inline";
import { DocumentItemsTable } from "@/modules/catalog/components/DocumentItemsTable";
import { TotalsSummary } from "@/modules/catalog/components/LineItemsEditor";
import {
  BUTTON,
  DANGER,
  ErrorNote,
  Field,
  INPUT,
  LoadingRows,
  PAYMENT_METHODS,
  PRIMARY,
  Section,
  TD,
  TH,
  byId,
  invalidateTrade,
  num,
  useCustomers,
  useInventoryItems,
  useInvoices,
  useLocations,
  usePriceLists,
  useProductsWithDeleted,
  useReceivables,
  useStockBalances,
} from "@/modules/catalog/components/tradeKit";
import { SalesOrderEditor, emptySalesOrderForm, salesLinesFrom, salesOrderFormFrom } from "../components/SalesOrderEditor";
import { newLine } from "@/modules/catalog/components/LineItemsEditor";
import type { SalesOrder, SalesOrderItem, StockMovement } from "@/types";

/** :id = "nova" abre o formulário de criação (?cliente=<id> já escolhe o cliente). */
export default function SalesOrderPage() {
  const { id = "nova" } = useParams();
  const [params] = useSearchParams();
  return id === "nova" ? <NewSalesOrder customerId={params.get("cliente") ?? ""} /> : <ExistingSalesOrder key={id} orderId={id} />;
}

function BackLink() {
  return <Link to="/sales" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Pedidos de venda</Link>;
}

function NewSalesOrder({ customerId }: { customerId: string }) {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canCreate = usePermission("create", "sales_orders");

  return (
    <div className="space-y-5">
      <BackLink />
      <PageHeader title="Novo pedido de venda" description="Escolha o cliente e os itens. O preço vem da tabela do cliente (ou da padrão) e pode ser ajustado." />
      {!canCreate ? (
        <EmptyState icon={ShoppingCart} title="Sem permissão para criar pedidos" description="Seu papel pode consultar os pedidos de venda, mas não criar." />
      ) : (
        <SalesOrderEditor
          companyId={companyId}
          initialForm={emptySalesOrderForm(customerId)}
          initialLines={[newLine()]}
          allowConfirm
          saveLabel="Salvar rascunho"
          onCancel={() => navigate("/sales")}
          onSave={async (input, confirm) => {
            const orderId = await createSalesOrder(await getDb(), { ...input, companyId, userId: session.user.id, sellerId: session.user.id, confirm });
            const order = await loadSalesOrder(await getDb(), orderId, companyId);
            await emit({ type: confirm ? "sales_order.confirmed" : "sales_order.created", companyId, actorId: session.user.id, entityType: "sales_order", entityId: orderId, title: `Pedido ${formatSequence("sales_orders", order.number)} ${confirm ? "criado e confirmado" : "criado"} (${formatCurrency(Number(order.total))})`, module: "sales" });
            return orderId;
          }}
          onSaved={(orderId) => {
            invalidateTrade(qc);
            navigate(`/sales/pedidos/${orderId}`, { replace: true });
          }}
        />
      )}
    </div>
  );
}

type Panel = "invoice" | "deliver" | "cancel" | null;

function ExistingSalesOrder({ orderId }: { orderId: string }) {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canEdit = usePermission("edit", "sales_orders");
  const canDelete = usePermission("delete", "sales_orders");
  const canInvoice = usePermission("create", "invoices");
  const canSeeInvoices = usePermission("view", "invoices");
  const canSeeCustomers = usePermission("view", "customers");
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const actor = useEditActor();
  const [form, setForm] = useState<Record<string, string>>({});
  const [itemError, setItemError] = useState<string | null>(null);
  const today = todayIso();

  const query = useQuery({
    queryKey: ["sales_orders", companyId, orderId],
    queryFn: async () => {
      const db = await getDb();
      const order = await loadSalesOrder(db, orderId, companyId);
      if (order.deleted_at) throw new Error("Pedido excluído.");
      return { order, items: await loadSalesOrderItems(db, companyId, orderId) };
    },
  });
  const { data: movements = [] } = useQuery({
    queryKey: ["stock-movements", companyId, "sales_order", orderId],
    queryFn: async () => (await getDb()).select<StockMovement[]>("SELECT * FROM stock_movements WHERE company_id=? AND ref_type=? AND ref_id=?", [companyId, "sales_order", orderId]),
  });
  const { data: customers = [] } = useCustomers(companyId);
  const { data: lists = [] } = usePriceLists(companyId);
  const { data: locations = [] } = useLocations(companyId);
  // Inclui excluídos: a prévia da entrega precisa do item de estoque de produto que saiu do catálogo depois do pedido.
  const { data: products = [] } = useProductsWithDeleted(companyId);
  const { data: inventoryItems = [] } = useInventoryItems(companyId);
  const { data: balances = [] } = useStockBalances(companyId);
  const { data: invoices = [] } = useInvoices(companyId, canSeeInvoices);
  const { data: receivables = [] } = useReceivables(companyId, canSeeInvoices);
  const customersById = useMemo(() => byId(customers), [customers]);
  const locationsById = useMemo(() => byId(locations), [locations]);
  const productsById = useMemo(() => byId(products), [products]);
  const itemsById = useMemo(() => byId(inventoryItems), [inventoryItems]);

  const order = query.data?.order;
  const items = query.data?.items ?? [];
  const label = order ? formatSequence("sales_orders", order.number) : "Pedido de venda";
  const orderInvoices = invoices.filter((invoice) => invoice.sales_order_id === orderId);

  async function log(type: string, title: string, entityType = "sales_order", entityId = orderId) {
    await emit({ type, companyId, actorId: session.user.id, entityType, entityId, title, module: "sales" });
  }

  function finish() {
    invalidateTrade(qc);
    setPanel(null);
  }

  const confirm = useMutation({
    mutationFn: async () => {
      await confirmSalesOrder(await getDb(), orderId, { companyId, userId: session.user.id });
      await log("sales_order.confirmed", `Pedido ${label} confirmado`);
    },
    onSuccess: finish,
  });

  const invoice = useMutation({
    mutationFn: async () => {
      const result = await invoiceSalesOrder(await getDb(), orderId, {
        companyId,
        userId: session.user.id,
        issueDate: form.issueDate || today,
        installments: num(form.installments, Number.NaN),
        firstDueDate: form.firstDueDate || undefined,
        intervalDays: num(form.intervalDays, 30),
        paymentMethod: form.paymentMethod || null,
        notes: form.notes,
      });
      await log("invoice.created", `Fatura do pedido ${label}: ${formatCurrency(Number(order?.total ?? 0))} em ${result.receivableIds.length} parcela(s)`, "invoice", result.invoiceId);
      return result;
    },
    onSuccess: finish,
  });

  const deliver = useMutation({
    mutationFn: async () => {
      const result = await deliverSalesOrder(await getDb(), orderId, { companyId, userId: session.user.id, locationId: form.locationId || null });
      await log("sales_order.delivered", `Pedido ${label} entregue${result.movementIds.length ? ` (${result.movementIds.length} saída(s) do estoque)` : ""}`);
    },
    onSuccess: finish,
  });

  const cancel = useMutation({
    mutationFn: async () => {
      await cancelSalesOrder(await getDb(), orderId, { companyId, userId: session.user.id, reason: form.reason ?? "" });
      await log("sales_order.cancelled", `Pedido ${label} cancelado: ${form.reason?.trim()}`);
    },
    onSuccess: finish,
  });

  const remove = useMutation({
    mutationFn: async () => {
      await deleteSalesOrder(await getDb(), orderId, { companyId, userId: session.user.id });
      await log("sales_order.deleted", `Pedido ${label} excluído`);
    },
    onSuccess: () => {
      invalidateTrade(qc);
      navigate("/sales", { replace: true });
    },
  });

  function open(next: Exclude<Panel, null>, values: Record<string, string> = {}) {
    for (const mutation of [invoice, deliver, cancel, remove]) mutation.reset();
    setForm(values);
    setPanel(next);
  }

  async function askRemove() {
    remove.reset();
    const ok = await confirmAction(`O rascunho ${label} e os itens saem da lista. O número ${label} não é reaproveitado.`, { title: `Excluir rascunho ${label}?`, okLabel: "Excluir" });
    if (ok) remove.mutate();
  }

  async function saveItems(changes: EditableTableChanges<SalesOrderItem>) {
    await saveSalesOrderItemRows(await getDb(), companyId, actor, orderId, changes);
    await log("sales_order.updated", `Itens do pedido ${label} alterados`);
    invalidateTrade(qc);
  }

  async function removeItem(item: SalesOrderItem) {
    setItemError(null);
    const ok = await confirmAction(`Tirar "${item.description}" do pedido ${label}? Os totais são recalculados.`, { title: "Remover item?", okLabel: "Remover" });
    if (!ok) return;
    try {
      await removeSalesOrderItem(await getDb(), companyId, actor, orderId, item.id);
      await log("sales_order.updated", `Item removido do pedido ${label}: ${item.description}`);
      invalidateTrade(qc);
    } catch (error) {
      setItemError(errorMessage(error));
    }
  }

  const field = (key: string) => ({ value: form[key] ?? "", onChange: (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value })) });

  if (query.isLoading) {
    return <div className="space-y-5"><BackLink /><PageHeader title="Pedido de venda" /><LoadingRows /></div>;
  }
  if (!order) {
    return (
      <div className="space-y-5">
        <BackLink />
        <PageHeader title="Pedido de venda" />
        <EmptyState icon={ShoppingCart} title="Pedido não encontrado" description={query.error ? errorMessage(query.error) : "Ele pode ter sido excluído."} />
      </div>
    );
  }

  const customer = order.customer_id ? customersById.get(order.customer_id) : undefined;
  const editable = isSalesOrderEditable(order) && canEdit;
  const canConfirm = canEdit && order.status === "rascunho";
  const canBill = canInvoice && (order.status === "confirmado" || order.status === "entregue") && !order.invoiced_at;
  const canDeliver = canEdit && (order.status === "confirmado" || order.status === "faturado");
  const canCancel = canEdit && (order.status === "rascunho" || order.status === "confirmado") && !order.invoiced_at;
  const canRemove = canDelete && order.status === "rascunho";

  const productOptions = products
    .filter((product) => (!product.deleted_at && isTrue(product.active)) || items.some((item) => item.product_id === product.id))
    .map((product) => ({ value: product.id, label: `${product.name}${product.sku ? ` (${product.sku})` : ""}${isTrue(product.active) && !product.deleted_at ? "" : " (inativo)"}` }));
  const itemColumns: EditableColumn<SalesOrderItem>[] = [
    { key: "product_id", header: "Produto", kind: "select", width: 220, options: productOptions, render: (item) => (item.product_id ? productsById.get(item.product_id)?.name ?? "Produto removido" : <span className="text-muted-foreground">Avulso</span>) },
    { key: "description", header: "Descrição", kind: "text", width: 220, placeholder: "do produto" },
    { key: "qty", header: "Qtd.", kind: "number", required: true, width: 80 },
    { key: "unit_price", header: "Preço unit.", kind: "money", placeholder: "da tabela" },
    { key: "discount", header: "Desconto", kind: "money" },
    { key: "tax_rate", header: "Imposto (%)", kind: "number", width: 90, placeholder: "do produto" },
    { key: "total", header: "Total", kind: "money", readOnly: true, render: (item) => <span className="font-medium tabular-nums">{formatCurrency(Number(item.total))}</span> },
  ];

  if (editing && editable) {
    return (
      <div className="space-y-5">
        <BackLink />
        <PageHeader title={`Editar pedido ${label}`} description={order.status === "confirmado" ? "Pedido confirmado: dá para mudar até ser faturado." : "Rascunho."} />
        <SalesOrderEditor
          companyId={companyId}
          initialForm={salesOrderFormFrom(order)}
          initialLines={salesLinesFrom(items)}
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            await updateSalesOrder(await getDb(), orderId, { ...input, companyId, userId: session.user.id });
            await log("sales_order.updated", `Pedido ${label} alterado`);
            return orderId;
          }}
          onSaved={() => {
            invalidateTrade(qc);
            setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />
      <PageHeader
        title={`Pedido ${label}`}
        description={customer ? `${customer.name} · ${formatDay(order.order_date)}` : formatDay(order.order_date)}
        actions={
          <>
            {editable && <IconButton label="Editar pedido" icon={TABLE_ICONS.edit} onClick={() => setEditing(true)} />}
            {canConfirm && <button type="button" className={PRIMARY} disabled={confirm.isPending} onClick={() => confirm.mutate()}><Check size={14} /> Confirmar</button>}
            {canBill && <button type="button" className={PRIMARY} onClick={() => open("invoice", { issueDate: today, installments: String(order.installments || 1), firstDueDate: "", intervalDays: "30", paymentMethod: Number(order.installments) > 1 ? "boleto" : "pix", notes: "" })}><FileText size={14} /> Faturar</button>}
            {canDeliver && <button type="button" className={BUTTON} onClick={() => open("deliver", { locationId: order.location_id ?? locations[0]?.id ?? "" })}><Truck size={14} /> Entregar</button>}
            {canCancel && <button type="button" className={DANGER} onClick={() => open("cancel", { reason: "" })}><Ban size={14} /> Cancelar</button>}
            {canRemove && <button type="button" className={DANGER} disabled={remove.isPending} onClick={() => void askRemove()}><Trash2 size={14} /> Excluir</button>}
          </>
        }
      />
      <ErrorNote error={confirm.error} />
      <ErrorNote error={remove.error} />

      {panel === "invoice" && (
        <InlinePanel title={`Faturar pedido ${label}`} label={`Faturar pedido ${label}`} onClose={() => setPanel(null)}>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); invoice.mutate(); }}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Emissão"><input type="date" required className={INPUT} {...field("issueDate")} /></Field>
              <Field label="Forma de pagamento">
                <select className={INPUT} {...field("paymentMethod")}>
                  <option value="">—</option>
                  {PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                </select>
              </Field>
              <Field label="Parcelas"><input inputMode="numeric" required className={INPUT} {...field("installments")} /></Field>
              <Field label="Dias entre parcelas"><input inputMode="numeric" className={INPUT} {...field("intervalDays")} /></Field>
              <Field label="Primeiro vencimento (opcional)"><input type="date" className={INPUT} {...field("firstDueDate")} /></Field>
              <Field label="Observações da fatura"><textarea rows={2} className={`${INPUT} h-auto py-2`} {...field("notes")} /></Field>
            </div>
            <InstallmentPreview total={Number(order.total)} issueDate={form.issueDate || today} installments={form.installments ?? ""} intervalDays={form.intervalDays ?? ""} firstDueDate={form.firstDueDate ?? ""} />
            <ErrorNote error={invoice.error} />
            <div className="flex gap-2">
              <button type="submit" className={PRIMARY} disabled={invoice.isPending}><FileText size={14} /> {invoice.isPending ? "Emitindo..." : "Emitir fatura"}</button>
              <button type="button" className={BUTTON} onClick={() => setPanel(null)}>Fechar</button>
            </div>
          </form>
        </InlinePanel>
      )}

      {panel === "deliver" && (
        <InlinePanel title={`Entregar pedido ${label}`} label={`Entregar pedido ${label}`} onClose={() => setPanel(null)}>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); deliver.mutate(); }}>
            <Field label="Local de saída do estoque" className="max-w-sm">
              <select className={INPUT} {...field("locationId")}>
                <option value="">Escolha...</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </Field>
            <DeliveryPreview order={order} items={items} locationId={form.locationId ?? ""} productsById={productsById} itemsById={itemsById} balances={balances} />
            <ErrorNote error={deliver.error} />
            <div className="flex gap-2">
              <button type="submit" className={PRIMARY} disabled={deliver.isPending}><Truck size={14} /> Confirmar entrega</button>
              <button type="button" className={BUTTON} onClick={() => setPanel(null)}>Fechar</button>
            </div>
          </form>
        </InlinePanel>
      )}

      {panel === "cancel" && (
        <InlinePanel title={`Cancelar pedido ${label}?`} label={`Cancelar pedido ${label}`} onClose={() => setPanel(null)}>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); cancel.mutate(); }}>
            <Field label="Motivo" className="max-w-xl"><textarea rows={2} required className={`${INPUT} h-auto py-2`} {...field("reason")} /></Field>
            <p className="text-xs text-muted-foreground">O pedido fica no histórico como cancelado. Pedido faturado precisa ter a fatura cancelada antes.</p>
            <ErrorNote error={cancel.error} />
            <div className="flex gap-2">
              <button type="submit" className={DANGER} disabled={cancel.isPending || !(form.reason ?? "").trim()}><Ban size={14} /> Cancelar pedido</button>
              <button type="button" className={BUTTON} onClick={() => setPanel(null)}>Fechar</button>
            </div>
          </form>
        </InlinePanel>
      )}

      <div className="grid gap-5 rounded-xl border bg-card p-5 lg:grid-cols-[1fr_auto]">
        <DetailGrid>
          <DetailItem label="Status" value={<span className="flex flex-wrap gap-1.5"><StatusBadge status={order.status} />{order.status === "entregue" && order.invoiced_at && <StatusBadge status="faturado" />}</span>} />
          <DetailItem label="Cliente" value={customer ? (canSeeCustomers ? <Link className="hover:underline" to={`/crm/clientes/${customer.id}`}>{customer.name}</Link> : customer.name) : "Cliente removido"} />
          <DetailItem label="Data do pedido" value={formatDay(order.order_date)} />
          <DetailItem label="Previsão de entrega" value={formatDay(order.delivery_date)} />
          <DetailItem label="Tabela de preço" value={order.price_list_id ? lists.find((list) => list.id === order.price_list_id)?.name ?? "Tabela removida" : "Catálogo"} />
          <DetailItem label="Local de saída" value={order.location_id ? locationsById.get(order.location_id)?.name : "Escolher na entrega"} />
          <DetailItem label="Condição de pagamento" value={order.payment_terms} />
          <DetailItem label="Parcelas" value={String(order.installments ?? 1)} />
          {order.confirmed_at && <DetailItem label="Confirmado em" value={formatDay(order.confirmed_at)} />}
          {order.invoiced_at && <DetailItem label="Faturado em" value={formatDay(order.invoiced_at)} />}
          {order.delivered_at && <DetailItem label="Entregue em" value={formatDay(order.delivered_at)} />}
          {order.cancelled_at && <DetailItem label="Cancelado em" value={`${formatDay(order.cancelled_at)}${order.cancel_reason ? ` · ${order.cancel_reason}` : ""}`} />}
        </DetailGrid>
        <TotalsSummary rows={[
          { label: "Itens", value: Number(order.subtotal) },
          { label: "Desconto", value: Number(order.discount), negative: true },
          { label: "Frete", value: Number(order.shipping) },
          { label: "Impostos", value: Number(order.tax_total) },
          { label: "Total", value: Number(order.total), strong: true },
        ]} />
      </div>

      {isSalesOrderEditable(order) ? (
        <div className="space-y-2">
          <EditableTable<SalesOrderItem>
            resource="sales_orders"
            title="Itens"
            label={`Itens do pedido ${label}`}
            rows={items}
            columns={itemColumns}
            onSave={saveItems}
            onRefresh={() => refreshTrade(qc)}
            newRow={() => ({ qty: 1 })}
            emptyMessage="Pedido sem itens: use Adicionar. Com produto escolhido, preço, descrição e imposto vêm da tabela do cliente se ficarem em branco."
            rowActions={canEdit ? (item) => (
              <button type="button" className={ROW_DANGER} aria-label={`Remover item ${item.description}`} onClick={() => void removeItem(item)}>
                <Trash2 size={13} /> Remover
              </button>
            ) : undefined}
          />
          {itemError && <p role="alert" className="text-sm text-destructive">{itemError}</p>}
        </div>
      ) : (
        <Section title="Itens">
          <DocumentItemsTable<SalesOrderItem> items={items} extra={order.delivered_at ? [{ header: "Entregue", cell: (item) => formatQty(Number(item.delivered_qty)) }] : []} />
        </Section>
      )}

      {(order.notes || order.internal_notes) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {order.notes && <DetailItem label="Observações" value={<p className="whitespace-pre-wrap">{order.notes}</p>} />}
          {order.internal_notes && <DetailItem label="Observações internas" value={<p className="whitespace-pre-wrap">{order.internal_notes}</p>} />}
        </div>
      )}

      {canSeeInvoices && (
        <Section title="Faturas">
          {orderInvoices.length === 0 ? <p className="text-sm text-muted-foreground">{order.status === "rascunho" ? "Confirme o pedido para poder faturar." : "Ainda não faturado."}</p> : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-muted/30"><tr><th className={TH}>Fatura</th><th className={TH}>Emissão</th><th className={TH}>Parcelas</th><th className={TH}>Status</th><th className={`${TH} text-right`}>Total</th></tr></thead>
                <tbody className="divide-y">
                  {orderInvoices.map((row) => (
                    <tr key={row.id}>
                      <td className={TD}><Link className="font-medium hover:underline" to={`/sales/faturas/${row.id}`}>{formatSequence("invoices", row.number)}</Link></td>
                      <td className={`${TD} text-muted-foreground`}>{formatDay(row.issue_date)}</td>
                      <td className={`${TD} text-muted-foreground`}>{row.installments}x</td>
                      <td className={TD}><StatusBadge status={invoiceDisplayStatus(row, receivables.filter((receivable) => receivable.invoice_id === row.id), today)} /></td>
                      <td className={`${TD} text-right tabular-nums`}>{formatCurrency(Number(row.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      <Section title="Saídas do estoque">
        {movements.length === 0 ? <p className="text-sm text-muted-foreground">{order.status === "entregue" ? "Nenhum item deste pedido movimenta estoque." : "A saída acontece na entrega."}</p> : (
          <ul className="divide-y rounded-xl border text-sm">
            {movements.map((movement) => {
              const item = itemsById.get(movement.item_id);
              return (
                <li key={movement.id} className="flex flex-wrap justify-between gap-3 px-4 py-2.5">
                  <span className="font-medium">{item?.name ?? "Item removido"}</span>
                  <span className="text-muted-foreground">{movement.from_location_id ? locationsById.get(movement.from_location_id)?.name ?? "Local removido" : "—"} · {formatDay(movement.created_at)}</span>
                  <span className="tabular-nums">−{formatQty(Number(movement.quantity))} {item?.unit ?? "un"}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Anexos">
        <FileAttachments entityType="sales_order" entityId={orderId} canEdit={canEdit} />
      </Section>

    </div>
  );
}

function InstallmentPreview({ total, issueDate, installments, intervalDays, firstDueDate }: { total: number; issueDate: string; installments: string; intervalDays: string; firstDueDate: string }) {
  let rows: Array<{ date: string; amount: number }> = [];
  let problem: string | null = null;
  try {
    const dates = resolveDueDates(issueDate, { installments: num(installments, Number.NaN), intervalDays: num(intervalDays, 30), firstDueDate: firstDueDate || undefined });
    const amounts = splitInstallments(total, dates.length);
    rows = dates.map((date, index) => ({ date, amount: amounts[index] }));
  } catch (error) {
    problem = errorMessage(error);
  }
  return (
    <div className="mt-4 space-y-2">
      <p className="text-sm font-medium">Parcelas em contas a receber</p>
      {problem ? <p className="text-sm text-destructive">{problem}</p> : (
        <ul className="max-h-48 divide-y overflow-y-auto rounded-lg border text-sm">
          {rows.map((row, index) => (
            <li key={index} className="flex justify-between px-3 py-1.5">
              <span>{index + 1}/{rows.length} · vence {formatDay(row.date)}</span>
              <span className="tabular-nums">{formatCurrency(row.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeliveryPreview({ order, items, locationId, productsById, itemsById, balances }: {
  order: SalesOrder;
  items: readonly SalesOrderItem[];
  locationId: string;
  productsById: Map<string, { kind: string; inventory_item_id?: string | null }>;
  itemsById: Map<string, { name: string; unit: string }>;
  balances: ReadonlyArray<{ item_id: string; location_id: string; quantity: number }>;
}) {
  const needs = new Map<string, number>();
  for (const item of items) {
    const product = item.product_id ? productsById.get(item.product_id) : undefined;
    if (product?.kind === "produto" && product.inventory_item_id) needs.set(product.inventory_item_id, roundQty((needs.get(product.inventory_item_id) ?? 0) + Number(item.qty)));
  }
  if (needs.size === 0) return <p className="mt-4 text-sm text-muted-foreground">Nenhum item deste pedido movimenta estoque (serviços ou produtos sem item de estoque). O pedido só fica como entregue.</p>;
  return (
    <div className="mt-4 space-y-2">
      <p className="text-sm font-medium">Saída do estoque{order.status === "confirmado" ? "" : " (pedido já faturado)"}</p>
      <ul className="divide-y rounded-lg border text-sm">
        {Array.from(needs.entries()).map(([itemId, quantity]) => {
          const item = itemsById.get(itemId);
          const available = roundQty(balances.filter((balance) => balance.item_id === itemId && balance.location_id === locationId).reduce((sum, balance) => sum + Number(balance.quantity), 0));
          const short = locationId && available < quantity;
          return (
            <li key={itemId} className="flex justify-between gap-3 px-3 py-1.5">
              <span>{item?.name ?? "Item removido"}</span>
              <span className={`tabular-nums ${short ? "text-destructive" : "text-muted-foreground"}`}>
                {formatQty(quantity)} {item?.unit ?? "un"} {locationId ? `· saldo ${formatQty(available)}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
