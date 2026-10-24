import { BarChart3 } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function SalesReportPage() {
  return (
    <PagePlaceholder
      icon={BarChart3}
      title="Relatório de vendas"
      description="Vendas por período, vendedor, cliente e produto."
      message="Aqui vai ficar o relatório de vendas com gráficos e exportação."
    />
  );
}
