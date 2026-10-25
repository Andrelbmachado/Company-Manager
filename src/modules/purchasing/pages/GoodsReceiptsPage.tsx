import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { PackageCheck, Undo2 } from "lucide-react";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { DetailDrawer, DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { reverseGoodsReceipt } from "@/lib/erp/receiving";
import { formatQty } from "@/lib/erp/stockPosting";
import { activeRowsBy } from "@/lib/erp/tradeDb";
import { emit } from "@/lib/events/bus";
import { lineTotal } from "@/lib/money";
import { formatCurrency, formatDay } from "@/lib/utils";
import { DANGER, ErrorNote, INPUT, LoadingRows, TD, TH, byId, invalidateTrade, useGoodsReceipts, useInventoryItems, useLocations, usePayables, usePurchaseOrders, useSuppliers } from "@/modules/catalog/components/tradeKit";
import type { GoodsReceipt, GoodsReceiptItem } from "@/types";

export default function GoodsReceiptsPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const canReverse = usePermission("receive", "purchase_orders");
  const canSeePayables = usePermission("view", "payables");
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"todos" | "conferido" | "estornado">("todos");
  const [confirmReverse, setConfirmReverse] = useState(false);

  const { data: receipts = [], isLoading } = useGoodsReceipts(companyId);
  const { data: orders = [] } = usePurchaseOrders(companyId);
  const { data: suppliers = [] } = useSuppliers(companyId);
  const { data: locations = [] } = useLocations(companyId);
  const { data: stockItems = [] } = useInventoryItems(companyId);
  const { data: payables = [] } = usePayables(companyId, canSeePayables);
  const ordersById = useMemo(() => byId(orders), [orders]);
  const suppliersById = useMemo(() => byId(suppliers), [suppliers]);
  const locationsById = useMemo(() => byId(locations), [locations]);
  const stockById = useMemo(() => byId(stockItems), [stockItems]);

  const selectedId = params.get("rec");
  const selected = receipts.find((receipt) => receipt.id === selectedId) ?? null;
  const { data: selectedItems = [] } = useQuery({
    queryKey: ["goods_receipts", companyId, selectedId, "items"],
    enabled: Boolean(selectedId),
    queryFn: async () => activeRowsBy<GoodsReceiptItem>(await getDb(), "goods_receipt_items", companyId, "receipt_id", selectedId!),
  });

  function select(id: string | null) {
    const next = new URLSearchParams(params);
    if (id) next.set("rec", id);
    else next.delete("rec");
    setParams(next, { replace: true });
  }

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

  const reverse = useMutation({
    mutationFn: async (receipt: GoodsReceipt) => {
      await reverseGoodsReceipt(await getDb(), receipt.id, { companyId, userId: session.user.id });
      await emit({ type: "goods_receipt.reversed", companyId, actorId: session.user.id, entityType: "goods_receipt", entityId: receipt.id, title: `Recebimento ${formatSequence("goods_receipts", receipt.number)} estornado`, module: "purchasing" });
    },
    onSuccess: () => {
      invalidateTrade(qc);
      setConfirmReverse(false);
    },
  });

  const selectedOrder = selected?.purchase_order_id ? ordersById.get(selected.purchase_order_id) : undefined;
  const selectedPayables = selected ? payables.filter((payable) => payable.goods_receipt_id === selected.id) : [];

  return (
    <div className="space-y-5">
      <PageHeader title="Recebimentos" description="Entradas de mercadoria dos pedidos de compra, com a entrada no estoque e as contas a pagar geradas. Para receber, abra o pedido de compra." />
      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por recebimento, pedido, fornecedor ou NF...">
        <select aria-label="Filtrar por status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className={`${INPUT} w-40`}>
          <option value="todos">Todos</option>
          <option value="conferido">Conferidos</option>
          <option value="estornado">Estornados</option>
        </select>
      </PageToolbar>

      {isLoading ? <LoadingRows /> : filtered.length === 0 ? (
        <EmptyState icon={PackageCheck} title={receipts.length ? "Nenhum recebimento neste filtro" : "Nenhum recebimento"} description={receipts.length ? "Mude a busca ou o status." : "Os recebimentos aparecem aqui quando a mercadoria de um pedido de compra aprovado chega."} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className={TH}>Recebimento</th>
                <th className={TH}>Pedido</th>
                <th className={TH}>Fornecedor</th>
                <th className={TH}>Data</th>
                <th className={TH}>NF</th>
                <th className={TH}>Status</th>
                <th className={`${TH} text-right`}>Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((receipt) => {
                const order = receipt.purchase_order_id ? ordersById.get(receipt.purchase_order_id) : undefined;
                return (
                  <tr key={receipt.id} className="cursor-pointer transition-colors hover:bg-muted/20" onClick={() => select(receipt.id)}>
                    <td className={TD}><button type="button" className="font-medium hover:underline" onClick={(event) => { event.stopPropagation(); select(receipt.id); }}>{formatSequence("goods_receipts", receipt.number)}</button></td>
                    <td className={`${TD} text-muted-foreground`}>{order ? formatSequence("purchase_orders", order.number) : "—"}</td>
                    <td className={TD}>{receipt.supplier_id ? suppliersById.get(receipt.supplier_id)?.name ?? "Fornecedor removido" : "—"}</td>
                    <td className={`${TD} text-muted-foreground`}>{formatDay(receipt.received_at)}</td>
                    <td className={`${TD} text-muted-foreground`}>{receipt.supplier_invoice_number ?? "—"}</td>
                    <td className={TD}><StatusBadge status={receipt.status} /></td>
                    <td className={`${TD} text-right font-medium tabular-nums`}>{formatCurrency(Number(receipt.total))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <DetailDrawer title={`Recebimento ${formatSequence("goods_receipts", selected.number)}`} subtitle={selected.supplier_id ? suppliersById.get(selected.supplier_id)?.name : "Recebimento"} onClose={() => select(null)}>
          <div className="space-y-6">
            <DetailGrid>
              <DetailItem label="Status" value={<StatusBadge status={selected.status} />} />
              <DetailItem label="Pedido de compra" value={selectedOrder ? <Link className="hover:underline" to={`/purchasing/pedidos/${selectedOrder.id}`}>{formatSequence("purchase_orders", selectedOrder.number)}</Link> : null} />
              <DetailItem label="Data" value={formatDay(selected.received_at)} />
              <DetailItem label="Nota fiscal" value={selected.supplier_invoice_number} />
              <DetailItem label="Valor" value={formatCurrency(Number(selected.total))} />
              {selected.reversed_at && <DetailItem label="Estornado em" value={formatDay(selected.reversed_at)} />}
            </DetailGrid>
            {selected.notes && <DetailItem label="Observações" value={<p className="whitespace-pre-wrap">{selected.notes}</p>} />}

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Itens recebidos</h3>
              {selectedItems.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum item.</p> : (
                <ul className="divide-y rounded-lg border text-sm">
                  {selectedItems.map((item) => {
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
                {selectedPayables.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma conta a pagar.</p> : (
                  <ul className="divide-y rounded-lg border text-sm">
                    {selectedPayables.map((payable) => (
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

            {canReverse && selected.status === "conferido" && (
              <div className="border-t pt-4">
                <button type="button" className={DANGER} onClick={() => { reverse.reset(); setConfirmReverse(true); }}><Undo2 size={14} /> Estornar recebimento</button>
              </div>
            )}
          </div>
        </DetailDrawer>
      )}

      {confirmReverse && selected && (
        <CrudDialog title={`Estornar ${formatSequence("goods_receipts", selected.number)}?`} fields={[]} values={{}} onChange={() => undefined} onClose={() => setConfirmReverse(false)} onSubmit={() => reverse.mutate(selected)} busy={reverse.isPending} submitLabel="Estornar">
          <p className="text-sm text-muted-foreground">A mercadoria sai do estoque, o pedido volta a esperar esses itens e as contas a pagar deste recebimento são canceladas. Não dá para estornar com conta já paga ou sem saldo no estoque.</p>
          <ErrorNote error={reverse.error} className="mt-3" />
        </CrudDialog>
      )}
    </div>
  );
}
