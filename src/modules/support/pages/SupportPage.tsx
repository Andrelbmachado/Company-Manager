import { useState } from "react";
import { HeadphonesIcon, Wrench } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { SearchInput, matchesSearch } from "@/components/shared/SearchInput";
import { Toolbar } from "@/components/shared/Toolbar";
import { NewButton } from "@/components/shared/NewButton";
import { ImportExportActions } from "@/components/shared/ImportExportActions";
import { EntityFormDialog } from "@/components/shared/EntityFormDialog";
import { Button } from "@/components/ui/Button";
import { useCreateEntity, useEntityList, useUpdateEntity } from "@/hooks/useEntity";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { refLabel, type Row } from "@/lib/data/repository";
import { cn, formatDateTime } from "@/lib/utils";

const STATUS_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "aberto", label: "Abertos" },
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "aguardando", label: "Aguardando" },
  { value: "resolvido", label: "Resolvidos" },
];

export default function SupportPage() {
  const session = useRequiredSession();
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const { data: tickets = [], isLoading } = useEntityList("tickets");
  const createWO = useCreateEntity("work_orders");
  const updateTicket = useUpdateEntity("tickets");
  const canCreateWO = usePermission("create", "work_orders");

  async function convertToWorkOrder(ticket: Row) {
    const [wo] = await createWO.mutateAsync([
      {
        customer_id: ticket.customer_id,
        ticket_id: ticket.id,
        technician_id: session.user.id,
        priority: ticket.priority,
      },
    ]);
    await updateTicket.mutateAsync({
      id: String(ticket.id),
      patch: { work_order_id: wo.id, status: "resolvido" },
    });
  }

  const filtered = tickets.filter(
    (t) =>
      (filter === "all" || t.status === filter) &&
      matchesSearch(search, [t.subject, t.description, refLabel(t, "customer_id")])
  );

  const columns: Column<Row>[] = [
    {
      key: "subject",
      header: "Assunto",
      cell: (t) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{String(t.subject)}</p>
          <p className="text-xs text-muted-foreground">{refLabel(t, "customer_id") || "Sem cliente"}</p>
        </div>
      ),
    },
    { key: "channel", header: "Canal", cell: (t) => <span className="capitalize text-muted-foreground">{String(t.channel ?? "—")}</span> },
    { key: "priority", header: "Prioridade", cell: (t) => <StatusBadge status={String(t.priority)} /> },
    { key: "status", header: "Status", cell: (t) => <StatusBadge status={String(t.status)} /> },
    { key: "created_at", header: "Aberto em", cell: (t) => <span className="tabular-nums text-muted-foreground">{formatDateTime(t.created_at as string)}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (t) =>
        canCreateWO && !t.work_order_id && t.status !== "resolvido" && t.status !== "fechado" ? (
          <Button
            size="sm"
            variant="ghost"
            data-testid="ticket-create-wo"
            disabled={createWO.isPending}
            onClick={() => convertToWorkOrder(t)}
            title="Converter em ordem de serviço"
          >
            <Wrench size={14} />
            Criar OS
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suporte / Tickets"
        description="Central de atendimento"
        actions={
          <>
            <ImportExportActions entities={["tickets"]} />
            <NewButton entity="tickets" onClick={() => setShowForm(true)} />
          </>
        }
      />

      <Toolbar count={filtered.length}>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar tickets..." />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              data-testid={`ticket-filter-${f.value}`}
              onClick={() => setFilter(f.value)}
              className={cn(
                "h-8 rounded-full px-3 text-xs font-medium transition-colors",
                filter === f.value ? "bg-primary text-primary-foreground" : "border hover:bg-muted"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Toolbar>

      <DataTable
        testId="tickets-table"
        columns={columns}
        rows={filtered}
        getRowId={(r) => String(r.id)}
        isLoading={isLoading}
        empty={<EmptyState icon={HeadphonesIcon} title="Nenhum ticket encontrado" />}
      />

      <EntityFormDialog entity="tickets" open={showForm} onClose={() => setShowForm(false)} initial={{ channel: "manual" }} />
    </div>
  );
}
