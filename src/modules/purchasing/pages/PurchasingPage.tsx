// Compras: pedidos de compra editados na própria tabela (rascunho por inteiro; aprovado só previsão e observações) e a
// previsão de entrega no calendário. Itens, aprovação, envio e recebimento ficam na tela do pedido (Abrir).
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { CalendarView, type CalendarItem } from "@/components/shared/CalendarView";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge, statusLabel } from "@/components/shared/StatusBadge";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { useLabel } from "@/lib/labels/useLabel";
import { sumMoney } from "@/lib/money";
import { formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { BUTTON, INPUT, byId, invalidateTrade, useGoodsReceipts, useLocations, usePurchaseOrders, useSuppliers } from "@/modules/catalog/components/tradeKit";
import { ViewToggle, type ListOrCalendar } from "@/modules/finance/components/inline";
import { useEditContext } from "@/modules/finance/data/useEditContext";
import type { PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus } from "@/types";
import { usePurchaseItemOptions } from "../components/itemOptions";
import { purchaseOrderRow, savePurchaseOrderChanges, type PurchaseOrderRow } from "../data/purchaseOrderEditing";

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
const AWAITING = new Set<PurchaseOrderStatus>(["aprovado", "enviado", "recebido_parcial"]);

const isLate = (order: Pick<PurchaseOrder, "status" | "expected_date">, today: string) => AWAITING.has(order.status) && Boolean(order.expected_date) && order.expected_date!.slice(0, 10) < today;

export default function PurchasingPage() {
  const ctx = useEditContext();
  const companyId = ctx.companyId;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const title = useLabel("module.purchasing");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("abertos");
  const [view, setView] = useState<ListOrCalendar>("lista");
  const ordersQuery = usePurchaseOrders(companyId);
  const itemsQuery = useQuery({
    queryKey: ["purchase_orders", companyId, "items"],
    queryFn: async () => (await getDb()).select<PurchaseOrderItem[]>("SELECT * FROM purchase_order_items WHERE company_id=? AND deleted_at IS NULL", [companyId]),
  });
  const { data: suppliers = [] } = useSuppliers(companyId);
  const { data: locations = [] } = useLocations(companyId);
  const { data: receipts = [] } = useGoodsReceipts(companyId);
  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);
  const suppliersById = useMemo(() => byId(suppliers), [suppliers]);
  const itemsByOrder = useMemo(() => {
    const map = new Map<string, PurchaseOrderItem[]>();
    for (const item of [...(itemsQuery.data ?? [])].sort((a, b) => a.position - b.position)) map.set(item.order_id, [...(map.get(item.order_id) ?? []), item]);
    return map;
  }, [itemsQuery.data]);
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
  const rows = filtered.map((order) => purchaseOrderRow(order, itemsByOrder.get(order.id)));
  const items = usePurchaseItemOptions(companyId, rows.map((row) => row.first_item));

  const awaitingApproval = orders.filter((order) => order.status === "rascunho");
  const awaitingGoods = orders.filter((order) => AWAITING.has(order.status));
  const late = awaitingGoods.filter((order) => isLate(order, today));
  const receivedThisMonth = receipts.filter((receipt) => receipt.status !== "estornado" && receipt.received_at && todayIso(new Date(receipt.received_at)).slice(0, 7) === month);

  const supplierName = (id: string | null | undefined) => (id ? suppliersById.get(id)?.name ?? "Fornecedor removido" : "A definir");
  const calendarItems: CalendarItem[] = filtered
    .filter((order) => order.expected_date && order.status !== "cancelado")
    .map((order) => ({
      id: order.id,
      title: `${formatSequence("purchase_orders", order.number)} · ${supplierName(order.supplier_id)}`,
      start: order.expected_date!.slice(0, 10),
      allDay: true,
      color: isLate(order, today) ? "hsl(var(--destructive))" : order.status === "recebido" ? "hsl(var(--muted-foreground))" : undefined,
      sourceLabel: "Previsão de entrega",
    }));
  const withoutDate = filtered.filter((order) => !order.expected_date && order.status !== "cancelado").length;

  const columns = useMemo<EditableColumn<PurchaseOrderRow>[]>(() => [
    { key: "number", header: "Pedido", kind: "text", readOnly: true, render: (row) => <Link to={`/purchasing/pedidos/${row.id}`} className="font-medium hover:underline">{row.number}</Link> },
    {
      key: "supplier_id",
      header: "Fornecedor",
      kind: "select",
      width: 200,
      placeholder: "A definir",
      options: suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
      render: (row) => (row.supplier_id ? suppliersById.get(row.supplier_id)?.name ?? "Fornecedor removido" : <span className="text-muted-foreground">A definir</span>),
    },
    {
      key: "first_item",
      header: "1º item",
      kind: "select",
      width: 220,
      options: items.options,
      render: (row) => {
        const name = items.nameOf(row.first_item) ?? itemsByOrder.get(row.id)?.[0]?.description;
        if (!name) return <span className="text-muted-foreground">—</span>;
        const more = (row.item_count ?? 0) - 1;
        return more > 0 ? `${name} + ${more}` : name;
      },
    },
    { key: "first_qty", header: "Qtd.", kind: "number", width: 80 },
    { key: "order_date", header: "Data", kind: "date" },
    {
      key: "expected_date",
      header: "Previsão",
      kind: "date",
      render: (row) => {
        const order = orders.find((candidate) => candidate.id === row.id);
        return <span className={order && isLate(order, today) ? "text-destructive" : undefined}>{formatDay(row.expected_date)}</span>;
      },
    },
    {
      key: "location_id",
      header: "Local de entrada",
      kind: "select",
      placeholder: "Escolher no recebimento",
      options: locations.map((location) => ({ value: location.id, label: location.name })),
      render: (row) => (row.location_id ? locations.find((location) => location.id === row.location_id)?.name ?? "Local removido" : <span className="text-muted-foreground">No recebimento</span>),
    },
    { key: "payment_terms", header: "Condição", kind: "text", placeholder: "Ex.: 28 dias" },
    { key: "installments", header: "Parcelas", kind: "number", width: 80 },
    { key: "status", header: "Status", kind: "select", readOnly: true, sortValue: (row) => (row.status ? statusLabel(row.status) : null), render: (row) => (row.status ? <StatusBadge status={row.status} /> : null) },
    { key: "total", header: "Total", kind: "money", readOnly: true },
    { key: "notes", header: "Observações", kind: "text", width: 200 },
  ], [suppliers, suppliersById, items, itemsByOrder, locations, orders, today]);

  async function save(changes: EditableTableChanges<PurchaseOrderRow>) {
    const created = await savePurchaseOrderChanges(await getDb(), ctx, changes);
    invalidateTrade(qc);
    // Pedido novo abre na própria tela para incluir os demais itens, aprovar e receber.
    if (created.length === 1) navigate(`/purchasing/pedidos/${created[0]}`);
  }

  return (
    <div className="space-y-5">
      <PageHeader title={title} actions={<ViewToggle value={view} onChange={setView} />} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Aguardando aprovação" value={awaitingApproval.length} />
        <StatCard title="A receber" value={awaitingGoods.length} />
        <StatCard title="Entrega atrasada" value={late.length} />
        <StatCard title="Recebido no mês" value={formatCurrency(sumMoney(receivedThisMonth.map((receipt) => Number(receipt.total))))} />
      </div>

      {/* A lista fica montada (só escondida) enquanto o calendário aparece: o rascunho não se perde em silêncio. */}
      <div hidden={view !== "lista"} className="space-y-3">
        <EditableTable<PurchaseOrderRow>
          actions={
            <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por número ou fornecedor...">
              <select aria-label="Filtrar por status" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className={`${INPUT} w-48`}>
                {FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </PageToolbar>
          }
          resource="purchase_orders"
          label="Pedidos de compra"
          rows={rows}
          columns={columns}
          loading={ordersQuery.isLoading || itemsQuery.isLoading}
          newRow={() => ({ order_date: today, installments: 1, first_qty: 1 })}
          onSave={save}
          onRefresh={() => Promise.all([qc.invalidateQueries({ queryKey: ["purchase_orders", companyId] }), qc.invalidateQueries({ queryKey: ["suppliers", companyId] })])}
          emptyMessage={orders.length ? "Nenhum pedido neste filtro" : "Nenhum pedido de compra"}
          rowActions={(row) => (
            <button type="button" className={BUTTON} onClick={() => navigate(`/purchasing/pedidos/${row.id}`)} aria-label={`Abrir ${row.number}`}>
              Abrir <ArrowRight size={14} aria-hidden="true" />
            </button>
          )}
        />
      </div>
      {view === "calendario" && (
        <div className="space-y-2">
          <CalendarView items={calendarItems} label="Previsão de entrega dos pedidos" onSelect={(item) => navigate(`/purchasing/pedidos/${item.id}`)} />
          {withoutDate > 0 && (
            <p className="px-1 text-sm text-muted-foreground">
              {withoutDate === 1 ? "1 pedido sem previsão de entrega" : `${withoutDate} pedidos sem previsão de entrega`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
