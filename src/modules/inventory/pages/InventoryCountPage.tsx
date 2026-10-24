import { ClipboardCheck } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function InventoryCountPage() {
  return (
    <PagePlaceholder
      icon={ClipboardCheck}
      title="Contagem de inventário"
      description="Itens contados, diferenças e ajuste do saldo."
      message="Aqui vai ficar a contagem, com o lançamento das quantidades e o ajuste automático do estoque."
    />
  );
}
