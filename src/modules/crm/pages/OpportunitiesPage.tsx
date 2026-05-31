import { useQuery } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Target } from "lucide-react";
import type { Opportunity } from "@/types";

const STAGES = ["novo", "qualificacao", "proposta", "negociacao", "ganho", "perdido"] as const;

export default function OpportunitiesPage() {
  const session = useRequiredSession();

  const { data: opps = [], isLoading } = useQuery({
    queryKey: ["opportunities", session.company.id],
    queryFn: async () => {
      const db = await getDb();
      return db.select<Opportunity[]>(
        "SELECT * FROM opportunities WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at DESC",
        [session.company.id]
      );
    },
  });

  const byStage = Object.fromEntries(STAGES.map((s) => [s, opps.filter((o) => o.stage === s)]));

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Oportunidades" description="Funil de vendas" />
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          {STAGES.map((s) => (
            <div key={s} className="h-48 rounded-xl bg-muted/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Oportunidades" description="Funil de vendas" />

      {opps.length === 0 ? (
        <EmptyState icon={Target} title="Nenhuma oportunidade" description="Cadastre oportunidades vinculadas a clientes." />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-start">
          {STAGES.map((stage) => {
            const items = byStage[stage] ?? [];
            const total = items.reduce((s, o) => s + o.value, 0);
            return (
              <div key={stage} className="rounded-xl border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <StatusBadge status={stage} />
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                <p className="text-xs font-medium text-muted-foreground">{formatCurrency(total)}</p>
                <div className="space-y-2">
                  {items.map((o) => (
                    <div key={o.id} className="rounded-lg border bg-background p-2 text-xs space-y-1">
                      <p className="font-medium truncate">{o.title}</p>
                      <p className="text-muted-foreground">{formatCurrency(o.value)}</p>
                      {o.expected_close_date && (
                        <p className="text-muted-foreground">Fecha: {formatDate(o.expected_close_date)}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
