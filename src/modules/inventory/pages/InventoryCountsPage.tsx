import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Plus } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { listInventoryCounts } from "@/lib/inventory/counts";
import { formatDateTime } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { NewCountForm } from "../components/NewCountForm";
import { BUTTON_PRIMARY, inventoryKeys, normalizeSearch, TableSkeleton } from "../components/inventoryUi";

const STATUS_FILTERS = [
  { value: "all", label: "Todas" },
  { value: "aberta", label: "Abertas" },
  { value: "concluida", label: "Concluídas" },
  { value: "cancelada", label: "Canceladas" },
] as const;

export default function InventoryCountsPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const navigate = useNavigate();
  const canCreate = usePermission("create", "inventory");
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]["value"]>("all");

  const { data: counts = [], isLoading } = useQuery({
    queryKey: inventoryKeys.counts(companyId),
    queryFn: async () => listInventoryCounts(await getDb(), companyId),
  });
  const query = normalizeSearch(search);
  const visible = counts.filter(
    (count) =>
      (status === "all" || count.status === status) &&
      (!query || [formatSequence("inventory_counts", count.number), count.location_name, count.notes].some((value) => normalizeSearch(value ?? "").includes(query))),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventário"
        description="Contagens físicas por local. Ao concluir, as diferenças viram ajustes de estoque (falta e sobra)."
        actions={
          canCreate && !showForm ? (
            <button type="button" onClick={() => setShowForm(true)} className={BUTTON_PRIMARY}>
              <Plus size={14} /> Nova contagem
            </button>
          ) : undefined
        }
      />

      {showForm && <NewCountForm companyId={companyId} userId={session.user.id} onCancel={() => setShowForm(false)} />}

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por número, local ou observação...">
        <div role="group" aria-label="Filtrar por situação" className="flex gap-1">
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

      {isLoading ? (
        <TableSkeleton />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={counts.length === 0 ? "Nenhuma contagem ainda" : "Nenhuma contagem encontrada"}
          description={counts.length === 0 ? "Abra uma contagem para conferir o estoque físico de um local." : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="whitespace-nowrap bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Número</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Local</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Situação</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Início</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Conclusão</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Contados</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Com diferença</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map((count) => (
                <tr key={count.id} onClick={() => navigate(`/inventory/inventarios/${count.id}`)} className="cursor-pointer transition-colors hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">
                    <Link to={`/inventory/inventarios/${count.id}`} onClick={(event) => event.stopPropagation()} className="text-primary-text hover:underline">
                      {formatSequence("inventory_counts", count.number)}
                    </Link>
                    {count.notes && <p className="text-xs font-normal text-muted-foreground">{count.notes}</p>}
                  </td>
                  <td className="px-4 py-3">{count.location_name ?? "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={count.status} /></td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(count.started_at)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{count.finished_at ? formatDateTime(count.finished_at) : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{count.counted_count}/{count.item_count}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${count.divergent_count > 0 ? "font-medium text-status-danger dark:text-red-400" : "text-muted-foreground"}`}>{count.divergent_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
