import { TrendingUp } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function CashflowPage() {
  return (
    <PagePlaceholder
      icon={TrendingUp}
      title="Fluxo de caixa"
      description="Entradas e saídas previstas e realizadas."
      message="Aqui vai ficar o fluxo de caixa por dia, semana ou mês, com o saldo projetado."
    />
  );
}
