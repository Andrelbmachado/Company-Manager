import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FolderKanban, Plus, Upload } from "lucide-react";
import { FormDialog } from "../ui/Dialog";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import { StatusBadge, STATUS_LABELS } from "../ui/StatusBadge";
import { formatCurrency, formatDay } from "../ui/format";
import { buildFlow } from "../flow";
import { useProjectManager } from "../context";
import { exportBundle, importBundle, parseBundle, type ImportSummary } from "../integration/bundle";
import { pickTextFile, saveTextFile } from "../integration/files";
import { PROJECT_STATUSES, type Project, type ProjectStatus } from "../types";

const EMPTY = { name: "", status: "planejado", budget: "0", start_date: "", end_date: "" };

function describe(summary: ImportSummary): string {
  const { projects, stages, tasks } = summary;
  const skipped = projects.skipped + stages.skipped + tasks.skipped;
  return `Importado: ${projects.created} projeto(s) novo(s) e ${projects.updated} atualizado(s); ${stages.created} etapa(s) nova(s); ${tasks.created} tarefa(s) nova(s) e ${tasks.updated} atualizada(s); ${skipped} ignorado(s).`;
}

export default function ProjectsPage() {
  const { db, companyId, userId, canEdit, canCreate, fileExchange, repo } = useProjectManager();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const { data: projects = [], isLoading } = useQuery({ queryKey: ["pm", "projects", companyId], queryFn: repo.listProjects });
  const { data: tasks = [] } = useQuery({ queryKey: ["pm", "tasks", companyId], queryFn: repo.listAllTasks });
  const { data: stages = [] } = useQuery({ queryKey: ["pm", "stages", companyId], queryFn: repo.listAllStages });

  const flows = useMemo(() => new Map(projects.map((project) => [
    project.id,
    buildFlow(stages.filter((stage) => stage.project_id === project.id), tasks.filter((task) => task.project_id === project.id)),
  ])), [projects, stages, tasks]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["pm"] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input = {
        name: form.name.trim(),
        status: form.status as ProjectStatus,
        budget: Number(form.budget) || 0,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      };
      if (dialog === "edit" && editing) await repo.updateProject(editing.id, input);
      else await repo.createProject(input);
    },
    onSuccess: () => { void refresh(); setDialog(null); setEditing(null); setForm(EMPTY); },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const bundle = await exportBundle(db, companyId, fileExchange ? undefined : "project-manager");
      const saved = await saveTextFile(`project-manager-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2));
      return saved ? `Exportado: ${bundle.projects.length} projeto(s), ${bundle.stages.length} etapa(s) e ${bundle.tasks.length} tarefa(s).` : null;
    },
    onSuccess: (text) => text && setNotice({ kind: "ok", text }),
    onError: (error) => setNotice({ kind: "error", text: String(error instanceof Error ? error.message : error) }),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const content = await pickTextFile();
      if (content === null) return null;
      return importBundle(db, companyId, userId, parseBundle(content));
    },
    onSuccess: (summary) => { if (summary) { setNotice({ kind: "ok", text: describe(summary) }); void refresh(); } },
    onError: (error) => setNotice({ kind: "error", text: String(error instanceof Error ? error.message : error) }),
  });

  function openCreate() {
    setForm(EMPTY);
    setEditing(null);
    setDialog("create");
  }

  function openEdit(project: Project) {
    setForm({ name: project.name, status: project.status, budget: String(project.budget), start_date: project.start_date?.slice(0, 10) ?? "", end_date: project.end_date?.slice(0, 10) ?? "" });
    setEditing(project);
    setDialog("edit");
  }

  const buttonClass = "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projetos"
        description="Plano em etapas, tarefas e andamento de cada projeto."
        actions={
          <>
            {fileExchange && canEdit && <button onClick={() => importMutation.mutate()} disabled={importMutation.isPending} className={buttonClass}><Upload size={14} /> {fileExchange.importLabel}</button>}
            {fileExchange && <button onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending || projects.length === 0} className={buttonClass}><Download size={14} /> {fileExchange.exportLabel}</button>}
            {canCreate && (
              <button onClick={openCreate} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                <Plus size={14} /> Novo projeto
              </button>
            )}
          </>
        }
      />

      {notice && (
        <p role="status" className={notice.kind === "ok" ? "rounded-lg border border-status-success bg-card px-4 py-2.5 text-sm" : "rounded-lg border border-status-danger bg-card px-4 py-2.5 text-sm"}>
          <strong className={notice.kind === "ok" ? "text-status-success dark:text-green-400" : "text-status-danger dark:text-red-400"}>{notice.kind === "ok" ? "Pronto. " : "Erro. "}</strong>{notice.text}
        </p>
      )}

      {isLoading ? (
        <div className="h-36 animate-pulse rounded-xl border bg-card" />
      ) : projects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="Nenhum projeto ainda" description={canCreate ? "Crie um projeto e monte o plano em etapas." : "Quando houver projetos, eles aparecem aqui."} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const flow = flows.get(project.id);
            const current = flow && flow.currentIndex !== null ? flow.steps[flow.currentIndex] : null;
            return (
              <article key={project.id} className="flex flex-col gap-4 rounded-xl border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <Link to={project.id} className="text-lg font-bold leading-snug hover:underline">{project.name}</Link>
                  <StatusBadge status={project.status} />
                </div>

                <div>
                  <div className="flex items-end justify-between">
                    <p className="font-display text-[2rem] font-bold leading-none tabular-nums">{flow?.overallPercent ?? 0}%</p>
                    <p className="text-xs text-muted-foreground">{flow?.tasksDone ?? 0} de {flow?.tasksTotal ?? 0} tarefas</p>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${flow?.overallPercent ?? 0}%` }} /></div>
                </div>

                {flow && flow.steps.length > 0 ? (
                  <div>
                    <ol className="flex gap-1" aria-label="Etapas do projeto">
                      {flow.steps.map((step) => (
                        <li key={step.stage.id} title={`${step.stage.name}: ${STATUS_LABELS[step.status]}`} className={`h-1.5 flex-1 rounded-full ${step.status === "concluida" ? "bg-status-success" : step.status === "em_andamento" ? "bg-primary" : "bg-border"}`} />
                      ))}
                    </ol>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {current ? <>{current.status === "em_andamento" ? "Etapa atual" : "Próxima etapa"}: <strong className="text-foreground">{current.stage.name}</strong></> : "Todas as etapas concluídas"}
                      {" "}({flow.counts.concluida}/{flow.steps.length} concluídas)
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Sem etapas definidas.</p>
                )}

                <p className="text-xs text-muted-foreground">{formatDay(project.start_date)} a {formatDay(project.end_date)}. Orçamento {formatCurrency(project.budget)}.</p>
                <div className="mt-auto flex gap-2">
                  <Link to={project.id} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">Abrir fluxo</Link>
                  {canEdit && <button onClick={() => openEdit(project)} className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted">Editar</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {dialog && (
        <FormDialog
          title={dialog === "edit" ? "Editar projeto" : "Novo projeto"}
          fields={[
            { key: "name", label: "Nome", required: true, wide: true },
            { key: "status", label: "Status", type: "select", options: PROJECT_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })) },
            { key: "budget", label: "Orçamento", type: "number" },
            { key: "start_date", label: "Início", type: "date" },
            { key: "end_date", label: "Prazo", type: "date" },
          ]}
          values={form}
          onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
          onClose={() => setDialog(null)}
          onSubmit={() => saveMutation.mutate()}
          busy={saveMutation.isPending}
        />
      )}
    </div>
  );
}
