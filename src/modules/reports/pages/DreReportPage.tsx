import { FileBarChart } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function DreReportPage() {
  return (
    <PagePlaceholder
      icon={FileBarChart}
      title="DRE"
      description="Resultado por período, com comparação entre meses."
      message="Aqui vai ficar a DRE comparativa, pronta para exportar."
    />
  );
}
