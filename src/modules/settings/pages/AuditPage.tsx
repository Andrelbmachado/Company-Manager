// Auditoria: trilha imutável. Os eventos não se editam, então a lista fica só de leitura (sem EditableTable) e cada
// linha já mostra o que antes ficava no painel lateral: entidade, id e quem fez. Clique no cabeçalho ordena e
// Filtrar filtra por coluna (Usuário pelo nome mostrado, Data/hora por período).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/shared/PageHeader";
import { useLabel } from "@/lib/labels/useLabel";
import { EmptyState } from "@/components/shared/EmptyState";
import { NoFilterMatchRow, SortableHeader, TableFilterBar, TableFilterToolbar, useSortFilter, type SortFilterColumn } from "@/components/shared/table";
import { formatDateTime } from "@/lib/utils";

interface AuditLog {
  id: string;
  user_id?: string | null;
  entity_type: string;
  entity_id?: string | null;
  action: string;
  created_at: string;
}

const TH = "px-4 py-3 text-sm";

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
  const logs = useMemo(() => data?.logs ?? [], [data]);
  const userName = (log: AuditLog) => (log.user_id ? data?.names.get(log.user_id) ?? log.user_id : "Sistema");
  const columns: SortFilterColumn<AuditLog>[] = [
    { key: "action", header: "Ação", kind: "text" },
    { key: "entity_type", header: "Entidade", kind: "text" },
    { key: "entity_id", header: "ID da entidade", kind: "text" },
    { key: "user", header: "Usuário", kind: "text", sortValue: userName },
    { key: "created_at", header: "Data/hora", kind: "datetime" },
  ];
  const view = useSortFilter(logs, columns);

  return (
    <div className="space-y-6">
      <PageHeader title={title} description="Trilha imutável de ações sensíveis" />

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/30" />)}</div>
      ) : logs.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nenhum log de auditoria" description="Ações financeiras, exportações e acessos sensíveis aparecem aqui." />
      ) : (
        <div className="rounded-xl border">
          <TableFilterToolbar view={view} />
          <TableFilterBar view={view} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Eventos de auditoria, do mais novo para o mais antigo. Eventos de auditoria são imutáveis.</caption>
              <thead className="bg-muted/30">
                <tr>
                  {columns.map((column) => (
                    <SortableHeader key={column.key} label={column.header} sortKey={column.key} sort={view.sort} onSort={view.toggleSort} className={TH} />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {view.rows.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-mono text-xs">{log.action}</td>
                    <td className="px-4 py-3 text-muted-foreground">{log.entity_type}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{log.entity_id ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{userName(log)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(log.created_at)}</td>
                  </tr>
                ))}
                {!view.rows.length && <NoFilterMatchRow colSpan={columns.length} />}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Eventos de auditoria são imutáveis e não podem ser editados.</p>
    </div>
  );
}
