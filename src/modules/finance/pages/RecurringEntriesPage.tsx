import { Repeat } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function RecurringEntriesPage() {
  return (
    <PagePlaceholder
      icon={Repeat}
      title="Lançamentos recorrentes"
      description="Aluguel, assinaturas, contratos e outros lançamentos que se repetem."
      message="Aqui você vai cadastrar lançamentos recorrentes e gerar as contas de cada mês."
    />
  );
}
