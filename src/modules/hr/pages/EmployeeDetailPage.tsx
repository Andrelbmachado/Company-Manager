import { IdCard } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function EmployeeDetailPage() {
  return (
    <PagePlaceholder
      icon={IdCard}
      title="Colaborador"
      description="Dados pessoais, admissão, documentos e histórico."
      message="Aqui vai ficar a ficha do colaborador, com dados de admissão, contato de emergência e histórico."
    />
  );
}
