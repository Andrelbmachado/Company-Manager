import { PackagePlus } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function ReorderPage() {
  return (
    <PagePlaceholder
      icon={PackagePlus}
      title="Reposição"
      description="Itens abaixo do estoque mínimo."
      message="Aqui vai ficar a lista de itens para repor, com a sugestão de compra por fornecedor."
    />
  );
}
