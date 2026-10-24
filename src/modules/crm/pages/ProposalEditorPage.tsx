import { FilePen } from "lucide-react";
import { useParams } from "react-router-dom";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

/** :id = "nova" abre o formulário de criação. */
export default function ProposalEditorPage() {
  const { id } = useParams();
  return (
    <PagePlaceholder
      icon={FilePen}
      title={id === "nova" ? "Nova proposta" : "Proposta"}
      description="Itens, condições e envio da proposta."
      message="Aqui você vai montar a proposta com itens do catálogo, descontos e condições de pagamento."
    />
  );
}
