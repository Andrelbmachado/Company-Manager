import { Truck } from "lucide-react";
import { useParams } from "react-router-dom";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

/** :id = "nova" abre o formulário de criação. */
export default function PurchaseOrderPage() {
  const { id } = useParams();
  return (
    <PagePlaceholder
      icon={Truck}
      title={id === "nova" ? "Novo pedido de compra" : "Pedido de compra"}
      description="Itens, fornecedor, recebimento e contas a pagar."
      message="Aqui vai ficar o pedido de compra, com o recebimento parcial ou total da mercadoria."
    />
  );
}
