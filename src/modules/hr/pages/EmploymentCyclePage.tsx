import { UserPlus } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function EmploymentCyclePage() {
  return (
    <PagePlaceholder
      icon={UserPlus}
      title="Admissões e desligamentos"
      description="Checklists de entrada e saída de colaboradores."
      message="Aqui você vai acompanhar as etapas de admissão e desligamento de cada colaborador."
    />
  );
}
