import { useState } from "react";
import { Wrench } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { SearchInput, matchesSearch } from "@/components/shared/SearchInput";
import { Toolbar } from "@/components/shared/Toolbar";
import { NewButton } from "@/components/shared/NewButton";
import { ImportExportActions } from "@/components/shared/ImportExportActions";
import { EntityFormDialog } from "@/components/shared/EntityFormDialog";
import { useEntityList, useUpdateEntity } from "@/hooks/useEntity";
import { usePermission } from "@/hooks/usePermission";
import { getEntity } from "@/lib/data/entities";
import { refLabel, type Row } from "@/lib/data/repository";
import { formatCurrency, formatDateTime } from "@/lib/utils";

const STATUS_OPTIONS = getEntity("work_orders").fields.find((f) => f.key === "status")!.options!;

export default function WorkOrdersPage() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const { data: orders = [], isLoading } = useEntityList("work_orders");
  const update = useUpdateEntity("work_orders");
  const canEdit = usePermission("edit", "work_orders");

  const filtered = orders.filter((o) => matchesSearch(search, [o.number, refLabel(o, "customer_id")]));

  const columns: Column<Row>[] = [
    { key: "number", header: "Número", cell: (o) => <span className="font-medium tabular-nums">{String(o.number)}</span> },
    { key: "customer_id", header: "Cliente", cell: (o) => <span className="text-muted-foreground">{refLabel(o, "customer_id") || "—"}</span> },
    {
      key: "status",
      header: "Status",
      cell: (o) =>
        canEdit ? (
          <select
            aria-label={`Status da ${String(o.number)}`}
            data-testid="work-order-status"
            value={String(o.status)}
            onChange={(e) =>
              update.mutate({
                id: String(o.id),
                patch: {
                  status: e.target.value,
                  closed_at: e.target.value === "concluida" ? new Date().toISOString() : null,
                },
              })
            }
            className="h-7 rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        ) : (
          <StatusBadge status={String(o.status)} />
        ),
    },
    { key: "priority", header: "Prioridade", cell: (o) => <StatusBadge status={String(o.priority)} /> },
    { key: "opened_at", header: "Aberta em", cell: (o) => <span className="tabular-nums text-muted-foreground">{formatDateTime((o.opened_at ?? o.created_at) as string)}</span> },
    { key: "labor_cost", header: "Custo M.O.", align: "right", cell: (o) => <span className="tabular-nums">{formatCurrency(Number(o.labor_cost ?? 0))}</span> },
    { key: "materials_cost", header: "Custo mat.", align: "right", cell: (o) => <span className="tabular-nums">{formatCurrency(Number(o.materials_cost ?? 0))}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ordens de Serviço"
        description="Gestão de OS"
        actions={
          <>
            <ImportExportActions entities={["work_orders"]} />
            <NewButton entity="work_orders" onClick={() => setShowForm(true)} />
          </>
        }
      />
      <Toolbar count={filtered.length}>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por número ou cliente..." />
      </Toolbar>
      <DataTable
        testId="work-orders-table"
        columns={columns}
        rows={filtered}
        getRowId={(r) => String(r.id)}
        isLoading={isLoading}
        empty={<EmptyState icon={Wrench} title="Nenhuma ordem de serviço" description="OS são criadas ao converter tickets ou diretamente." />}
      />
      <EntityFormDialog entity="work_orders" open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}
