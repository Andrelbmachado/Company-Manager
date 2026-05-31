import { useQuery } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDateTime } from "@/lib/utils";
import { Wrench } from "lucide-react";
import type { WorkOrder } from "@/types";

export default function WorkOrdersPage() {
  const session = useRequiredSession();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["work-orders", session.company.id],
    queryFn: async () => {
      const db = await getDb();
      return db.select<WorkOrder[]>(
        "SELECT * FROM work_orders WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at DESC",
        [session.company.id]
      );
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Ordens de Serviço" description="Gestão de OS" />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="Nenhuma ordem de serviço"
          description="OS são criadas ao converter tickets ou diretamente."
        />
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Número</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Prioridade</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Aberta em</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Custo M.O.</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Custo Mat.</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{o.number}</td>
                  <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-3"><StatusBadge status={o.priority} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(o.opened_at)}</td>
                  <td className="px-4 py-3 text-muted-foreground">R$ {o.labor_cost.toFixed(2)}</td>
                  <td className="px-4 py-3 text-muted-foreground">R$ {o.materials_cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
