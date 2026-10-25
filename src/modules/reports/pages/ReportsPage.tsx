import { Link } from "react-router-dom";
import { BarChart3, CalendarClock, ChevronRight, FileBarChart, PackageSearch, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { canOpenSubpage, SUBPAGES } from "@/app/subpages";
import { useRequiredSession } from "@/hooks/useSession";
import { useLabel } from "@/lib/labels/useLabel";
import type { Role } from "@/types";

const ICONS: Record<string, LucideIcon> = {
  "/reports/vendas": BarChart3,
  "/reports/contas": CalendarClock,
  "/reports/estoque": PackageSearch,
  "/reports/dre": FileBarChart,
};

/** Visão geral dos relatórios: só os que o papel pode abrir (cada um exige ver os dados de origem). */
export default function ReportsPage() {
  const session = useRequiredSession();
  const title = useLabel("module.reports");
  const role = session.membership.role as Role;
  const pages = SUBPAGES.filter((page) => page.module === "reports" && canOpenSubpage(role, page));

  return (
    <div className="space-y-5">
      <PageHeader title={title} />
      {pages.length === 0 ? (
        <EmptyState icon={BarChart3} title="Nenhum relatório disponível" />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {pages.map((page) => {
            const Icon = ICONS[page.path] ?? BarChart3;
            return (
              <li key={page.path}>
                <Link to={page.path} className="group flex h-full items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-2">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon size={18} aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-2 font-semibold">
                    {page.label}
                    <ChevronRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
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
