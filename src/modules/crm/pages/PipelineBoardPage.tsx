import { Kanban } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function PipelineBoardPage() {
  return (
    <PagePlaceholder
      icon={Kanban}
      title="Funil de vendas"
      description="Oportunidades por etapa do funil."
      message="Aqui vai ficar o quadro do funil, com as oportunidades arrastáveis entre as etapas e o valor de cada coluna."
    />
  );
}
