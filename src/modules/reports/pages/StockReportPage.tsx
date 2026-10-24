import { PackageSearch } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function StockReportPage() {
  return (
    <PagePlaceholder
      icon={PackageSearch}
      title="Giro de estoque"
      description="Saídas, cobertura e itens parados."
      message="Aqui vai ficar o relatório de giro de estoque, com os itens sem movimento."
    />
  );
}
