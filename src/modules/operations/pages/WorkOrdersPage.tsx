// Ordens de serviço editadas direto na tabela (Editar / Adicionar / Atualizar). Número vazio na OS nova = próximo
// OS-NNNN livre; concluída ou cancelada marca o encerramento. A aba Calendário mostra os prazos das OS em andamento.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { CalendarView } from "@/components/shared/CalendarView";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { useRequiredSession } from "@/hooks/useSession";
import { fetchCompanyUsers } from "@/lib/crm/queries";
import { getDb } from "@/lib/db/client";
import { dayOf } from "@/lib/inventory/custody";
import { useLabel } from "@/lib/labels/useLabel";
import { sumMoney } from "@/lib/money";
import { isClosedWorkOrder, listWorkOrders, saveWorkOrderRows, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES, workOrderCalendarItems, type WorkOrderView } from "@/lib/operations/workOrders";
import { formatCurrency, formatDateTime, todayIso } from "@/lib/utils";
import { emitSafely, normalizeSearch, useActor, withRetiredOptions } from "@/modules/inventory/components/inventoryUi";

const TABS = [
  { id: "lista", label: "Lista" },
  { id: "calendario", label: "Calendário" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const SELECT = "h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";

export default function WorkOrdersPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const title = useLabel("module.operations");
  const actor = useActor();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("lista");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("abertas");
  const [showFilters, setShowFilters] = useState(false);

  const ordersQuery = useQuery({
    queryKey: ["work-orders", companyId],
    queryFn: async () => listWorkOrders(await getDb(), companyId),
  });
  const { data: customers = [], isSuccess: customersLoaded } = useQuery({
    queryKey: ["work-order-customers", companyId],
    queryFn: async () => (await getDb()).select<{ id: string; name: string }[]>("SELECT * FROM customers WHERE company_id=? AND deleted_at IS NULL ORDER BY name", [companyId]),
  });
  const { data: users = [], isSuccess: usersLoaded } = useQuery({
    queryKey: ["company-users", companyId],
    queryFn: async () => fetchCompanyUsers(await getDb(), companyId),
  });
  const orders = ordersQuery.data ?? [];
  const query = normalizeSearch(search);
  const filtered = orders.filter((order) => {
    if (statusFilter === "abertas" && isClosedWorkOrder(order.status)) return false;
    if (statusFilter !== "abertas" && statusFilter !== "all" && order.status !== statusFilter) return false;
    return !query || [order.number, order.customer_name, order.technician_name].some((value) => normalizeSearch(value ?? "").includes(query));
  });
  const today = todayIso();
  const active = orders.filter((order) => !isClosedWorkOrder(order.status));
  const overdue = active.filter((order) => order.sla_due_at && dayOf(order.sla_due_at) < today);

  // Cliente excluído e técnico desligado que alguma OS ainda usa aparecem pelo nome na edição, não pelo código.
  const customerOptions = withRetiredOptions(customers.map((customer) => ({ value: customer.id, label: customer.name })), customersLoaded, orders, (row) => row.customer_id, (row) => row.customer_name, "excluído");
  const technicianOptions = withRetiredOptions(users.map((user) => ({ value: user.id, label: user.name })), usersLoaded, orders, (row) => row.technician_id, (row) => row.technician_name, "inativo");

  const columns: EditableColumn<WorkOrderView>[] = [
    { key: "number", header: "Número", kind: "text", placeholder: "automático", width: 120, render: (row) => <span className="font-medium">{row.number}</span> },
    { key: "customer_id", header: "Cliente", kind: "select", options: customerOptions, render: (row) => row.customer_name ?? "—" },
    { key: "technician_id", header: "Técnico", kind: "select", options: technicianOptions, render: (row) => row.technician_name ?? "—" },
    { key: "status", header: "Status", kind: "select", required: true, options: WORK_ORDER_STATUSES, render: (row) => <StatusBadge status={row.status} /> },
    { key: "priority", header: "Prioridade", kind: "select", required: true, options: WORK_ORDER_PRIORITIES, render: (row) => <StatusBadge status={row.priority} /> },
    { key: "sla_due_at", header: "Prazo", kind: "date" },
    { key: "opened_at", header: "Aberta em", kind: "date", readOnly: true, render: (row) => <span className="text-muted-foreground">{formatDateTime(row.opened_at)}</span> },
    { key: "labor_cost", header: "Mão de obra", kind: "money" },
    { key: "materials_cost", header: "Materiais", kind: "money" },
    { key: "total_cost", header: "Custo total", kind: "money", readOnly: true },
  ];

  async function save(changes: EditableTableChanges<WorkOrderView>) {
    const result = await saveWorkOrderRows(await getDb(), companyId, actor, changes);
    void qc.invalidateQueries({ queryKey: ["work-orders", companyId] });
    void qc.invalidateQueries({ queryKey: ["work-order-options", companyId] });
    void qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
    await emitSafely([
      ...result.created.map((id) => ({ type: "work_order.created", companyId, actorId: actor.userId, entityType: "work_order", entityId: id, title: "Ordem de serviço aberta", module: "operations" })),
      ...result.updated.map((id) => ({ type: "work_order.updated", companyId, actorId: actor.userId, entityType: "work_order", entityId: id, title: "Ordem de serviço alterada", module: "operations", newValue: changes.updated.find((row) => row.id === id) })),
    ]);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={title} description="Gestão de OS: cliente, técnico, prazo e custos" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Em andamento" value={active.length} />
        <StatCard title="Prazo vencido" value={overdue.length} />
        <StatCard title="Concluídas" value={orders.filter((order) => order.status === "concluida").length} />
        <StatCard title="Custo das OS em andamento" value={formatCurrency(sumMoney(active.map((order) => order.total_cost)))} />
      </div>

      <TabList tabs={TABS} value={tab} onChange={setTab} label="Visualização das ordens de serviço" idPrefix="os" />

      {/* A lista fica montada (escondida) com o Calendário aberto: trocar de aba não perde o que foi digitado na tabela. */}
      <div hidden={tab !== "lista"}>
        <TabPanel idPrefix="os" id="lista">
          <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por número, cliente ou técnico..." onFilterClick={() => setShowFilters((visible) => !visible)} filterActive={statusFilter !== "abertas"} />
          {showFilters && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3">
              <label className="text-sm font-medium" htmlFor="wo-status-filter">Status</label>
              <select id="wo-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={SELECT}>
                <option value="abertas">Em andamento</option>
                <option value="all">Todas</option>
                {WORK_ORDER_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
              </select>
            </div>
          )}
          <EditableTable
            resource="work_orders"
            label="Ordens de serviço"
            title="Ordens de serviço"
            rows={filtered}
            columns={columns}
            loading={ordersQuery.isLoading}
            onSave={save}
            onRefresh={() => ordersQuery.refetch()}
            newRow={() => ({ id: uuidv4(), status: "aberta" as const, priority: "media" as const, labor_cost: 0, materials_cost: 0, total_cost: 0 })}
            emptyMessage={orders.length === 0 ? "Nenhuma ordem de serviço." : "Nenhuma ordem de serviço neste filtro."}
          />
        </TabPanel>
      </div>
      {tab === "calendario" && (
        <TabPanel idPrefix="os" id="calendario">
          <CalendarView
            label="Prazos das ordens de serviço"
            items={workOrderCalendarItems(orders)}
            onSelect={(item) => {
              setSearch(orders.find((order) => order.id === item.id)?.number ?? "");
              setStatusFilter("all");
              setTab("lista");
            }}
          />
        </TabPanel>
      )}
    </div>
  );
}
