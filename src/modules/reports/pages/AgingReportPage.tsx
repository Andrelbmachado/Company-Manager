import { CalendarClock } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function AgingReportPage() {
  return (
    <PagePlaceholder
      icon={CalendarClock}
      title="Contas a receber e a pagar"
      description="Vencidas e a vencer por faixa de atraso."
      message="Aqui vai ficar o relatório de vencimentos (aging) de contas a receber e a pagar."
    />
  );
}
