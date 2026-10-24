import { ArrowRightLeft } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function StockTransfersPage() {
  return (
    <PagePlaceholder
      icon={ArrowRightLeft}
      title="Transferências"
      description="Envio de itens entre locais de estoque."
      message="Aqui você vai transferir itens de um local para outro, com o saldo conferido na hora."
    />
  );
}
