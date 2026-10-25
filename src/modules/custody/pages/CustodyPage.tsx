// Custódia de peça: peças e ativos em posse de alguém, editados direto na tabela (Editar / Adicionar / Atualizar).
// Devolvido marca a data de devolução. A aba Calendário mostra as devoluções previstas (atrasadas em vermelho).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { CalendarView } from "@/components/shared/CalendarView";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { confirmAction } from "@/lib/confirm";
import { fetchCompanyUsers } from "@/lib/crm/queries";
import { getDb } from "@/lib/db/client";
import { CUSTODY_STATUSES, custodyCalendarItems, dayOf, deleteCustody, listCustodies, saveCustodyRows, type CustodyView } from "@/lib/inventory/custody";
import { useLabel } from "@/lib/labels/useLabel";
import { formatDateTime, todayIso } from "@/lib/utils";
import type { InventoryItem, WorkOrder } from "@/types";
import { emitSafely, ErrorBanner, errorText, normalizeSearch, useActor } from "@/modules/inventory/components/inventoryUi";

const TABS = [
  { id: "lista", label: "Lista" },
  { id: "calendario", label: "Calendário" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const SELECT = "h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";

export default function CustodyPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const title = useLabel("module.custody");
  const actor = useActor();
  const qc = useQueryClient();
  const canDelete = usePermission("delete", "custody");
  const [tab, setTab] = useState<Tab>("lista");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const custodiesQuery = useQuery({
    queryKey: ["custodies", companyId],
    queryFn: async () => listCustodies(await getDb(), companyId),
  });
  const { data: items = [] } = useQuery({
    queryKey: ["inventory-options", companyId],
    queryFn: async () => (await getDb()).select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=? AND deleted_at IS NULL ORDER BY name", [companyId]),
  });
  const { data: users = [] } = useQuery({
    queryKey: ["company-users", companyId],
    queryFn: async () => fetchCompanyUsers(await getDb(), companyId),
  });
  const { data: orders = [] } = useQuery({
    queryKey: ["work-order-options", companyId],
    queryFn: async () => (await getDb()).select<WorkOrder[]>("SELECT * FROM work_orders WHERE company_id=? AND deleted_at IS NULL ORDER BY number", [companyId]),
  });
  const custodies = custodiesQuery.data ?? [];
  const query = normalizeSearch(search);
  const filtered = custodies.filter((custody) => {
    const matchesSearch = !query || [custody.item_name, custody.holder_name, custody.status, custody.work_order_number].some((value) => normalizeSearch(value ?? "").includes(query));
    return matchesSearch && (statusFilter === "all" || custody.status === statusFilter);
  });
  const today = todayIso();
  const open = custodies.filter((custody) => custody.status === "em_custodia");
  const late = open.filter((custody) => custody.due_back_at && dayOf(custody.due_back_at) < today);

  const columns: EditableColumn<CustodyView>[] = [
    { key: "item_id", header: "Item", kind: "select", required: true, options: items.map((item) => ({ value: item.id, label: item.name })), render: (row) => <span className="font-medium">{row.item_name ?? "—"}</span> },
    { key: "holder_id", header: "Responsável", kind: "select", required: true, options: users.map((user) => ({ value: user.id, label: user.name })), render: (row) => row.holder_name ?? "—" },
    { key: "quantity", header: "Qtd.", kind: "number", required: true, width: 90 },
    { key: "status", header: "Status", kind: "select", required: true, options: CUSTODY_STATUSES, render: (row) => <StatusBadge status={row.status} /> },
    { key: "checked_out_at", header: "Retirada", kind: "text", readOnly: true, render: (row) => <span className="text-muted-foreground">{formatDateTime(row.checked_out_at)}</span> },
    { key: "due_back_at", header: "Devolução prevista", kind: "date" },
    { key: "work_order_id", header: "OS", kind: "select", options: orders.map((order) => ({ value: order.id, label: order.number })), render: (row) => row.work_order_number ?? "—" },
    { key: "returned_at", header: "Devolvido em", kind: "text", readOnly: true, render: (row) => (row.returned_at ? formatDateTime(row.returned_at) : "—") },
  ];

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["custodies", companyId] });
    void qc.invalidateQueries({ queryKey: ["inventory-custodies", companyId] });
    void qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
  }

  async function save(changes: EditableTableChanges<CustodyView>) {
    const result = await saveCustodyRows(await getDb(), companyId, actor, changes);
    invalidate();
    const itemName = new Map(items.map((item) => [item.id, item.name]));
    await emitSafely([
      ...result.created.map((id) => ({
        type: "custody.created",
        companyId,
        actorId: actor.userId,
        entityType: "custody",
        entityId: id,
        title: `Custódia registrada: ${itemName.get(String(changes.created.find((row) => row.id === id)?.item_id ?? "")) ?? "peça"}`,
        module: "custody",
      })),
      ...result.updated.map((id) => ({ type: "custody.updated", companyId, actorId: actor.userId, entityType: "custody", entityId: id, title: "Custódia alterada", module: "custody", newValue: changes.updated.find((row) => row.id === id) })),
    ]);
  }

  async function remove(custody: CustodyView) {
    if (!(await confirmAction(`Remover o registro de custódia de "${custody.item_name ?? "peça sem nome"}"?`, { title: "Remover custódia", okLabel: "Remover" }))) return;
    try {
      await deleteCustody(await getDb(), companyId, actor, custody.id);
      invalidate();
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={title} description="Peças e ativos em posse de técnicos" />
      <ErrorBanner message={error} onClose={() => setError(null)} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Em custódia" value={open.length} />
        <StatCard title="Devolução atrasada" value={late.length} />
        <StatCard title="Registros" value={custodies.length} />
      </div>

      <TabList tabs={TABS} value={tab} onChange={setTab} label="Visualização da custódia" idPrefix="custodia" />

      {tab === "lista" ? (
        <TabPanel idPrefix="custodia" id="lista">
          <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por item, responsável ou OS..." onFilterClick={() => setShowFilters((visible) => !visible)} filterActive={statusFilter !== "all"} />
          {showFilters && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3">
              <label className="text-sm font-medium" htmlFor="custody-status-filter">Status</label>
              <select id="custody-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={SELECT}>
                <option value="all">Todos</option>
                {CUSTODY_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
              </select>
            </div>
          )}
          <EditableTable
            resource="custody"
            label="Custódias de peça"
            title="Custódias"
            rows={filtered}
            columns={columns}
            loading={custodiesQuery.isLoading}
            onSave={save}
            onRefresh={() => custodiesQuery.refetch()}
            newRow={() => ({ id: uuidv4(), holder_id: actor.userId, quantity: 1, status: "em_custodia" as const })}
            emptyMessage={custodies.length === 0 ? "Nenhuma custódia de peça." : "Nenhuma custódia de peça encontrada."}
            rowActions={
              canDelete
                ? (row) => (
                    <button type="button" onClick={() => void remove(row)} aria-label={`Remover custódia de ${row.item_name ?? "peça"}`} title={`Remover custódia de ${row.item_name ?? "peça"}`} className="rounded-md p-1.5 text-destructive transition-colors hover:bg-destructive/10">
                      <Trash2 size={15} />
                    </button>
                  )
                : undefined
            }
          />
        </TabPanel>
      ) : (
        <TabPanel idPrefix="custodia" id="calendario">
          <CalendarView
            label="Devoluções previstas"
            items={custodyCalendarItems(custodies)}
            onSelect={(item) => {
              const custody = custodies.find((row) => row.id === item.id);
              setSearch(custody?.item_name ?? "");
              setStatusFilter("all");
              setTab("lista");
            }}
          />
        </TabPanel>
      )}
    </div>
  );
}
