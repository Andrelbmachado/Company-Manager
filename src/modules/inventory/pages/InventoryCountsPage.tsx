// Inventário: contagens na tabela editável. Adicionar abre uma contagem no local escolhido (com os itens que têm saldo
// lá); Editar muda a observação. A folha de cada contagem (o contado item a item) abre pelo link da linha.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { saveCountRows } from "@/lib/inventory/countRows";
import { listInventoryCounts, type InventoryCountSummary } from "@/lib/inventory/counts";
import { listLocationSummaries } from "@/lib/inventory/locations";
import { formatDateTime } from "@/lib/utils";
import { emitSafely, inventoryKeys, normalizeSearch, useActor, useInvalidateInventory, withRetiredOptions } from "../components/inventoryUi";

const STATUS_FILTERS = [
  { value: "all", label: "Todas" },
  { value: "aberta", label: "Abertas" },
  { value: "concluida", label: "Concluídas" },
  { value: "cancelada", label: "Canceladas" },
] as const;

const STATUS_OPTIONS = [
  { value: "aberta", label: "Aberta" },
  { value: "concluida", label: "Concluída" },
  { value: "cancelada", label: "Cancelada" },
];

export default function InventoryCountsPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const actor = useActor();
  const invalidate = useInvalidateInventory(companyId);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]["value"]>("all");

  const countsQuery = useQuery({
    queryKey: inventoryKeys.counts(companyId),
    queryFn: async () => listInventoryCounts(await getDb(), companyId),
  });
  const { data: locations = [], isSuccess: locationsLoaded } = useQuery({
    queryKey: inventoryKeys.locations(companyId),
    queryFn: async () => listLocationSummaries(await getDb(), companyId),
  });
  const counts = countsQuery.data ?? [];
  const query = normalizeSearch(search);
  const visible = counts.filter(
    (count) =>
      (status === "all" || count.status === status) &&
      (!query || [formatSequence("inventory_counts", count.number), count.location_name, count.notes].some((value) => normalizeSearch(value ?? "").includes(query))),
  );

  const columns: EditableColumn<InventoryCountSummary>[] = [
    {
      key: "number",
      header: "Número",
      kind: "text",
      readOnly: true,
      sortValue: (row) => formatSequence("inventory_counts", row.number),
      render: (row) => (
        <Link to={`/inventory/inventarios/${row.id}`} className="font-medium text-primary-text hover:underline">
          {formatSequence("inventory_counts", row.number)}
        </Link>
      ),
    },
    {
      key: "location_id",
      header: "Local",
      kind: "select",
      required: true,
      // Local arquivado de uma contagem antiga aparece pelo nome na edição, não pelo código.
      options: withRetiredOptions(
        locations.map((location) => ({
          value: location.id,
          label: location.open_count_number ? `${location.name} (contagem ${formatSequence("inventory_counts", location.open_count_number)} aberta)` : location.name,
        })),
        locationsLoaded,
        counts,
        (row) => row.location_id,
        (row) => row.location_name,
        "arquivado",
      ),
      render: (row) => row.location_name ?? "—",
    },
    { key: "status", header: "Situação", kind: "select", readOnly: true, options: STATUS_OPTIONS, render: (row) => <StatusBadge status={row.status} /> },
    { key: "notes", header: "Observação", kind: "text", placeholder: "Ex.: contagem mensal das prateleiras" },
    { key: "started_at", header: "Início", kind: "date", readOnly: true, render: (row) => (row.started_at ? formatDateTime(row.started_at) : "—") },
    { key: "finished_at", header: "Conclusão", kind: "date", readOnly: true, render: (row) => (row.finished_at ? formatDateTime(row.finished_at) : "—") },
    { key: "counted_count", header: "Contados", kind: "number", readOnly: true, render: (row) => `${row.counted_count}/${row.item_count}` },
    {
      key: "divergent_count",
      header: "Com diferença",
      kind: "number",
      readOnly: true,
      render: (row) => <span className={row.divergent_count > 0 ? "font-medium text-status-danger dark:text-red-400" : "text-muted-foreground"}>{row.divergent_count}</span>,
    },
  ];

  async function save(changes: EditableTableChanges<InventoryCountSummary>) {
    const result = await saveCountRows(await getDb(), companyId, actor, changes);
    invalidate();
    const names = new Map(locations.map((location) => [location.id, location.name]));
    await emitSafely(
      result.created.map(({ id, number }) => ({
        type: "stock.count_opened",
        companyId,
        actorId: actor.userId,
        entityType: "inventory_count",
        entityId: id,
        title: `Contagem ${formatSequence("inventory_counts", number)} aberta em ${names.get(String(changes.created.find((row) => row.id === id)?.location_id ?? "")) ?? "local"}`,
        module: "inventory",
      })),
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Inventário" />

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por número, local ou observação...">
        <div role="group" aria-label="Filtrar por situação" className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={status === option.value}
              onClick={() => setStatus(option.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${status === option.value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </PageToolbar>

      <EditableTable
        resource="inventory"
        label="Contagens de inventário"
        title="Contagens"
        rows={visible}
        columns={columns}
        loading={countsQuery.isLoading}
        onSave={save}
        onRefresh={() => countsQuery.refetch()}
        newRow={() => ({ id: uuidv4(), status: "aberta" as const, location_id: locations.find((location) => !location.open_count_id)?.id ?? "" })}
        emptyMessage={counts.length === 0 ? "Nenhuma contagem ainda" : "Nenhuma contagem encontrada"}
        rowActions={(row) => (
          <Link to={`/inventory/inventarios/${row.id}`} className="rounded-md px-2 py-1 text-xs text-primary-text hover:bg-muted">
            {row.status === "aberta" ? "Contar" : "Ver folha"}
          </Link>
        )}
      />
    </div>
  );
}
