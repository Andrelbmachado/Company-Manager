import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";

export default function ReportsPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Relatórios" description="DRE, fluxo de caixa, vendas, compras e estoque, conforme as permissões do seu papel." />
      <EmptyState icon={BarChart3} title="Relatórios em construção" description="Cada relatório só aparece para quem pode ver os dados de origem." />
    </div>
  );
}
