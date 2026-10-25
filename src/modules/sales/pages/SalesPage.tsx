import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, ShoppingCart } from "lucide-react";
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
import { INPUT, LoadingRows, PRIMARY, TD, TH, byId, useCustomers, useSalesOrders } from "@/modules/catalog/components/tradeKit";
import type { SalesOrder, SalesOrderStatus } from "@/types";

const STATUS_OPTIONS: Array<{ value: "todos" | "abertos" | SalesOrderStatus; label: string }> = [
  { value: "abertos", label: "Em andamento" },
  { value: "todos", label: "Todos" },
  { value: "rascunho", label: "Rascunho" },
  { value: "confirmado", label: "Confirmado" },
  { value: "faturado", label: "Faturado" },
  { value: "entregue", label: "Entregue" },
  { value: "cancelado", label: "Cancelado" },
];

/** Em andamento: falta confirmar, faturar ou entregar. */
function isOpen(order: Pick<SalesOrder, "status" | "invoiced_at">): boolean {
  return order.status === "rascunho" || order.status === "confirmado" || order.status === "faturado" || (order.status === "entregue" && !order.invoiced_at);
}

export default function SalesPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const navigate = useNavigate();
  const canCreate = usePermission("create", "sales_orders");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]["value"]>("abertos");
  const { data: orders = [], isLoading } = useSalesOrders(companyId);
  const { data: customers = [] } = useCustomers(companyId);
  const customersById = useMemo(() => byId(customers), [customers]);
  const month = todayIso().slice(0, 7);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (status === "abertos" ? !isOpen(order) : status !== "todos" && order.status !== status) return false;
      if (!term) return true;
      const customer = order.customer_id ? customersById.get(order.customer_id)?.name ?? "" : "";
      return formatSequence("sales_orders", order.number).toLowerCase().includes(term) || String(order.number) === term || customer.toLowerCase().includes(term);
    });
  }, [orders, status, search, customersById]);

  const live = orders.filter((order) => order.status !== "cancelado");
  const drafts = orders.filter((order) => order.status === "rascunho");
  const toInvoice = orders.filter((order) => (order.status === "confirmado" || order.status === "entregue") && !order.invoiced_at);
  const toDeliver = orders.filter((order) => order.status === "confirmado" || order.status === "faturado");
  const monthSales = live.filter((order) => order.status !== "rascunho" && order.order_date?.slice(0, 7) === month);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vendas"
        description="Pedidos de venda: confirmação, faturamento em parcelas (contas a receber) e entrega com baixa no estoque."
        actions={canCreate ? <button type="button" className={PRIMARY} onClick={() => navigate("/sales/pedidos/nova")}><Plus size={14} /> Novo pedido</button> : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Vendido no mês" value={formatCurrency(sumMoney(monthSales.map((order) => Number(order.total))))} />
        <StatCard title="Rascunhos" value={drafts.length} />
        <StatCard title="A faturar" value={toInvoice.length} />
        <StatCard title="A entregar" value={toDeliver.length} />
      </div>

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por número ou cliente...">
        <select aria-label="Filtrar por status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className={`${INPUT} w-44`}>
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </PageToolbar>

      {isLoading ? <LoadingRows /> : filtered.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title={orders.length ? "Nenhum pedido neste filtro" : "Nenhum pedido de venda"}
          description={orders.length ? "Mude o status ou a busca." : "Crie um pedido, confirme e fature: as parcelas vão para contas a receber."}
          action={!orders.length && canCreate ? <button type="button" className={PRIMARY} onClick={() => navigate("/sales/pedidos/nova")}><Plus size={14} /> Novo pedido</button> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className={TH}>Pedido</th>
                <th className={TH}>Cliente</th>
                <th className={TH}>Data</th>
                <th className={TH}>Entrega</th>
                <th className={TH}>Status</th>
                <th className={`${TH} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((order) => (
                <tr key={order.id} className="cursor-pointer transition-colors hover:bg-muted/20" onClick={() => navigate(`/sales/pedidos/${order.id}`)}>
                  <td className={TD}>
                    <button type="button" className="font-medium hover:underline" onClick={(event) => { event.stopPropagation(); navigate(`/sales/pedidos/${order.id}`); }}>{formatSequence("sales_orders", order.number)}</button>
                  </td>
                  <td className={TD}>{order.customer_id ? customersById.get(order.customer_id)?.name ?? "Cliente removido" : "—"}</td>
                  <td className={`${TD} text-muted-foreground`}>{formatDay(order.order_date)}</td>
                  <td className={`${TD} text-muted-foreground`}>{order.delivered_at ? `Entregue ${formatDay(order.delivered_at)}` : formatDay(order.delivery_date)}</td>
                  <td className={TD}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={order.status} />
                      {order.status === "entregue" && order.invoiced_at && <StatusBadge status="faturado" />}
                    </span>
                  </td>
                  <td className={`${TD} text-right font-medium tabular-nums`}>{formatCurrency(Number(order.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
