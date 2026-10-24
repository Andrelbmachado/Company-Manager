import { History } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function ImportHistoryPage() {
  return (
    <PagePlaceholder
      icon={History}
      title="Histórico de importações"
      description="Importações feitas, com linhas importadas e erros."
      message="Aqui vai ficar o histórico de importações de planilhas, com o relatório de erros de cada uma."
    />
  );
}
