import { FileSignature } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";

export default function ProposalsPage() {
  return (
    <PagePlaceholder
      icon={FileSignature}
      title="Propostas"
      description="Propostas comerciais enviadas aos clientes."
      message="Aqui vai ficar a lista de propostas, com status, validade e valor."
    />
  );
}
