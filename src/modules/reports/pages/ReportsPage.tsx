import { Link } from "react-router-dom";
import { BarChart3, CalendarClock, ChevronRight, FileBarChart, PackageSearch, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { canOpenSubpage, SUBPAGES } from "@/app/subpages";
import { useRequiredSession } from "@/hooks/useSession";
import { useLabel } from "@/lib/labels/useLabel";
import { can } from "@/lib/permissions/rbac";
import type { Role } from "@/types";

const DETAILS: Record<string, { icon: LucideIcon; description: string }> = {
  "/reports/vendas": { icon: BarChart3, description: "Faturamento, pedidos e ticket médio por período, cliente, vendedor e produto." },
  "/reports/contas": { icon: CalendarClock, description: "Contas a receber e a pagar em aberto por faixa de atraso (aging)." },
  "/reports/estoque": { icon: PackageSearch, description: "Saídas, saldo médio, cobertura em dias e itens parados." },
  "/reports/dre": { icon: FileBarChart, description: "Resultado mês a mês pelo plano de contas, com análise vertical." },
};

/** Visão geral dos relatórios: só os que o papel pode abrir (cada um exige ver os dados de origem). */
export default function ReportsPage() {
  const session = useRequiredSession();
  const title = useLabel("module.reports");
  const role = session.membership.role as Role;
  const pages = SUBPAGES.filter((page) => page.module === "reports" && canOpenSubpage(role, page));
  const canExport = can(role, "export", "reports");

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        description={canExport ? "Escolha um relatório. Todos exportam em CSV, Excel e PDF (pela impressão)." : "Escolha um relatório. Exportar fica com quem tem permissão de exportar relatórios."}
      />
      {pages.length === 0 ? (
        <EmptyState icon={BarChart3} title="Nenhum relatório disponível" description="Cada relatório só aparece para quem pode ver os dados de origem (vendas, financeiro ou estoque)." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {pages.map((page) => {
            const detail = DETAILS[page.path];
            const Icon = detail?.icon ?? BarChart3;
            return (
              <li key={page.path}>
                <Link to={page.path} className="group flex h-full items-start gap-4 rounded-xl border bg-card p-5 transition-colors hover:bg-muted/40 focus-visible:outline-2">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon size={18} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 font-semibold">
                      {page.label}
                      <ChevronRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                    {detail && <span className="mt-1 block text-sm text-muted-foreground">{detail.description}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
