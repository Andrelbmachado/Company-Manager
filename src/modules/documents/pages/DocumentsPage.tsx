import { useQuery } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatDateTime } from "@/lib/utils";
import { FileText } from "lucide-react";

interface Doc {
  id: string;
  title: string;
  type?: string | null;
  version: number;
  entity_type?: string | null;
  created_at: string;
}

export default function DocumentsPage() {
  const session = useRequiredSession();

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["documents", session.company.id],
    queryFn: async () => {
      const db = await getDb();
      return db.select<Doc[]>(
        "SELECT * FROM documents WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at DESC",
        [session.company.id]
      );
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Documentos" description="Arquivos e anexos" />

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 rounded-lg bg-muted/30 animate-pulse" />)}</div>
      ) : docs.length === 0 ? (
        <EmptyState icon={FileText} title="Nenhum documento" description="Documentos são anexados a OS, projetos, clientes e contratos." />
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Título</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipo</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Versão</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Enviado em</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {docs.map((d) => (
                <tr key={d.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{d.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">{d.type ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">v{d.version}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
