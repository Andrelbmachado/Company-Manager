import { ClipboardList } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function InventoryCountsPage() {
  return (
    <PagePlaceholder
      icon={ClipboardList}
      title="Inventário"
      description="Contagens de estoque abertas e concluídas."
      message="Aqui você vai abrir contagens de inventário e acompanhar as diferenças encontradas."
    />
  );
}
