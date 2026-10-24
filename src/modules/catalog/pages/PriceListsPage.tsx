import { BadgeDollarSign } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function PriceListsPage() {
  return (
    <PagePlaceholder
      icon={BadgeDollarSign}
      title="Tabelas de preço"
      description="Preços especiais por cliente, canal ou período."
      message="Aqui você vai criar tabelas de preço e definir o preço de cada produto nelas."
    />
  );
}
