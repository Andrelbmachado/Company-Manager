import { Factory } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function SuppliersPage() {
  return (
    <PagePlaceholder
      icon={Factory}
      title="Fornecedores"
      description="Cadastro de fornecedores de produtos e serviços."
      message="Aqui você vai cadastrar fornecedores, com documento, contato e condições de pagamento."
    />
  );
}
