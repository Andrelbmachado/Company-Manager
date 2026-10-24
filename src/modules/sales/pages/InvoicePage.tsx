import { Receipt } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function InvoicePage() {
  return (
    <PagePlaceholder
      icon={Receipt}
      title="Fatura"
      description="Itens, parcelas e recebimentos da fatura."
      message="Aqui vai ficar a fatura, com as parcelas geradas em contas a receber."
    />
  );
}
