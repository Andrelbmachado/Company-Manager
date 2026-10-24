import { Landmark } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function BankAccountsPage() {
  return (
    <PagePlaceholder
      icon={Landmark}
      title="Contas bancárias"
      description="Contas, saldos e extratos importados."
      message="Aqui você vai cadastrar as contas bancárias e importar extratos OFX ou CSV."
    />
  );
}
