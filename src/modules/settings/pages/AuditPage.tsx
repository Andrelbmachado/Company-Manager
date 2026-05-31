import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/shared/PageHeader";
import { DetailDrawer, DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatDateTime } from "@/lib/utils";
import { ShieldCheck } from "lucide-react";

interface AuditLog {
  id: string;
  user_id?: string | null;
  entity_type: string;
  entity_id?: string | null;
  action: string;
  created_at: string;
}

export default function AuditPage() {
  const session = useRequiredSession();
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["audit-logs", session.company.id],
    queryFn: async () => {
      const db = await getDb();
      return db.select<AuditLog[]>(
        "SELECT * FROM audit_logs WHERE company_id=? ORDER BY created_at DESC LIMIT 200",
        [session.company.id]
      );
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Auditoria" description="Trilha imutável de ações sensíveis" />

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted/30 animate-pulse" />)}</div>
      ) : logs.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nenhum log de auditoria" description="Ações financeiras, exportações e acessos sensíveis aparecem aqui." />
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ação</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Entidade</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Data/hora</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((l) => (
                <tr key={l.id} onClick={() => setSelected(l)} className="cursor-pointer hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs">{l.action}</td>
                  <td className="px-4 py-3 text-muted-foreground">{l.entity_type}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && <DetailDrawer title={selected.action} subtitle="Evento de auditoria" onClose={() => setSelected(null)}><DetailGrid><DetailItem label="Entidade" value={selected.entity_type} /><DetailItem label="ID da entidade" value={selected.entity_id} /><DetailItem label="Usuario" value={selected.user_id} /><DetailItem label="Data e hora" value={formatDateTime(selected.created_at)} /></DetailGrid><p className="mt-6 text-xs text-muted-foreground">Eventos de auditoria sao imutaveis e nao podem ser editados.</p></DetailDrawer>}
    </div>
  );
}
