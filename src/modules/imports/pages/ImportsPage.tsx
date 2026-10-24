// Importar dados: escolhe o cadastro (só os que o papel pode criar), envia a planilha, confere colunas e prévia,
// simula ou importa. `?entity=customers` já abre com o cadastro escolhido.
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FileUp, History } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { useRequiredSession } from "@/hooks/useSession";
import { importableEntities } from "@/lib/importexport/access";
import { can } from "@/lib/permissions/rbac";
import type { Role } from "@/types";
import { ImportWizard } from "../components/ImportWizard";

export default function ImportsPage() {
  const session = useRequiredSession();
  const role = session.membership.role as Role;
  const [params] = useSearchParams();
  const entities = useMemo(() => importableEntities(role), [role]);
  const initialEntity = params.get("entity");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Importar dados"
        description="Traga planilhas (CSV ou Excel) de clientes, produtos, fornecedores, contas e mais. Linhas que já existem são atualizadas, não duplicadas."
        actions={
          can(role, "view", "imports") ? (
            <Link to="/imports/historico" className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
              <History size={14} aria-hidden="true" /> Histórico
            </Link>
          ) : null
        }
      />
      {entities.length === 0 ? (
        <EmptyState icon={FileUp} title="Seu perfil não importa dados" description="Peça a quem administra o sistema para importar a planilha ou liberar o cadastro para o seu perfil." />
      ) : (
        <div className="rounded-xl border bg-card p-5">
          <ImportWizard key={initialEntity ?? "todos"} entities={entities} initialEntity={initialEntity} />
        </div>
      )}
    </div>
  );
}
