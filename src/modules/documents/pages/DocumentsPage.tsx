import { PageHeader } from "@/components/shared/PageHeader";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { useLabel } from "@/lib/labels/useLabel";
import type { Role } from "@/types";
import { DocumentFolders } from "../components/DocumentFolders";

/**
 * Documentos com arquivo de verdade (lib/files/store.ts): pastas por setor, envio múltiplo e arrastar, pré-visualização,
 * download, versões; pastas de nuvem conectadas (lib/files/cloudFolders.ts, só no desktop). O caminho começa em "Raiz /"
 * e a raiz só mostra pastas. Os anexos de cada registro ficam na ficha dele.
 */
export default function DocumentsPage() {
  const session = useRequiredSession();
  const role = session.membership.role as Role;
  const canUpload = usePermission("attach", "documents");
  const canEdit = usePermission("edit", "documents");
  const canDelete = usePermission("delete", "documents");
  // Mesmo rótulo da sidebar e da busca (perfil de área, editável em Configurações > Área da empresa).
  const title = useLabel("module.documents");

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        className="pb-2"
      />
      <DocumentFolders role={role} companyId={session.company.id} userId={session.user.id} canUpload={canUpload} canEdit={canEdit} canDelete={canDelete} />
    </div>
  );
}
