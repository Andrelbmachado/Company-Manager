import { Merge } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function DuplicatesPage() {
  return (
    <PagePlaceholder
      icon={Merge}
      title="Clientes duplicados"
      description="Clientes com o mesmo documento, e-mail ou nome parecido."
      message="Aqui você vai revisar clientes repetidos e mesclar um no outro sem perder o histórico."
    />
  );
}
