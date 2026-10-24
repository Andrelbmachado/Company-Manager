import { Warehouse } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function StockLocationsPage() {
  return (
    <PagePlaceholder
      icon={Warehouse}
      title="Locais de estoque"
      description="Depósitos, prateleiras e veículos onde ficam os itens."
      message="Aqui você vai cadastrar os locais de estoque e ver o saldo de cada um."
    />
  );
}
