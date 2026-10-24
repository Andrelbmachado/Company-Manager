import { ArrowLeftRight } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function StockMovementsPage() {
  return (
    <PagePlaceholder
      icon={ArrowLeftRight}
      title="Movimentações de estoque"
      description="Entradas, saídas, transferências e ajustes."
      message="Aqui vai ficar o extrato de movimentações de cada item, com a origem de cada uma."
    />
  );
}
