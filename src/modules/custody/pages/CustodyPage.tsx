import { useQuery } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDateTime } from "@/lib/utils";
import { Archive } from "lucide-react";
import type { Custody } from "@/types";

interface CustodyView extends Custody {
  item_name?: string;
  holder_name?: string;
}

export default function CustodyPage() {
  const session = useRequiredSession();

  const { data: custodies = [], isLoading } = useQuery({
    queryKey: ["custodies", session.company.id],
    queryFn: async () => {
      const db = await getDb();
      return db.select<CustodyView[]>(
        `SELECT c.*, i.name as item_name, u.name as holder_name
         FROM custodies c
         LEFT JOIN inventory_items i ON i.id = c.item_id
         LEFT JOIN users u ON u.id = c.holder_id
         WHERE c.company_id=? AND c.deleted_at IS NULL
         ORDER BY c.checked_out_at DESC`,
        [session.company.id]
      );
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Custódia" description="Peças e ativos em posse de técnicos" />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : custodies.length === 0 ? (
        <EmptyState icon={Archive} title="Nenhuma custódia ativa" description="Custódias são criadas ao retirar itens do estoque em uma OS." />
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Item</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Responsável</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Qtd.</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Retirada</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Devolução prev.</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {custodies.map((c) => (
                <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{c.item_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.holder_name ?? "—"}</td>
                  <td className="px-4 py-3">{c.quantity}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(c.checked_out_at)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.due_back_at ? formatDateTime(c.due_back_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
