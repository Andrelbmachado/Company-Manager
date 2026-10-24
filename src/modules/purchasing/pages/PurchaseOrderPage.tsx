import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Ban, Check, PackageCheck, Pencil, Send, Trash2, Truck } from "lucide-react";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { FileAttachments } from "@/components/shared/FileAttachments";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import {
  approvePurchaseOrder,
  canReceive,
  cancelPurchaseOrder,
  createPurchaseOrder,
  deletePurchaseOrder,
  loadPurchaseOrder,
  loadPurchaseOrderItems,
  receivePurchaseOrder,
  remainingQty,
  sendPurchaseOrder,
  updatePurchaseOrder,
} from "@/lib/erp/receiving";
import { formatQty } from "@/lib/erp/stockPosting";
import { errorMessage } from "@/lib/erp/tradeDb";
import { emit } from "@/lib/events/bus";
import { formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { DocumentItemsTable } from "@/modules/catalog/components/DocumentItemsTable";
import { TotalsSummary, newLine } from "@/modules/catalog/components/LineItemsEditor";
import {
  BUTTON,
  DANGER,
  ErrorNote,
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
  useGoodsReceipts,
  useLocations,
  usePayables,
  useSuppliers,
} from "@/modules/catalog/components/tradeKit";
import { PurchaseOrderEditor, emptyPurchaseOrderForm, purchaseLinesFrom, purchaseOrderFormFrom } from "../components/PurchaseOrderEditor";
import type { PurchaseOrderItem } from "@/types";

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
  const session = useRequiredSession();
  const companyId = session.company.id;
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
            const orderId = await createPurchaseOrder(db, { ...input, companyId, userId: session.user.id });
            const order = await loadPurchaseOrder(db, orderId, companyId);
            await emit({ type: "purchase_order.created", companyId, actorId: session.user.id, entityType: "purchase_order", entityId: orderId, title: `Pedido de compra ${formatSequence("purchase_orders", order.number)} criado (${formatCurrency(Number(order.total))})`, module: "purchasing" });
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

type Dialog = "receive" | "cancel" | "delete" | null;

interface ReceiveRow {
  lineId: string;
  qty: string;
  locationId: string;
}

function ExistingPurchaseOrder({ orderId }: { orderId: string }) {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canEdit = usePermission("edit", "purchase_orders");
  const canDelete = usePermission("delete", "purchase_orders");
  const canApprove = usePermission("approve", "purchase_orders");
  const canReceiveGoods = usePermission("receive", "purchase_orders");
  const canSeePayables = usePermission("view", "payables");
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [receiveRows, setReceiveRows] = useState<ReceiveRow[]>([]);

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
  const items = query.data?.items ?? [];
  const label = order ? formatSequence("purchase_orders", order.number) : "Pedido de compra";

  async function log(type: string, title: string, entityType = "purchase_order", entityId = orderId) {
    await emit({ type, companyId, actorId: session.user.id, entityType, entityId, title, module: "purchasing" });
  }

  const approve = useMutation({
    mutationFn: async () => {
      await approvePurchaseOrder(await getDb(), orderId, { companyId, userId: session.user.id });
      await log("purchase_order.approved", `Pedido de compra ${label} aprovado`);
    },
    onSuccess: () => invalidateTrade(qc),
  });

  const send = useMutation({
    mutationFn: async () => {
      await sendPurchaseOrder(await getDb(), orderId, { companyId, userId: session.user.id });
      await log("purchase_order.sent", `Pedido de compra ${label} enviado ao fornecedor`);
    },
    onSuccess: () => invalidateTrade(qc),
  });

  const receive = useMutation({
    mutationFn: async () => {
      const lines = receiveRows.filter((row) => row.qty.trim() && num(row.qty, 0) !== 0).map((row) => ({ itemId: row.lineId, qty: num(row.qty, Number.NaN), locationId: row.locationId }));
      const result = await receivePurchaseOrder(await getDb(), orderId, lines, {
        companyId,
        userId: session.user.id,
        receivedDate: form.receivedDate || todayIso(),
        supplierInvoiceNumber: form.supplierInvoiceNumber,
        installments: num(form.installments, Number.NaN),
        firstDueDate: form.firstDueDate || undefined,
        intervalDays: num(form.intervalDays, 30),
        paymentMethod: form.paymentMethod || null,
        notes: form.notes,
      });
      await log("goods_receipt.created", `Recebimento do pedido ${label}${form.supplierInvoiceNumber ? ` (NF ${form.supplierInvoiceNumber})` : ""}: ${result.movementIds.length} entrada(s) no estoque, ${result.payableIds.length} conta(s) a pagar`, "goods_receipt", result.receiptId);
      return result;
    },
    onSuccess: () => {
      invalidateTrade(qc);
      setDialog(null);
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      await cancelPurchaseOrder(await getDb(), orderId, { companyId, userId: session.user.id, reason: form.reason ?? "" });
      await log("purchase_order.cancelled", `Pedido de compra ${label} cancelado: ${form.reason?.trim()}`);
    },
    onSuccess: () => {
      invalidateTrade(qc);
      setDialog(null);
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      await deletePurchaseOrder(await getDb(), orderId, { companyId, userId: session.user.id });
      await log("purchase_order.deleted", `Pedido de compra ${label} excluído`);
    },
    onSuccess: () => {
      invalidateTrade(qc);
      navigate("/purchasing", { replace: true });
    },
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
  const editable = canEdit && order.status === "rascunho";
  const showApprove = canApprove && order.status === "rascunho";
  const showSend = canEdit && order.status === "aprovado";
  const showReceive = canReceiveGoods && canReceive(order) && pendingLines.length > 0;
  const showCancel = canEdit && (order.status === "rascunho" || order.status === "aprovado" || order.status === "enviado") && !orderReceipts.some((receipt) => receipt.status !== "estornado");
  const showDelete = canDelete && order.status === "rascunho";

  function openReceive() {
    if (!order) return;
    for (const mutation of [receive, cancel, remove]) mutation.reset();
    const defaultLocation = order.location_id ?? locations[0]?.id ?? "";
    setReceiveRows(pendingLines.map((line) => ({ lineId: line.id, qty: String(remainingQty(line)), locationId: defaultLocation })));
    setForm({ receivedDate: todayIso(), supplierInvoiceNumber: "", installments: String(order.installments || 1), intervalDays: "30", firstDueDate: "", paymentMethod: "boleto", notes: "" });
    setDialog("receive");
  }

  function openSimple(next: "cancel" | "delete") {
    for (const mutation of [receive, cancel, remove]) mutation.reset();
    setForm({ reason: "" });
    setDialog(next);
  }

  if (editing && editable) {
    return (
      <div className="space-y-5">
        <BackLink />
        <PageHeader title={`Editar pedido ${label}`} description="Rascunho: depois de aprovado, o pedido não muda mais (cancele e crie outro)." />
        <PurchaseOrderEditor
          companyId={companyId}
          initialForm={purchaseOrderFormFrom(order)}
          initialLines={purchaseLinesFrom(items)}
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            await updatePurchaseOrder(await getDb(), orderId, { ...input, companyId, userId: session.user.id });
            await log("purchase_order.updated", `Pedido de compra ${label} alterado`);
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
        title={`Pedido de compra ${label}`}
        description={supplier ? `${supplier.name} · ${formatDay(order.order_date)}` : formatDay(order.order_date)}
        actions={
          <>
            {editable && <button type="button" className={BUTTON} onClick={() => setEditing(true)}><Pencil size={14} /> Editar</button>}
            {showApprove && <button type="button" className={PRIMARY} disabled={approve.isPending} onClick={() => approve.mutate()}><Check size={14} /> Aprovar</button>}
            {showSend && <button type="button" className={BUTTON} disabled={send.isPending} onClick={() => send.mutate()}><Send size={14} /> Marcar como enviado</button>}
            {showReceive && <button type="button" className={PRIMARY} onClick={openReceive}><PackageCheck size={14} /> Receber mercadoria</button>}
            {showCancel && <button type="button" className={DANGER} onClick={() => openSimple("cancel")}><Ban size={14} /> Cancelar</button>}
            {showDelete && <button type="button" className={DANGER} onClick={() => openSimple("delete")}><Trash2 size={14} /> Excluir</button>}
          </>
        }
      />
      <ErrorNote error={approve.error ?? send.error} />
      {order.status === "rascunho" && !canApprove && <p className="text-sm text-muted-foreground">Aguardando aprovação da gerência.</p>}

      <div className="grid gap-5 rounded-xl border bg-card p-5 lg:grid-cols-[1fr_auto]">
        <DetailGrid>
          <DetailItem label="Status" value={<StatusBadge status={order.status} />} />
          <DetailItem label="Fornecedor" value={supplier?.name ?? "Fornecedor removido"} />
          <DetailItem label="Data do pedido" value={formatDay(order.order_date)} />
          <DetailItem label="Previsão de entrega" value={formatDay(order.expected_date)} />
          <DetailItem label="Local de entrada" value={order.location_id ? locationsById.get(order.location_id)?.name : "Escolher no recebimento"} />
          <DetailItem label="Condição de pagamento" value={order.payment_terms} />
          <DetailItem label="Parcelas" value={String(order.installments ?? 1)} />
          {order.approved_at && <DetailItem label="Aprovado em" value={formatDay(order.approved_at)} />}
          {order.sent_at && <DetailItem label="Enviado em" value={formatDay(order.sent_at)} />}
          {order.received_at && <DetailItem label="Recebido em" value={formatDay(order.received_at)} />}
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

      <Section title="Itens">
        <DocumentItemsTable<PurchaseOrderItem> items={items} priceLabel="Custo unit." extra={[{ header: "Recebido", cell: (line) => `${formatQty(Number(line.received_qty ?? 0))} de ${formatQty(Number(line.qty))}` }]} />
      </Section>

      {order.notes && <DetailItem label="Observações" value={<p className="whitespace-pre-wrap">{order.notes}</p>} />}

      <Section title="Recebimentos">
        {orderReceipts.length === 0 ? <p className="text-sm text-muted-foreground">{canReceive(order) ? "Nenhuma mercadoria recebida ainda." : order.status === "rascunho" ? "Aprove o pedido para poder receber." : "Nenhum recebimento."}</p> : (
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

      {dialog === "receive" && (
        <CrudDialog
          title={`Receber mercadoria · ${label}`}
          fields={[
            { key: "receivedDate", label: "Data do recebimento", type: "date", required: true },
            { key: "supplierInvoiceNumber", label: "Nota fiscal do fornecedor" },
            { key: "installments", label: "Parcelas a pagar", type: "number", required: true },
            { key: "intervalDays", label: "Dias entre parcelas", type: "number" },
            { key: "firstDueDate", label: "Primeiro vencimento (opcional)", type: "date" },
            { key: "paymentMethod", label: "Forma de pagamento", type: "select", options: PAYMENT_METHODS.map((method) => ({ value: method.value, label: method.label })) },
          ]}
          values={form}
          onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
          onClose={() => setDialog(null)}
          onSubmit={() => receive.mutate()}
          busy={receive.isPending}
          submitLabel="Confirmar recebimento"
        >
          <div className="mt-5 space-y-2">
            <p className="text-sm font-medium">O que chegou</p>
            {locations.length === 0 && <p className="text-sm text-destructive">Cadastre um local de estoque antes de receber.</p>}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-muted/30 text-xs"><tr><th className="px-3 py-2 text-left font-medium text-muted-foreground">Item</th><th className="px-3 py-2 text-right font-medium text-muted-foreground">Falta</th><th className="w-24 px-3 py-2 text-left font-medium text-muted-foreground">Recebido</th><th className="px-3 py-2 text-left font-medium text-muted-foreground">Local</th></tr></thead>
                <tbody className="divide-y">
                  {receiveRows.map((row) => {
                    const line = items.find((candidate) => candidate.id === row.lineId);
                    if (!line) return null;
                    const update = (patch: Partial<ReceiveRow>) => setReceiveRows((current) => current.map((candidate) => (candidate.lineId === row.lineId ? { ...candidate, ...patch } : candidate)));
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
          <ErrorNote error={receive.error} className="mt-3" />
        </CrudDialog>
      )}

      {dialog === "cancel" && (
        <CrudDialog title={`Cancelar pedido ${label}?`} fields={[{ key: "reason", label: "Motivo", type: "textarea", required: true }]} values={form} onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} onClose={() => setDialog(null)} onSubmit={() => cancel.mutate()} busy={cancel.isPending} submitLabel="Cancelar pedido">
          <p className="mt-3 text-xs text-muted-foreground">O pedido fica no histórico como cancelado. Com mercadoria recebida, estorne os recebimentos antes.</p>
          <ErrorNote error={cancel.error} className="mt-3" />
        </CrudDialog>
      )}

      {dialog === "delete" && (
        <CrudDialog title={`Excluir rascunho ${label}?`} fields={[]} values={{}} onChange={() => undefined} onClose={() => setDialog(null)} onSubmit={() => remove.mutate()} busy={remove.isPending} submitLabel="Excluir">
          <p className="text-sm text-muted-foreground">O rascunho e os itens saem da lista. O número {label} não é reaproveitado.</p>
          <ErrorNote error={remove.error} className="mt-3" />
        </CrudDialog>
      )}
    </div>
  );
}
