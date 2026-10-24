import { Truck } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";

export default function PurchasingPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Compras" description="Pedidos de compra, aprovação e recebimento de mercadoria." />
      <EmptyState icon={Truck} title="Compras em construção" description="Aqui você vai criar pedidos de compra, aprová-los e dar entrada no estoque, gerando as contas a pagar." />
    </div>
  );
}
