import { useQuery } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDate, formatCurrency } from "@/lib/utils";
import { FolderKanban } from "lucide-react";
import type { Project } from "@/types";

export default function ProjectsPage() {
  const session = useRequiredSession();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects", session.company.id],
    queryFn: async () => {
      const db = await getDb();
      return db.select<Project[]>(
        "SELECT * FROM projects WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at DESC",
        [session.company.id]
      );
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Projetos" description="Gestão de projetos e tarefas" />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-36 rounded-xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="Nenhum projeto" description="Crie projetos vinculados a clientes." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div key={p.id} className="rounded-xl border bg-card p-4 space-y-3 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold leading-tight">{p.name}</p>
                <StatusBadge status={p.status} />
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                {p.budget > 0 && <p>Orçamento: {formatCurrency(p.budget)}</p>}
                {p.start_date && <p>Início: {formatDate(p.start_date)}</p>}
                {p.end_date && <p>Prazo: {formatDate(p.end_date)}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
