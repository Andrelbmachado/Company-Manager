// Auditoria: trilha imutável. Os eventos não se editam, então a lista fica só de leitura (sem EditableTable) e cada
// linha já mostra o que antes ficava no painel lateral: entidade, id e quem fez.
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/shared/PageHeader";
import { useLabel } from "@/lib/labels/useLabel";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatDateTime } from "@/lib/utils";

interface AuditLog {
  id: string;
  user_id?: string | null;
  entity_type: string;
  entity_id?: string | null;
  action: string;
  created_at: string;
}

const TH = "px-4 py-3 text-left font-medium text-muted-foreground";

export default function AuditPage() {
  const session = useRequiredSession();
  const title = useLabel("module.audit");

  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", session.company.id],
    queryFn: async () => {
      const db = await getDb();
      const [logs, users] = await Promise.all([
        db.select<AuditLog[]>("SELECT * FROM audit_logs WHERE company_id=? ORDER BY created_at DESC LIMIT 200", [session.company.id]),
        db.select<{ id: string; name: string }[]>("SELECT id, name FROM users"),
      ]);
      return { logs, names: new Map(users.map((user) => [user.id, user.name])) };
    },
  });
  const logs = data?.logs ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={title} description="Trilha imutável de ações sensíveis" />

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/30" />)}</div>
      ) : logs.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nenhum log de auditoria" description="Ações financeiras, exportações e acessos sensíveis aparecem aqui." />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <caption className="sr-only">Eventos de auditoria, do mais novo para o mais antigo. Eventos de auditoria são imutáveis.</caption>
            <thead className="bg-muted/30">
              <tr>
                <th scope="col" className={TH}>Ação</th>
                <th scope="col" className={TH}>Entidade</th>
                <th scope="col" className={TH}>ID da entidade</th>
                <th scope="col" className={TH}>Usuário</th>
                <th scope="col" className={TH}>Data/hora</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-mono text-xs">{log.action}</td>
                  <td className="px-4 py-3 text-muted-foreground">{log.entity_type}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{log.entity_id ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{log.user_id ? data?.names.get(log.user_id) ?? log.user_id : "Sistema"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(log.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Eventos de auditoria são imutáveis e não podem ser editados.</p>
    </div>
  );
}
