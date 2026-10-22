import { useEffect, useMemo, useState } from "react";
import { getDb } from "@/lib/db/client";
import type { DatabaseLike } from "@/lib/db/demo";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { ProjectManagerModule } from "@/modules/project-manager";

/**
 * Projetos = módulo do Project Manager embutido (src/modules/project-manager, copiado do app Project Manager).
 * Usa o mesmo banco do Company Manager (tabelas projects, project_stages e tasks) e as permissões do recurso `projects`.
 */
export default function ProjectsPage() {
  const session = useRequiredSession();
  const canEdit = usePermission("edit", "projects");
  const canCreate = usePermission("create", "projects");
  const canExport = usePermission("export", "projects");
  const [db, setDb] = useState<DatabaseLike | null>(null);

  useEffect(() => {
    void getDb().then(setDb);
  }, []);

  // Quem não pode exportar projetos não recebe os botões de arquivo (nem o de importar).
  const fileExchange = useMemo(
    () => (canExport ? { importLabel: "Importar do app Project Manager", exportLabel: "Exportar para o app Project Manager", source: "company-manager" as const } : undefined),
    [canExport],
  );

  if (!db) return <div className="h-36 animate-pulse rounded-xl border bg-card" />;
  return (
    <ProjectManagerModule
      db={db}
      companyId={session.company.id}
      userId={session.user.id}
      canEdit={canEdit}
      canCreate={canCreate}
      fileExchange={fileExchange}
    />
  );
}
