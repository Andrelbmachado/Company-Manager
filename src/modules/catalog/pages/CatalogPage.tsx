import { Tags } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";

export default function CatalogPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Catálogo" description="Produtos, serviços e tabelas de preço usados em vendas, compras e estoque." />
      <EmptyState icon={Tags} title="Catálogo em construção" description="Aqui você vai cadastrar produtos e serviços, preços, custos e tabelas de preço." />
    </div>
  );
}
