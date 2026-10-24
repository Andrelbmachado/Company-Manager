import { Contact } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function ContactsPage() {
  return (
    <PagePlaceholder
      icon={Contact}
      title="Contatos"
      description="Pessoas de contato dos clientes."
      message="Aqui você vai cadastrar e buscar os contatos de cada cliente, com cargo, e-mail e telefone."
    />
  );
}
