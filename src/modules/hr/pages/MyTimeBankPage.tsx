import { Clock } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function MyTimeBankPage() {
  return (
    <PagePlaceholder
      icon={Clock}
      title="Meu banco de horas"
      description="Seu saldo de horas extras e compensações."
      message="Aqui vai ficar o seu extrato de banco de horas, com o saldo do mês."
    />
  );
}
