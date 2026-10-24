import { ListTree } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function FinanceCategoriesPage() {
  return (
    <PagePlaceholder
      icon={ListTree}
      title="Plano de contas"
      description="Categorias de receita, custo e despesa."
      message="Aqui você vai organizar o plano de contas usado nos lançamentos e na DRE."
    />
  );
}
