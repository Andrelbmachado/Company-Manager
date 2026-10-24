import { Receipt } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function InvoicesPage() {
  return (
    <PagePlaceholder
      icon={Receipt}
      title="Faturas"
      description="Faturas emitidas e parcelas a receber."
      message="Aqui vai ficar a lista de faturas, com status de pagamento e vencimentos."
    />
  );
}
