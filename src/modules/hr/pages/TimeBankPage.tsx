import { Timer } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function TimeBankPage() {
  return (
    <PagePlaceholder
      icon={Timer}
      title="Banco de horas da equipe"
      description="Saldos e lançamentos de horas dos colaboradores."
      message="Aqui você vai lançar horas extras e compensações e acompanhar o saldo de cada colaborador."
    />
  );
}
