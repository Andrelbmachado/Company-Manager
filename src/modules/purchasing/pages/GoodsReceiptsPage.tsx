// Recebimentos editados na própria tabela: a linha nova recebe tudo o que falta do pedido escolhido (no local de entrada
// do pedido; para receber em parte ou escolher o local de cada item, use Receber mercadoria na tela do pedido), e nas
// linhas gravadas a nota fiscal e as observações mudam. A ficha (?rec=<id>) abre abaixo da lista, com o estorno.
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { FileText, Undo2 } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatusBadge, statusLabel } from "@/components/shared/StatusBadge";
import { usePermission } from "@/hooks/usePermission";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { canReceive } from "@/lib/erp/receiving";
import { formatQty } from "@/lib/erp/stockPosting";
import { activeRowsBy } from "@/lib/erp/tradeDb";
import { lineTotal } from "@/lib/money";
import { formatCurrency, formatDay } from "@/lib/utils";
import { BUTTON, ErrorNote, INPUT, byId, invalidateTrade, useGoodsReceipts, useInventoryItems, useLocations, usePayables, usePurchaseOrders, useSuppliers } from "@/modules/catalog/components/tradeKit";
import { ConfirmButton } from "@/modules/finance/components/financeShared";
import { InfoGrid, InfoItem, InlinePanel } from "@/modules/finance/components/inline";
import { useEditContext } from "@/modules/finance/data/useEditContext";
import type { GoodsReceipt, GoodsReceiptItem } from "@/types";
import { reverseReceipt } from "../data/orderActions";
import { receiptRow, saveReceiptChanges, type ReceiptRow } from "../data/receiptEditing";

export default function GoodsReceiptsPage() {
  const ctx = useEditContext();
  const companyId = ctx.companyId;
  const qc = useQueryClient();
  const canReverse = usePermission("receive", "purchase_orders");
  const canSeePayables = usePermission("view", "payables");
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"todos" | "conferido" | "estornado">("todos");

  const receiptsQuery = useGoodsReceipts(companyId);
  const { data: orders = [] } = usePurchaseOrders(companyId);
  const { data: suppliers = [] } = useSuppliers(companyId);
  const receipts = useMemo(() => receiptsQuery.data ?? [], [receiptsQuery.data]);
  const ordersById = useMemo(() => byId(orders), [orders]);
  const suppliersById = useMemo(() => byId(suppliers), [suppliers]);

  const selectedId = params.get("rec");
  const selected = receipts.find((receipt) => receipt.id === selectedId) ?? null;

  const select = useCallback((id: string | null) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set("rec", id);
      else next.delete("rec");
      return next;
    }, { replace: true });
  }, [setParams]);

  const supplierName = (id: string | null | undefined) => (id ? suppliersById.get(id)?.name ?? "Fornecedor removido" : null);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return receipts.filter((receipt) => {
      if (status !== "todos" && receipt.status !== status) return false;
      if (!term) return true;
      const order = receipt.purchase_order_id ? ordersById.get(receipt.purchase_order_id) : undefined;
      const supplier = receipt.supplier_id ? suppliersById.get(receipt.supplier_id)?.name ?? "" : "";
      return [formatSequence("goods_receipts", receipt.number), order ? formatSequence("purchase_orders", order.number) : "", supplier, receipt.supplier_invoice_number ?? ""].some((value) => value.toLowerCase().includes(term));
    });
  }, [receipts, status, search, ordersById, suppliersById]);
  const rows = filtered.map((receipt) => receiptRow(receipt, supplierName(receipt.supplier_id)));

  const columns = useMemo<EditableColumn<ReceiptRow>[]>(() => {
    // Pedidos que aparecem na lista (para ler) + os que ainda esperam mercadoria (para a linha nova).
    const orderOptions = orders
      .filter((order) => canReceive(order) || receipts.some((receipt) => receipt.purchase_order_id === order.id))
      .map((order) => ({ value: order.id, label: `${formatSequence("purchase_orders", order.number)} · ${order.supplier_id ? suppliersById.get(order.supplier_id)?.name ?? "Fornecedor removido" : "A definir"}${canReceive(order) ? "" : " (recebido)"}` }));
    return [
      {
        key: "number",
        header: "Recebimento",
        kind: "text",
        readOnly: true,
        render: (row) => <button type="button" className="font-medium hover:underline" onClick={() => select(row.id)}>{row.number}</button>,
      },
      {
        key: "purchase_order_id",
        header: "Pedido",
        kind: "select",
        required: true,
        width: 220,
        options: orderOptions,
        render: (row) => {
          const order = row.purchase_order_id ? ordersById.get(row.purchase_order_id) : undefined;
          return order ? <Link className="hover:underline" to={`/purchasing/pedidos/${order.id}`}>{formatSequence("purchase_orders", order.number)}</Link> : <span className="text-muted-foreground">—</span>;
        },
      },
      { key: "supplier", header: "Fornecedor", kind: "text", readOnly: true },
      { key: "received_at", header: "Data", kind: "date", readOnly: true },
      { key: "supplier_invoice_number", header: "NF", kind: "text", placeholder: "Nota fiscal" },
      { key: "status", header: "Status", kind: "select", readOnly: true, sortValue: (row) => (row.status ? statusLabel(row.status) : null), render: (row) => (row.status ? <StatusBadge status={row.status} /> : null) },
      { key: "total", header: "Valor", kind: "money", readOnly: true },
      { key: "notes", header: "Observações", kind: "text", width: 200 },
    ];
  }, [orders, receipts, ordersById, suppliersById, select]);

  async function save(changes: EditableTableChanges<ReceiptRow>) {
    await saveReceiptChanges(await getDb(), ctx, changes);
    invalidateTrade(qc);
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Recebimentos" />
      <EditableTable<ReceiptRow>
        actions={
          <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por recebimento, pedido, fornecedor ou NF...">
            <select aria-label="Filtrar por status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className={`${INPUT} w-40`}>
              <option value="todos">Todos</option>
              <option value="conferido">Conferidos</option>
              <option value="estornado">Estornados</option>
            </select>
          </PageToolbar>
        }
        resource="purchase_orders"
        label="Recebimentos"
        rows={rows}
        columns={columns}
        loading={receiptsQuery.isLoading}
        onSave={save}
        onRefresh={() => qc.invalidateQueries({ queryKey: ["goods_receipts", companyId] })}
        emptyMessage={receipts.length ? "Nenhum recebimento neste filtro" : "Nenhum recebimento"}
        rowActions={(row) => (
          <button type="button" className={BUTTON} onClick={() => select(row.id)} aria-label={`Ficha de ${row.number}`}>
            <FileText size={14} aria-hidden="true" /> Ficha
          </button>
        )}
      />

      {selected && (
        <ReceiptPanel
          key={selected.id}
          receipt={selected}
          supplier={supplierName(selected.supplier_id)}
          orderLabel={selected.purchase_order_id && ordersById.get(selected.purchase_order_id) ? formatSequence("purchase_orders", ordersById.get(selected.purchase_order_id)!.number) : null}
          canReverse={canReverse}
          canSeePayables={canSeePayables}
          onClose={() => select(null)}
        />
      )}
    </div>
  );
}

