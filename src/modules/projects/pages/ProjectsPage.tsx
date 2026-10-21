import { useState } from "react";
import { CalendarDays, FolderKanban, Wallet } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { SearchInput, matchesSearch } from "@/components/shared/SearchInput";
import { Toolbar } from "@/components/shared/Toolbar";
import { NewButton } from "@/components/shared/NewButton";
import { ImportExportActions } from "@/components/shared/ImportExportActions";
import { EntityFormDialog } from "@/components/shared/EntityFormDialog";
import { useEntityList } from "@/hooks/useEntity";
import { refLabel } from "@/lib/data/repository";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function ProjectsPage() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const { data: projects = [], isLoading } = useEntityList("projects");

  const filtered = projects.filter((p) => matchesSearch(search, [p.name, refLabel(p, "customer_id")]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projetos"
        description="Gestão de projetos e tarefas"
        actions={
          <>
            <ImportExportActions entities={["projects"]} />
            <NewButton entity="projects" onClick={() => setShowForm(true)} />
          </>
        }
      />
      <Toolbar count={filtered.length}>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar projetos..." />
      </Toolbar>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-muted/40" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={FolderKanban} title="Nenhum projeto" description="Crie projetos vinculados a clientes ou importe uma planilha." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="projects-grid">
          {filtered.map((p) => (
            <article
              key={String(p.id)}
              data-row-id={String(p.id)}
              className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold leading-tight">{String(p.name)}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{refLabel(p, "customer_id") || "Sem cliente"}</p>
                </div>
                <StatusBadge status={String(p.status)} />
              </div>
              <dl className="mt-auto grid grid-cols-2 gap-2 border-t pt-3 text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Wallet size={12} />
                  <dd className="tabular-nums text-foreground">{formatCurrency(Number(p.budget ?? 0))}</dd>
                </div>
                <div className="flex items-center justify-end gap-1.5 text-muted-foreground">
                  <CalendarDays size={12} />
                  <dd className="tabular-nums">
                    {formatDate(p.start_date as string)} → {formatDate(p.end_date as string)}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
      <EntityFormDialog entity="projects" open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}
