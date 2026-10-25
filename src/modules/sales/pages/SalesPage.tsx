// Pedidos de venda numa tabela editável: Adicionar cria o rascunho (cliente, datas, condição) e os itens entram abrindo o
// pedido; Editar muda o cabeçalho de pedidos ainda sem fatura. A previsão de entrega também aparece no calendário.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { CalendarView, type CalendarItem } from "@/components/shared/CalendarView";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge, statusLabel } from "@/components/shared/StatusBadge";
import { useRequiredSession } from "@/hooks/useSession";
import { saveSalesOrderRows } from "@/lib/commercial/salesEdits";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { localDay } from "@/lib/erp/financeCommon";
import { emit } from "@/lib/events/bus";
import { useLabel } from "@/lib/labels/useLabel";
import { sumMoney } from "@/lib/money";
import { formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { ROW_ACTION, ViewSwitch, refreshTrade, useEditActor, type ListOrCalendar } from "@/modules/catalog/components/inline";
import { INPUT, byId, invalidateTrade, useCustomers, useSalesOrders } from "@/modules/catalog/components/tradeKit";
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
  const actor = useEditActor();
  const title = useLabel("module.sales");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]["value"]>("abertos");
  const [view, setView] = useState<ListOrCalendar>("lista");
  const [created, setCreated] = useState<string | null>(null);
  const { data: orders = [], isLoading } = useSalesOrders(companyId);
  const { data: customers = [] } = useCustomers(companyId);
  const customersById = useMemo(() => byId(customers), [customers]);
  const month = todayIso().slice(0, 7);
  const customerName = (order: Pick<SalesOrder, "customer_id">) => (order.customer_id ? customersById.get(order.customer_id)?.name ?? "Cliente removido" : "—");

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

  const columns: EditableColumn<SalesOrder>[] = [
    {
      key: "number",
      header: "Pedido",
      kind: "number",
      readOnly: true,
      render: (order) => (
        <button type="button" className="font-medium hover:underline" onClick={() => navigate(`/sales/pedidos/${order.id}`)}>
          {formatSequence("sales_orders", order.number)}
        </button>
      ),
    },
    { key: "customer_id", header: "Cliente", kind: "select", required: true, width: 220, options: customers.map((customer) => ({ value: customer.id, label: customer.name })), render: (order) => customerName(order) },
    { key: "order_date", header: "Data", kind: "date", required: true },
    { key: "delivery_date", header: "Entrega", kind: "date", render: (order) => <span className="text-muted-foreground">{order.delivered_at ? `Entregue ${formatDay(order.delivered_at)}` : formatDay(order.delivery_date)}</span> },
    { key: "payment_terms", header: "Condição", kind: "text", placeholder: "Ex.: 30/60 dias" },
    { key: "installments", header: "Parcelas", kind: "number", width: 80 },
    {
      key: "status",
      header: "Status",
      kind: "select",
      readOnly: true,
      sortValue: (order) => statusLabel(order.status),
      render: (order) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={order.status} />
          {order.status === "entregue" && order.invoiced_at && <StatusBadge status="faturado" />}
        </span>
      ),
    },
    { key: "total", header: "Total", kind: "money", readOnly: true, render: (order) => <span className="font-medium tabular-nums">{formatCurrency(Number(order.total))}</span> },
  ];

  async function save(changes: EditableTableChanges<SalesOrder>) {
    setCreated(null);
    const result = await saveSalesOrderRows(await getDb(), companyId, actor, changes);
    const labels = new Map(orders.map((order) => [order.id, formatSequence("sales_orders", order.number)]));
    for (const id of result.updated) await emit({ type: "sales_order.updated", companyId, actorId: session.user.id, entityType: "sales_order", entityId: id, title: `Pedido ${labels.get(id) ?? ""} alterado`, module: "sales" });
    for (const id of result.created) await emit({ type: "sales_order.created", companyId, actorId: session.user.id, entityType: "sales_order", entityId: id, title: "Pedido criado (rascunho, sem itens)", module: "sales" });
    if (result.created.length === 1) setCreated(result.created[0]!);
    invalidateTrade(qc);
  }

  const calendarItems: CalendarItem[] = orders
    .filter((order) => order.status !== "cancelado" && (order.delivered_at || order.delivery_date))
    .map((order) => ({
      id: order.id,
      title: `${formatSequence("sales_orders", order.number)} · ${customerName(order)}`,
      start: localDay(order.delivered_at ?? order.delivery_date, "")!,
      allDay: true,
      sourceLabel: order.delivered_at ? "Entregue" : "Previsão de entrega",
    }));
  const createdOrder = created ? orders.find((order) => order.id === created) : undefined;

  return (
    <div className="space-y-5">
      <PageHeader title={title} description="Pedidos de venda: confirmação, faturamento em parcelas (contas a receber) e entrega com baixa no estoque." actions={<ViewSwitch value={view} onChange={setView} label="Ver pedidos em" />} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Vendido no mês" value={formatCurrency(sumMoney(monthSales.map((order) => Number(order.total))))} />
        <StatCard title="Rascunhos" value={drafts.length} />
        <StatCard title="A faturar" value={toInvoice.length} />
        <StatCard title="A entregar" value={toDeliver.length} />
      </div>

      {/* A lista fica montada (só escondida) enquanto o calendário aparece: o rascunho não se perde em silêncio. */}
      <div hidden={view !== "lista"} className="space-y-5">
        <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por número ou cliente...">
          <select aria-label="Filtrar por status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className={`${INPUT} w-44`}>
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </PageToolbar>

        {created && (
          <p role="status" className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            Pedido {createdOrder ? formatSequence("sales_orders", createdOrder.number) : ""} criado como rascunho: abra para incluir os itens.
            <button type="button" className="font-medium underline" onClick={() => navigate(`/sales/pedidos/${created}`)}>Abrir pedido</button>
          </p>
        )}

        <EditableTable<SalesOrder>
          resource="sales_orders"
          title="Pedidos de venda"
          label="Pedidos de venda"
          rows={filtered}
          columns={columns}
          loading={isLoading}
          onSave={save}
          onRefresh={() => refreshTrade(qc)}
          newRow={() => ({ order_date: todayIso(), installments: 1 })}
          emptyMessage={orders.length ? "Nenhum pedido neste filtro: mude o status ou a busca." : "Nenhum pedido de venda. Use Adicionar, inclua os itens no pedido, confirme e fature: as parcelas vão para contas a receber."}
          rowActions={(order) => (
            <button type="button" className={ROW_ACTION} aria-label={`Abrir pedido ${formatSequence("sales_orders", order.number)}`} onClick={() => navigate(`/sales/pedidos/${order.id}`)}>
              <ExternalLink size={13} /> Abrir
            </button>
          )}
        />
      </div>
      {view === "calendario" && <CalendarView items={calendarItems} label="Entregas dos pedidos" onSelect={(item) => navigate(`/sales/pedidos/${item.id}`)} />}
    </div>
  );
}
