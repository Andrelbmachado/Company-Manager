import { PackageCheck } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function GoodsReceiptsPage() {
  return (
    <PagePlaceholder
      icon={PackageCheck}
      title="Recebimentos"
      description="Entradas de mercadoria dos pedidos de compra."
      message="Aqui vai ficar o histórico de recebimentos, com a entrada no estoque e as contas a pagar geradas."
    />
  );
}
