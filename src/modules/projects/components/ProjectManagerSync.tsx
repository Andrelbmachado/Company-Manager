import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { exportProjectBundle, importProjectBundle, parseBundle } from "@/lib/integrations/projectBundle";
import { pickTextFile, saveTextFile } from "@/lib/integrations/files";

const buttonClass = "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";

/** Troca de projetos e tarefas com o Project Manager por arquivo JSON (contrato em lib/integrations/projectBundle.ts). */
export function ProjectManagerSync() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const message = (error: unknown) => String(error instanceof Error ? error.message : error);

  const exportMutation = useMutation({
    mutationFn: async () => {
      const bundle = await exportProjectBundle(await getDb(), session.company.id);
      const saved = await saveTextFile(`company-manager-projetos-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2));
      return saved ? `Exportado para o Project Manager: ${bundle.projects.length} projeto(s) e ${bundle.tasks.length} tarefa(s).` : null;
    },
    onSuccess: (text) => text && setNotice({ kind: "ok", text }),
    onError: (error) => setNotice({ kind: "error", text: message(error) }),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const content = await pickTextFile();
      if (content === null) return null;
      const summary = await importProjectBundle(await getDb(), session, parseBundle(content));
      await emit({
        type: "project_bundle.imported",
        companyId: session.company.id,
        actorId: session.user.id,
        entityType: "project",
        entityId: "bundle",
        title: `Importado do Project Manager: ${summary.projects.created + summary.projects.updated} projeto(s), ${summary.tasks.created + summary.tasks.updated} tarefa(s)`,
        module: "projects",
        metadata: { ...summary },
      });
      return summary;
    },
    onSuccess: (summary) => {
      if (!summary) return;
      const { projects, tasks } = summary;
      setNotice({ kind: "ok", text: `Importado: ${projects.created} projeto(s) novo(s), ${projects.updated} atualizado(s); ${tasks.created} tarefa(s) nova(s), ${tasks.updated} atualizada(s); ${projects.skipped + tasks.skipped} ignorado(s).` });
      for (const key of ["projects", "tasks"]) qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (error) => setNotice({ kind: "error", text: message(error) }),
  });

  return (
    <>
      <button onClick={() => importMutation.mutate()} disabled={importMutation.isPending} className={buttonClass}><Upload size={14} /> Importar do Project Manager</button>
      <button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending} className={buttonClass}><Download size={14} /> Exportar para o Project Manager</button>
      {notice && (
        <p role="status" className={`fixed bottom-4 right-4 z-50 max-w-md rounded-lg border px-4 py-2.5 text-sm shadow-lg ${notice.kind === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
          {notice.text} <button onClick={() => setNotice(null)} className="ml-2 font-medium underline">fechar</button>
        </p>
      )}
    </>
  );
}
