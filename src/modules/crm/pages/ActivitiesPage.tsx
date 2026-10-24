import { CalendarCheck } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function ActivitiesPage() {
  return (
    <PagePlaceholder
      icon={CalendarCheck}
      title="Atividades"
      description="Ligações, reuniões, e-mails e tarefas do CRM."
      message="Aqui vai ficar a agenda de atividades com clientes, com as atrasadas em destaque."
    />
  );
}
