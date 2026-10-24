import { ListChecks } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function ReconciliationPage() {
  return (
    <PagePlaceholder
      icon={ListChecks}
      title="Conciliação bancária"
      description="Lançamentos do extrato ligados a contas a pagar e a receber."
      message="Aqui você vai conciliar cada lançamento do extrato com a conta paga ou recebida correspondente."
    />
  );
}
