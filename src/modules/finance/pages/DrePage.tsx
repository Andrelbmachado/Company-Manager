import { Calculator } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function DrePage() {
  return (
    <PagePlaceholder
      icon={Calculator}
      title="DRE"
      description="Demonstração do resultado pelo plano de contas."
      message="Aqui vai ficar a DRE do período, com receitas, custos e despesas agrupados pelo plano de contas."
    />
  );
}
