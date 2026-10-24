import { FileUp } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";

export default function ImportsPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Importar dados" description="Importe planilhas (CSV ou Excel) de clientes, produtos, fornecedores, contas e mais." />
      <EmptyState icon={FileUp} title="Importação em construção" description="Aqui você vai escolher a entidade, enviar a planilha, conferir o mapeamento das colunas e simular antes de gravar." />
    </div>
  );
}