function ReceiptPanel({ receipt, supplier, orderLabel, canReverse, canSeePayables, onClose }: {
  receipt: GoodsReceipt;
  supplier: string | null;
  orderLabel: string | null;
  canReverse: boolean;
  canSeePayables: boolean;
  onClose: () => void;
}) {
  const ctx = useEditContext();
  const companyId = ctx.companyId;
  const qc = useQueryClient();
  const { data: locations = [] } = useLocations(companyId);
  const { data: stockItems = [] } = useInventoryItems(companyId);
  const { data: payables = [] } = usePayables(companyId, canSeePayables);
  const locationsById = useMemo(() => byId(locations), [locations]);
  const stockById = useMemo(() => byId(stockItems), [stockItems]);
  const { data: items = [] } = useQuery({
    queryKey: ["goods_receipts", companyId, receipt.id, "items"],
    queryFn: async () => activeRowsBy<GoodsReceiptItem>(await getDb(), "goods_receipt_items", companyId, "receipt_id", receipt.id),
  });
  const ownPayables = payables.filter((payable) => payable.goods_receipt_id === receipt.id);
  const label = formatSequence("goods_receipts", receipt.number);

  const reverse = useMutation({
    mutationFn: async () => reverseReceipt(await getDb(), ctx, receipt.id),
    onSuccess: () => invalidateTrade(qc),
  });

  return (
    <InlinePanel
      title={`Recebimento ${label}`}
      subtitle={supplier ?? "Recebimento"}
      onClose={onClose}
      actions={
        canReverse && receipt.status === "conferido" ? (
          <ConfirmButton label="Estornar recebimento" confirmLabel="Confirmar estorno" icon={<Undo2 size={14} aria-hidden="true" />} busy={reverse.isPending} onConfirm={() => reverse.mutate()} />
        ) : undefined
      }
    >
      <ErrorNote error={reverse.error} />
      <InfoGrid>
        <InfoItem label="Status" value={<StatusBadge status={receipt.status} />} />
        <InfoItem label="Pedido de compra" value={orderLabel && receipt.purchase_order_id ? <Link className="hover:underline" to={`/purchasing/pedidos/${receipt.purchase_order_id}`}>{orderLabel}</Link> : null} />
        <InfoItem label="Data" value={formatDay(receipt.received_at)} />
        <InfoItem label="Nota fiscal" value={receipt.supplier_invoice_number} />
        <InfoItem label="Valor" value={formatCurrency(Number(receipt.total))} />
        {receipt.reversed_at && <InfoItem label="Estornado em" value={formatDay(receipt.reversed_at)} />}
      </InfoGrid>
      {receipt.notes && <p className="whitespace-pre-wrap text-sm">{receipt.notes}</p>}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Itens recebidos</h3>
        {items.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum item.</p> : (
          <ul className="divide-y rounded-lg border text-sm">
            {items.map((item) => {
              const stockItem = item.inventory_item_id ? stockById.get(item.inventory_item_id) : undefined;
              return (
                <li key={item.id} className="space-y-0.5 px-3 py-2">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">{stockItem?.name ?? "Item sem estoque"}</span>
                    <span className="tabular-nums">{formatQty(Number(item.qty))} {stockItem?.unit ?? "un"}</span>
                  </div>
                  <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                    <span>{item.location_id ? locationsById.get(item.location_id)?.name ?? "Local removido" : "—"}</span>
                    <span className="tabular-nums">{formatCurrency(Number(item.unit_cost))} / un · {formatCurrency(lineTotal(Number(item.qty), Number(item.unit_cost)))}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canSeePayables && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Contas a pagar</h3>
          {ownPayables.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma conta a pagar.</p> : (
            <ul className="divide-y rounded-lg border text-sm">
              {ownPayables.map((payable) => (
                <li key={payable.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>{formatDay(payable.due_date)}</span>
                  <StatusBadge status={payable.status} />
                  <span className="tabular-nums">{formatCurrency(Number(payable.amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </InlinePanel>
  );
}
