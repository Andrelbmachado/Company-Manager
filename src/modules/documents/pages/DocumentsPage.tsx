import { useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { useLabel } from "@/lib/labels/useLabel";
import type { Role } from "@/types";
import { AttachmentsBrowser } from "../components/AttachmentsBrowser";
import { DocumentFolders } from "../components/DocumentFolders";

const TABS = [
  { id: "pastas", label: "Pastas" },
  { id: "anexos", label: "Anexos de registros" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * Documentos com arquivo de verdade (lib/files/store.ts): pastas por setor, envio múltiplo e arrastar, pré-visualização,
 * download, versões; pastas de nuvem conectadas (lib/files/cloudFolders.ts, só no desktop); e a consulta dos anexos
 * enviados nas fichas dos registros.
 */
export default function DocumentsPage() {
  const session = useRequiredSession();
  const role = session.membership.role as Role;
  const canUpload = usePermission("attach", "documents");
  const canEdit = usePermission("edit", "documents");
  const canDelete = usePermission("delete", "documents");
  // Mesmo rótulo da sidebar e da busca (perfil de área, editável em Configurações > Área da empresa).
  const title = useLabel("module.documents");
  const [tab, setTab] = useState<TabId>("pastas");

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        description={canUpload ? "Pastas e arquivos da sua área: envie, arraste, visualize, baixe e acompanhe as versões." : "Pastas e arquivos compartilhados com a sua área."}
        className="pb-2"
      />
      <div>
        <TabList tabs={TABS} value={tab} onChange={setTab} label="Seções de documentos" idPrefix="documentos" />
      </div>
      {/* Pastas fica montada (só escondida) enquanto os anexos aparecem: a pasta aberta e o rascunho da tabela não se perdem. */}
      <div hidden={tab !== "pastas"}>
        <TabPanel idPrefix="documentos" id="pastas">
          <DocumentFolders role={role} companyId={session.company.id} userId={session.user.id} canUpload={canUpload} canEdit={canEdit} canDelete={canDelete} />
        </TabPanel>
      </div>
      {tab === "anexos" && (
        <TabPanel idPrefix="documentos" id="anexos">
          <AttachmentsBrowser role={role} companyId={session.company.id} canDelete={canDelete} />
        </TabPanel>
      )}
    </div>
  );
}
