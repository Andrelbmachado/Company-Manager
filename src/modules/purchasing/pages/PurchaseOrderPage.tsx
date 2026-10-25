// Tela do pedido de compra. "nova" abre o formulário de criação (?fornecedor=<id> já escolhe o fornecedor); o pedido
// gravado mostra os dados, os itens numa tabela editável (rascunho), recebimentos, contas a pagar e anexos. Editar dados,
// receber mercadoria e cancelar abrem no próprio lugar (sem modal); excluir confirma em dois passos.
import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Ban, Check, PackageCheck, Pencil, Send, Trash2, Truck } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { FileAttachments } from "@/components/shared/FileAttachments";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { usePermission } from "@/hooks/usePermission";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { canReceive, createPurchaseOrder, loadPurchaseOrder, loadPurchaseOrderItems, remainingQty } from "@/lib/erp/receiving";
import { formatQty } from "@/lib/erp/stockPosting";
import { errorMessage, fail } from "@/lib/erp/tradeDb";
import { emit } from "@/lib/events/bus";
import { normalizeValue } from "@/lib/importexport/normalize";
import { formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { TotalsSummary, newLine } from "@/modules/catalog/components/LineItemsEditor";
import { BUTTON, DANGER, ErrorNote, Field, INPUT, LoadingRows, PAYMENT_METHODS, PRIMARY, Section, TD, TH, byId, invalidateTrade, num, useGoodsReceipts, useLocations, usePayables, useSuppliers } from "@/modules/catalog/components/tradeKit";
import { ConfirmButton } from "@/modules/finance/components/financeShared";
import { InfoGrid, InfoItem, InlinePanel } from "@/modules/finance/components/inline";
import { useEditContext } from "@/modules/finance/data/useEditContext";
import type { PurchaseOrder, PurchaseOrderItem, StockLocation, Supplier } from "@/types";
import { PurchaseOrderEditor, emptyPurchaseOrderForm } from "../components/PurchaseOrderEditor";
import { usePurchaseItemOptions } from "../components/itemOptions";
import { approveOrder, cancelOrder, deleteOrder, receiveOrder, sendOrder } from "../data/orderActions";
import { itemRef } from "../data/purchaseInputs";
import { purchaseItemRow, removePurchaseItem, savePurchaseItemChanges, type PurchaseItemRow } from "../data/purchaseItemEditing";
import { savePurchaseOrderChanges, type PurchaseOrderRow } from "../data/purchaseOrderEditing";

/** :id = "nova" abre o formulário de criação (?fornecedor=<id> já escolhe o fornecedor). */
export default function PurchaseOrderPage() {
  const { id = "nova" } = useParams();
  const [params] = useSearchParams();
  return id === "nova" ? <NewPurchaseOrder supplierId={params.get("fornecedor") ?? ""} /> : <ExistingPurchaseOrder key={id} orderId={id} />;
}

function BackLink() {
  return <Link to="/purchasing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Pedidos de compra</Link>;
}

function NewPurchaseOrder({ supplierId }: { supplierId: string }) {
  const ctx = useEditContext();
  const companyId = ctx.companyId;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canCreate = usePermission("create", "purchase_orders");
  return (
    <div className="space-y-5">
      <BackLink />
      <PageHeader title="Novo pedido de compra" description="O pedido nasce em rascunho; depois de aprovado, é enviado ao fornecedor e recebido (total ou em partes)." />
      {!canCreate ? (
        <EmptyState icon={Truck} title="Sem permissão para criar pedidos de compra" description="Seu papel pode consultar os pedidos, mas não criar." />
      ) : (
        <PurchaseOrderEditor
          companyId={companyId}
          initialForm={emptyPurchaseOrderForm(supplierId)}
          initialLines={[newLine()]}
          saveLabel="Salvar rascunho"
          onCancel={() => navigate("/purchasing")}
          onSave={async (input) => {
            const db = await getDb();
            const orderId = await createPurchaseOrder(db, { ...input, companyId, userId: ctx.userId });
            const order = await loadPurchaseOrder(db, orderId, companyId);
            await emit({ type: "purchase_order.created", companyId, actorId: ctx.userId, entityType: "purchase_order", entityId: orderId, title: `Pedido de compra ${formatSequence("purchase_orders", order.number)} criado (${formatCurrency(Number(order.total))})`, module: "purchasing" });
            return orderId;
          }}
          onSaved={(orderId) => {
            invalidateTrade(qc);
            navigate(`/purchasing/pedidos/${orderId}`, { replace: true });
          }}
        />
      )}
    </div>
  );
}

type Panel = "header" | "receive" | "cancel" | null;

function ExistingPurchaseOrder({ orderId }: { orderId: string }) {
  const ctx = useEditContext();
  const companyId = ctx.companyId;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canEdit = usePermission("edit", "purchase_orders");
  const canDelete = usePermission("delete", "purchase_orders");
  const canApprove = usePermission("approve", "purchase_orders");
  const canReceiveGoods = usePermission("receive", "purchase_orders");
  const canSeePayables = usePermission("view", "payables");
  const [panel, setPanel] = useState<Panel>(null);

  const query = useQuery({
    queryKey: ["purchase_orders", companyId, orderId],
    queryFn: async () => {
      const db = await getDb();
      const order = await loadPurchaseOrder(db, orderId, companyId);
      if (order.deleted_at) throw new Error("Pedido excluído.");
      return { order, items: await loadPurchaseOrderItems(db, companyId, orderId) };
    },
  });
  const { data: suppliers = [] } = useSuppliers(companyId);
  const { data: locations = [] } = useLocations(companyId);
  const { data: receipts = [] } = useGoodsReceipts(companyId);
  const { data: payables = [] } = usePayables(companyId, canSeePayables);
  const locationsById = useMemo(() => byId(locations), [locations]);

  const order = query.data?.order;
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const itemOptions = usePurchaseItemOptions(companyId, items.map(itemRef));
  const label = order ? formatSequence("purchase_orders", order.number) : "Pedido de compra";
  const draft = order?.status === "rascunho";

  const action = useMutation({
    mutationFn: async (kind: "approve" | "send" | "delete") => {
      const db = await getDb();
      if (kind === "approve") await approveOrder(db, ctx, orderId);
      else if (kind === "send") await sendOrder(db, ctx, orderId);
      else await deleteOrder(db, ctx, orderId);
      return kind;
    },
    onSuccess: (kind) => {
      invalidateTrade(qc);
      if (kind === "delete") navigate("/purchasing", { replace: true });
    },
  });

  const itemColumns = useMemo<EditableColumn<PurchaseItemRow>[]>(() => [
    { key: "ref", header: "Produto / item", kind: "select", width: 240, placeholder: "Linha avulsa", options: itemOptions.options, readOnly: !draft, render: (row) => itemOptions.nameOf(row.ref) ?? <span className="text-muted-foreground">Avulso</span> },
    { key: "description", header: "Descrição", kind: "text", width: 220, placeholder: "Do produto", readOnly: !draft },
    { key: "unit", header: "Unid.", kind: "text", width: 70, placeholder: "un", readOnly: !draft },
    { key: "qty", header: "Qtd.", kind: "number", width: 90, required: true, readOnly: !draft },
    { key: "unit_price", header: "Custo unit.", kind: "money", placeholder: "Custo atual", readOnly: !draft },
    { key: "discount", header: "Desconto", kind: "money", readOnly: !draft },
    { key: "tax_rate", header: "Imposto %", kind: "number", width: 90, readOnly: !draft },
    { key: "total", header: "Total", kind: "money", readOnly: true },
    { key: "received", header: "Recebido", kind: "text", readOnly: true },
  ], [itemOptions, draft]);

  async function saveItems(changes: EditableTableChanges<PurchaseItemRow>) {
    await savePurchaseItemChanges(await getDb(), ctx, orderId, changes);
    invalidateTrade(qc);
  }

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => removePurchaseItem(await getDb(), ctx, orderId, itemId),
    onSuccess: () => invalidateTrade(qc),
  });

  if (query.isLoading) return <div className="space-y-5"><BackLink /><PageHeader title="Pedido de compra" /><LoadingRows /></div>;
  if (!order) {
    return (
      <div className="space-y-5">
        <BackLink />
        <PageHeader title="Pedido de compra" />
        <EmptyState icon={Truck} title="Pedido não encontrado" description={query.error ? errorMessage(query.error) : "Ele pode ter sido excluído."} />
      </div>
    );
  }

  const supplier = order.supplier_id ? suppliers.find((row) => row.id === order.supplier_id) : undefined;
  const orderReceipts = receipts.filter((receipt) => receipt.purchase_order_id === orderId);
  const orderPayables = payables.filter((payable) => payable.purchase_order_id === orderId);
  const pendingLines = items.filter((line) => remainingQty(line) > 0);
  const editable = canEdit && draft;
  const showApprove = canApprove && draft;
  const showSend = canEdit && order.status === "aprovado";
  const showReceive = canReceiveGoods && canReceive(order) && pendingLines.length > 0;
  const showCancel = canEdit && (order.status === "rascunho" || order.status === "aprovado" || order.status === "enviado") && !orderReceipts.some((receipt) => receipt.status !== "estornado");
  const showDelete = canDelete && draft;

  function open(next: Panel) {
    action.reset();
    setPanel((current) => (current === next ? null : next));
  }

  return (
    <div className="space-y-6">
      <BackLink />
      <PageHeader
        title={`Pedido de compra ${label}`}
        description={supplier ? `${supplier.name} · ${formatDay(order.order_date)}` : formatDay(order.order_date)}
        actions={
          <>
            {editable && <button type="button" className={BUTTON} aria-pressed={panel === "header"} onClick={() => open("header")}><Pencil size={14} /> Editar dados do pedido</button>}
            {showApprove && <button type="button" className={PRIMARY} disabled={action.isPending} onClick={() => action.mutate("approve")}><Check size={14} /> Aprovar</button>}
            {showSend && <button type="button" className={BUTTON} disabled={action.isPending} onClick={() => action.mutate("send")}><Send size={14} /> Marcar como enviado</button>}
            {showReceive && <button type="button" className={PRIMARY} aria-pressed={panel === "receive"} onClick={() => open("receive")}><PackageCheck size={14} /> Receber mercadoria</button>}
            {showCancel && <button type="button" className={DANGER} aria-pressed={panel === "cancel"} onClick={() => open("cancel")}><Ban size={14} /> Cancelar</button>}
            {showDelete && <ConfirmButton label="Excluir" confirmLabel="Confirmar exclusão" icon={<Trash2 size={14} aria-hidden="true" />} busy={action.isPending} onConfirm={() => action.mutate("delete")} />}
          </>
        }
      />
      <ErrorNote error={action.error} />
      {draft && !canApprove && <p className="text-sm text-muted-foreground">Aguardando aprovação da gerência.</p>}

      {panel === "receive" && showReceive && <ReceivePanel order={order} items={pendingLines} locations={locations} label={label} onDone={() => setPanel(null)} />}
      {panel === "cancel" && showCancel && <CancelPanel orderId={orderId} label={label} onDone={() => setPanel(null)} />}

      {panel === "header" && editable ? (
        <HeaderForm order={order} suppliers={suppliers} locations={locations} label={label} onDone={() => setPanel(null)} />
      ) : (
        <div className="grid gap-5 rounded-xl border bg-card p-5 lg:grid-cols-[1fr_auto]">
          <InfoGrid>
            <InfoItem label="Status" value={<StatusBadge status={order.status} />} />
            <InfoItem label="Fornecedor" value={order.supplier_id ? supplier?.name ?? "Fornecedor removido" : "A definir"} />
            <InfoItem label="Data do pedido" value={formatDay(order.order_date)} />
            <InfoItem label="Previsão de entrega" value={formatDay(order.expected_date)} />
            <InfoItem label="Local de entrada" value={order.location_id ? locationsById.get(order.location_id)?.name : "Escolher no recebimento"} />
            <InfoItem label="Condição de pagamento" value={order.payment_terms} />
            <InfoItem label="Parcelas" value={String(order.installments ?? 1)} />
            {order.approved_at && <InfoItem label="Aprovado em" value={formatDay(order.approved_at)} />}
            {order.sent_at && <InfoItem label="Enviado em" value={formatDay(order.sent_at)} />}
            {order.received_at && <InfoItem label="Recebido em" value={formatDay(order.received_at)} />}
            {order.cancelled_at && <InfoItem label="Cancelado em" value={`${formatDay(order.cancelled_at)}${order.cancel_reason ? ` · ${order.cancel_reason}` : ""}`} />}
          </InfoGrid>
          <TotalsSummary rows={[
            { label: "Itens", value: Number(order.subtotal) },
            { label: "Desconto", value: Number(order.discount), negative: true },
            { label: "Frete", value: Number(order.shipping) },
            { label: "Impostos", value: Number(order.tax_total) },
            { label: "Total", value: Number(order.total), strong: true },
          ]} />
        </div>
      )}

      <Section title="Itens">
        <ErrorNote error={removeItem.error} />
        <EditableTable<PurchaseItemRow>
          resource="purchase_orders"
          label="Itens do pedido"
          rows={items.map(purchaseItemRow)}
          columns={itemColumns}
          newRow={() => ({ qty: 1, discount: 0, tax_rate: 0 })}
          onSave={saveItems}
          onRefresh={() => qc.invalidateQueries({ queryKey: ["purchase_orders", companyId, orderId] })}
          emptyMessage="Nenhum item."
          rowActions={editable ? (row) => (
            <ConfirmButton label="" ariaLabel={`Remover ${row.description ?? "item"}`} confirmLabel="Confirmar remoção" icon={<Trash2 size={14} aria-hidden="true" />} busy={removeItem.isPending} onConfirm={() => removeItem.mutate(row.id)} />
          ) : undefined}
        />
        <p className="text-sm text-muted-foreground">
          {draft
            ? "Custo unitário vazio usa o custo atual do item de estoque (ou do produto). Linha avulsa (sem produto) precisa de descrição e custo e não entra no estoque."
            : "Depois de aprovado, os itens não mudam: para corrigir, cancele o pedido e crie outro."}
        </p>
      </Section>

      {order.notes && (
        <Section title="Observações">
          <p className="whitespace-pre-wrap text-sm">{order.notes}</p>
        </Section>
      )}

      <Section title="Recebimentos">
        {orderReceipts.length === 0 ? <p className="text-sm text-muted-foreground">{canReceive(order) ? "Nenhuma mercadoria recebida ainda." : draft ? "Aprove o pedido para poder receber." : "Nenhum recebimento."}</p> : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/30"><tr><th className={TH}>Recebimento</th><th className={TH}>Data</th><th className={TH}>NF</th><th className={TH}>Status</th><th className={`${TH} text-right`}>Valor</th></tr></thead>
              <tbody className="divide-y">
                {orderReceipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td className={TD}><Link className="font-medium hover:underline" to={`/purchasing/recebimentos?rec=${receipt.id}`}>{formatSequence("goods_receipts", receipt.number)}</Link></td>
                    <td className={`${TD} text-muted-foreground`}>{formatDay(receipt.received_at)}</td>
                    <td className={`${TD} text-muted-foreground`}>{receipt.supplier_invoice_number ?? "—"}</td>
                    <td className={TD}><StatusBadge status={receipt.status} /></td>
                    <td className={`${TD} text-right tabular-nums`}>{formatCurrency(Number(receipt.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {canSeePayables && (
        <Section title="Contas a pagar">
          {orderPayables.length === 0 ? <p className="text-sm text-muted-foreground">As contas a pagar nascem no recebimento.</p> : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-muted/30"><tr><th className={TH}>Descrição</th><th className={TH}>Vencimento</th><th className={TH}>Status</th><th className={`${TH} text-right`}>Valor</th></tr></thead>
                <tbody className="divide-y">
                  {orderPayables.map((payable) => (
                    <tr key={payable.id}>
                      <td className={TD}>{payable.description}</td>
                      <td className={`${TD} text-muted-foreground`}>{formatDay(payable.due_date)}</td>
                      <td className={TD}><StatusBadge status={payable.status} /></td>
                      <td className={`${TD} text-right tabular-nums`}>{formatCurrency(Number(payable.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      <Section title="Anexos">
        <FileAttachments entityType="purchase_order" entityId={orderId} canEdit={canEdit} />
      </Section>
    </div>
  );
}

/** Valor digitado no formato brasileiro ("1.234,56") pelo normalizador da importação; vazio vira 0. */
function moneyValue(label: string, raw: string): number {
  const parsed = normalizeValue("money", raw);
  if (!parsed.ok) fail(`${label}: ${parsed.reason}`);
  return parsed.value === null ? 0 : Number(parsed.value);
}

function HeaderForm({ order, suppliers, locations, label, onDone }: { order: PurchaseOrder; suppliers: Supplier[]; locations: StockLocation[]; label: string; onDone: () => void }) {
  const ctx = useEditContext();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    supplier_id: order.supplier_id ?? "",
    location_id: order.location_id ?? "",
    order_date: order.order_date?.slice(0, 10) ?? todayIso(),
    expected_date: order.expected_date?.slice(0, 10) ?? "",
    installments: String(order.installments ?? 1),
    payment_terms: order.payment_terms ?? "",
    discount: Number(order.discount) ? String(order.discount).replace(".", ",") : "",
    shipping: Number(order.shipping) ? String(order.shipping).replace(".", ",") : "",
    notes: order.notes ?? "",
  });
  const change = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const save = useMutation({
    mutationFn: async () => {
      const installments = normalizeValue("int", form.installments);
      if (!installments.ok) fail(`Parcelas: ${installments.reason}`);
      const patch: Partial<PurchaseOrderRow> & { id: string } = {
        id: order.id,
        supplier_id: form.supplier_id || null,
        location_id: form.location_id || null,
        order_date: form.order_date || null,
        expected_date: form.expected_date || null,
        installments: installments.value === null ? 1 : Number(installments.value),
        payment_terms: form.payment_terms,
        discount: moneyValue("Desconto", form.discount),
        shipping: moneyValue("Frete", form.shipping),
        notes: form.notes,
      };
      await savePurchaseOrderChanges(await getDb(), ctx, { updated: [patch], created: [] });
    },
    onSuccess: () => {
      invalidateTrade(qc);
      onDone();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form aria-label={`Dados do pedido ${label}`} onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Fornecedor" className="sm:col-span-2">
          <select value={form.supplier_id} onChange={(event) => change({ supplier_id: event.target.value })} className={INPUT}>
            <option value="">A definir</option>
            {suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}{row.document ? ` · ${row.document}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Local de entrada no estoque" className="sm:col-span-2">
          <select value={form.location_id} onChange={(event) => change({ location_id: event.target.value })} className={INPUT}>
            <option value="">Escolher no recebimento</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </Field>
        <Field label="Data do pedido"><input type="date" value={form.order_date} onChange={(event) => change({ order_date: event.target.value })} className={INPUT} /></Field>
        <Field label="Previsão de entrega"><input type="date" value={form.expected_date} onChange={(event) => change({ expected_date: event.target.value })} className={INPUT} /></Field>
        <Field label="Parcelas a pagar"><input inputMode="numeric" value={form.installments} onChange={(event) => change({ installments: event.target.value })} className={INPUT} /></Field>
        <Field label="Condição de pagamento"><input value={form.payment_terms} placeholder="Ex.: 28 dias" onChange={(event) => change({ payment_terms: event.target.value })} className={INPUT} /></Field>
        <Field label="Desconto do pedido (R$)"><input inputMode="decimal" value={form.discount} placeholder="0,00" onChange={(event) => change({ discount: event.target.value })} className={INPUT} /></Field>
        <Field label="Frete (R$)"><input inputMode="decimal" value={form.shipping} placeholder="0,00" onChange={(event) => change({ shipping: event.target.value })} className={INPUT} /></Field>
        <Field label="Observações" className="sm:col-span-2 lg:col-span-4">
          <textarea rows={2} value={form.notes} onChange={(event) => change({ notes: event.target.value })} className={`${INPUT} h-auto resize-none py-2`} />
        </Field>
      </div>
      <ErrorNote error={save.error} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={BUTTON} onClick={onDone}>Cancelar</button>
        <button type="submit" className={PRIMARY} disabled={save.isPending}>Salvar dados</button>
      </div>
    </form>
  );
}

interface ReceiveRow {
  lineId: string;
  qty: string;
  locationId: string;
}

function ReceivePanel({ order, items, locations, label, onDone }: { order: PurchaseOrder; items: PurchaseOrderItem[]; locations: StockLocation[]; label: string; onDone: () => void }) {
  const ctx = useEditContext();
  const qc = useQueryClient();
  const defaultLocation = order.location_id ?? locations[0]?.id ?? "";
  const [rows, setRows] = useState<ReceiveRow[]>(() => items.map((line) => ({ lineId: line.id, qty: String(remainingQty(line)), locationId: defaultLocation })));
  const [form, setForm] = useState({ receivedDate: todayIso(), supplierInvoiceNumber: "", installments: String(order.installments || 1), intervalDays: "30", firstDueDate: "", paymentMethod: "boleto" });
  const change = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  const receive = useMutation({
    mutationFn: async () => {
      const lines = rows.filter((row) => row.qty.trim() && num(row.qty, 0) !== 0).map((row) => ({ itemId: row.lineId, qty: num(row.qty, Number.NaN), locationId: row.locationId }));
      return receiveOrder(await getDb(), ctx, order.id, lines, {
        receivedDate: form.receivedDate || todayIso(),
        supplierInvoiceNumber: form.supplierInvoiceNumber,
        installments: num(form.installments, Number.NaN),
        firstDueDate: form.firstDueDate || undefined,
        intervalDays: num(form.intervalDays, 30),
        paymentMethod: form.paymentMethod || null,
      });
    },
    onSuccess: () => {
      invalidateTrade(qc);
      onDone();
    },
  });

  return (
    <InlinePanel title={`Receber mercadoria · ${label}`} onClose={onDone}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); receive.mutate(); }}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Data do recebimento"><input type="date" required value={form.receivedDate} onChange={(event) => change({ receivedDate: event.target.value })} className={INPUT} /></Field>
          <Field label="Nota fiscal do fornecedor"><input value={form.supplierInvoiceNumber} onChange={(event) => change({ supplierInvoiceNumber: event.target.value })} className={INPUT} /></Field>
          <Field label="Forma de pagamento">
            <select value={form.paymentMethod} onChange={(event) => change({ paymentMethod: event.target.value })} className={INPUT}>
              {PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
            </select>
          </Field>
          <Field label="Parcelas a pagar"><input inputMode="numeric" required value={form.installments} onChange={(event) => change({ installments: event.target.value })} className={INPUT} /></Field>
          <Field label="Dias entre parcelas"><input inputMode="numeric" value={form.intervalDays} onChange={(event) => change({ intervalDays: event.target.value })} className={INPUT} /></Field>
          <Field label="Primeiro vencimento (opcional)"><input type="date" value={form.firstDueDate} onChange={(event) => change({ firstDueDate: event.target.value })} className={INPUT} /></Field>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">O que chegou</p>
          {locations.length === 0 && <p className="text-sm text-destructive">Cadastre um local de estoque antes de receber.</p>}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-muted/30 text-xs"><tr><th className="px-3 py-2 text-left font-medium text-muted-foreground">Item</th><th className="px-3 py-2 text-right font-medium text-muted-foreground">Falta</th><th className="w-24 px-3 py-2 text-left font-medium text-muted-foreground">Recebido</th><th className="px-3 py-2 text-left font-medium text-muted-foreground">Local</th></tr></thead>
              <tbody className="divide-y">
                {rows.map((row) => {
                  const line = items.find((candidate) => candidate.id === row.lineId);
                  if (!line) return null;
                  const update = (patch: Partial<ReceiveRow>) => setRows((current) => current.map((candidate) => (candidate.lineId === row.lineId ? { ...candidate, ...patch } : candidate)));
                  return (
                    <tr key={row.lineId}>
                      <td className="px-3 py-2">{line.description}{!line.inventory_item_id && <span className="block text-xs text-muted-foreground">Sem item de estoque: não entra no estoque</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatQty(remainingQty(line))} {line.unit}</td>
                      <td className="px-3 py-2"><input aria-label={`Quantidade recebida de ${line.description}`} inputMode="decimal" value={row.qty} onChange={(event) => update({ qty: event.target.value })} className={`${INPUT} h-8 px-2`} /></td>
                      <td className="px-3 py-2">
                        <select aria-label={`Local de ${line.description}`} value={row.locationId} onChange={(event) => update({ locationId: event.target.value })} className={`${INPUT} h-8 px-2`}>
                          <option value="">Escolha...</option>
                          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Deixe 0 ou vazio no que não chegou. O custo médio do item é atualizado e as contas a pagar (valor proporcional ao recebido) vão para o Financeiro.</p>
        </div>

        <ErrorNote error={receive.error} />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BUTTON} onClick={onDone}>Voltar</button>
          <button type="submit" className={PRIMARY} disabled={receive.isPending}><PackageCheck size={14} aria-hidden="true" /> Confirmar recebimento</button>
        </div>
      </form>
    </InlinePanel>
  );
}

function CancelPanel({ orderId, label, onDone }: { orderId: string; label: string; onDone: () => void }) {
  const ctx = useEditContext();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const cancel = useMutation({
    mutationFn: async () => cancelOrder(await getDb(), ctx, orderId, reason),
    onSuccess: () => {
      invalidateTrade(qc);
      onDone();
    },
  });
  return (
    <InlinePanel title={`Cancelar pedido ${label}?`} onClose={onDone}>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); cancel.mutate(); }}>
        <Field label="Motivo">
          <textarea rows={2} required value={reason} onChange={(event) => setReason(event.target.value)} className={`${INPUT} h-auto resize-none py-2`} />
        </Field>
        <p className="text-xs text-muted-foreground">O pedido fica no histórico como cancelado. Com mercadoria recebida, estorne os recebimentos antes.</p>
        <ErrorNote error={cancel.error} />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={BUTTON} onClick={onDone}>Voltar</button>
          <button type="submit" className={DANGER} disabled={cancel.isPending}><Ban size={14} aria-hidden="true" /> Cancelar pedido</button>
        </div>
      </form>
    </InlinePanel>
  );
}
