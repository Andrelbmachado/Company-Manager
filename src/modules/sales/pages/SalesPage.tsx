import { ShoppingCart } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";

export default function SalesPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Vendas" description="Pedidos de venda, faturamento e parcelas a receber." />
      <EmptyState icon={ShoppingCart} title="Vendas em construção" description="Aqui você vai criar pedidos de venda, confirmá-los e gerar faturas com as parcelas em contas a receber." />
    </div>
  );
}
