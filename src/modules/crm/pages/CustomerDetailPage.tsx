import { UserRound } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function CustomerDetailPage() {
  return (
    <PagePlaceholder
      icon={UserRound}
      title="Ficha do cliente"
      description="Dados, contatos, oportunidades, propostas, pedidos, faturas, tickets e atividades do cliente."
      message="Aqui vai ficar a ficha completa do cliente, com a linha do tempo de tudo o que aconteceu com ele."
    />
  );
}
