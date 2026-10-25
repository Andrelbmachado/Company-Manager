import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Truck } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { formatSequence } from "@/lib/db/sequence";
import { sumMoney } from "@/lib/money";
import { formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { INPUT, LoadingRows, PRIMARY, TD, TH, byId, useGoodsReceipts, usePurchaseOrders, useSuppliers } from "@/modules/catalog/components/tradeKit";
import type { PurchaseOrderStatus } from "@/types";

const FILTERS: Array<{ value: "abertos" | "todos" | PurchaseOrderStatus; label: string }> = [
  { value: "abertos", label: "Em andamento" },
  { value: "todos", label: "Todos" },
  { value: "rascunho", label: "Rascunho" },
  { value: "aprovado", label: "Aprovado" },
  { value: "enviado", label: "Enviado" },
  { value: "recebido_parcial", label: "Recebido em parte" },
  { value: "recebido", label: "Recebido" },
  { value: "cancelado", label: "Cancelado" },
];

const OPEN = new Set<PurchaseOrderStatus>(["rascunho", "aprovado", "enviado", "recebido_parcial"]);

export default function PurchasingPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const navigate = useNavigate();
  const canCreate = usePermission("create", "purchase_orders");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("abertos");
  const { data: orders = [], isLoading } = usePurchaseOrders(companyId);
  const { data: suppliers = [] } = useSuppliers(companyId);
  const { data: receipts = [] } = useGoodsReceipts(companyId);
  const suppliersById = useMemo(() => byId(suppliers), [suppliers]);
  const today = todayIso();
  const month = today.slice(0, 7);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (filter === "abertos" ? !OPEN.has(order.status) : filter !== "todos" && order.status !== filter) return false;
      if (!term) return true;
      const supplier = order.supplier_id ? suppliersById.get(order.supplier_id)?.name ?? "" : "";
      return formatSequence("purchase_orders", order.number).toLowerCase().includes(term) || supplier.toLowerCase().includes(term);
    });
  }, [orders, filter, search, suppliersById]);

  const awaitingApproval = orders.filter((order) => order.status === "rascunho");
  const awaitingGoods = orders.filter((order) => order.status === "aprovado" || order.status === "enviado" || order.status === "recebido_parcial");
  const late = awaitingGoods.filter((order) => order.expected_date && order.expected_date.slice(0, 10) < today);
  const receivedThisMonth = receipts.filter((receipt) => receipt.status !== "estornado" && receipt.received_at && todayIso(new Date(receipt.received_at)).slice(0, 7) === month);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Compras"
        description="Pedidos de compra: aprovação, envio ao fornecedor e recebimento com entrada no estoque e contas a pagar."
        actions={canCreate ? <button type="button" className={PRIMARY} onClick={() => navigate("/purchasing/pedidos/nova")}><Plus size={14} /> Novo pedido</button> : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Aguardando aprovação" value={awaitingApproval.length} />
        <StatCard title="A receber" value={awaitingGoods.length} />
        <StatCard title="Entrega atrasada" value={late.length} />
        <StatCard title="Recebido no mês" value={formatCurrency(sumMoney(receivedThisMonth.map((receipt) => Number(receipt.total))))} />
      </div>

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por número ou fornecedor...">
        <select aria-label="Filtrar por status" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className={`${INPUT} w-48`}>
          {FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </PageToolbar>

      {isLoading ? <LoadingRows /> : filtered.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={orders.length ? "Nenhum pedido neste filtro" : "Nenhum pedido de compra"}
          description={orders.length ? "Mude o status ou a busca." : "Crie um pedido, aprove e receba a mercadoria: o estoque e as contas a pagar são atualizados juntos."}
          action={!orders.length && canCreate ? <button type="button" className={PRIMARY} onClick={() => navigate("/purchasing/pedidos/nova")}><Plus size={14} /> Novo pedido</button> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className={TH}>Pedido</th>
                <th className={TH}>Fornecedor</th>
                <th className={TH}>Data</th>
                <th className={TH}>Previsão</th>
                <th className={TH}>Status</th>
                <th className={`${TH} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((order) => {
                const isLate = OPEN.has(order.status) && order.status !== "rascunho" && order.expected_date && order.expected_date.slice(0, 10) < today;
                return (
                  <tr key={order.id} className="cursor-pointer transition-colors hover:bg-muted/20" onClick={() => navigate(`/purchasing/pedidos/${order.id}`)}>
                    <td className={TD}>
                      <button type="button" className="font-medium hover:underline" onClick={(event) => { event.stopPropagation(); navigate(`/purchasing/pedidos/${order.id}`); }}>{formatSequence("purchase_orders", order.number)}</button>
                    </td>
                    <td className={TD}>{order.supplier_id ? suppliersById.get(order.supplier_id)?.name ?? "Fornecedor removido" : "—"}</td>
                    <td className={`${TD} text-muted-foreground`}>{formatDay(order.order_date)}</td>
                    <td className={`${TD} ${isLate ? "text-destructive" : "text-muted-foreground"}`}>{formatDay(order.expected_date)}</td>
                    <td className={TD}><StatusBadge status={order.status} /></td>
                    <td className={`${TD} text-right font-medium tabular-nums`}>{formatCurrency(Number(order.total))}</td>
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
