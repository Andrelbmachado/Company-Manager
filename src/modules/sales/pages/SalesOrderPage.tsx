import { ShoppingCart } from "lucide-react";
import { useParams } from "react-router-dom";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

/** :id = "nova" abre o formulário de criação. */
export default function SalesOrderPage() {
  const { id } = useParams();
  return (
    <PagePlaceholder
      icon={ShoppingCart}
      title={id === "nova" ? "Novo pedido de venda" : "Pedido de venda"}
      description="Itens, entrega, faturamento e baixa no estoque."
      message="Aqui vai ficar o pedido de venda, com os itens, o faturamento em parcelas e a saída do estoque."
    />
  );
}
