import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, LayoutGrid, Table2 } from "lucide-react";
import { getDb } from "@/lib/db/client";
import type { DatabaseLike } from "@/lib/db/demo";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { CalendarView } from "@/components/shared/CalendarView";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { useLabel } from "@/lib/labels/useLabel";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn, formatCurrency } from "@/lib/utils";
import { createProjectRepository, ProjectManagerModule } from "@/modules/project-manager";
import { PROJECT_STATUS_OPTIONS, projectCalendarItems, projectRows, saveProjectRows, type ProjectRow } from "../projectRows";
import type { Role } from "@/types";

type View = "tabela" | "cronograma" | "painel";

const VIEWS: { id: View; text: string; Icon: typeof Table2 }[] = [
  { id: "tabela", text: "Tabela", Icon: Table2 },
  { id: "cronograma", text: "Cronograma", Icon: CalendarDays },
  { id: "painel", text: "Painel", Icon: LayoutGrid },
];

/**
 * Projetos. Tabela (EditableTable: nome, status, orçamento e datas editados no lugar) e Cronograma (CalendarView com
 * projetos, etapas e prazos de tarefas) ficam no Company Manager; Painel e a página de cada projeto (/projects/:id,
 * plano em etapas e tarefas) são o módulo do Project Manager embutido (src/modules/project-manager, vendorizado).
 * Mesmo banco (projects, project_stages, tasks), mesmo cache (["pm", ...]) e as permissões do recurso `projects`.
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
  const module = (
    <ProjectManagerModule
      db={db}
      companyId={session.company.id}
      userId={session.user.id}
      canEdit={canEdit}
      canCreate={canCreate}
      fileExchange={fileExchange}
    />
  );
  return (
    <Routes>
      <Route index element={<ProjectsHub db={db} panel={module} />} />
      <Route path="*" element={module} />
    </Routes>
  );
}

function ProjectsHub({ db, panel }: { db: DatabaseLike; panel: ReactNode }) {
  const session = useRequiredSession();
  const title = useLabel("module.projects");
  const qc = useQueryClient();
  const companyId = session.company.id;
  const [view, setView] = useState<View>("tabela");
  const repo = useMemo(() => createProjectRepository(db, companyId, session.user.id), [db, companyId, session.user.id]);

  const projectsQuery = useQuery({ queryKey: ["pm", "projects", companyId], queryFn: repo.listProjects });
  const stagesQuery = useQuery({ queryKey: ["pm", "stages", companyId], queryFn: repo.listAllStages });
  const tasksQuery = useQuery({ queryKey: ["pm", "tasks", companyId], queryFn: repo.listAllTasks });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const stages = useMemo(() => stagesQuery.data ?? [], [stagesQuery.data]);
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const rows = useMemo(() => projectRows(projects, stages, tasks), [projects, stages, tasks]);
  const count = (status: string) => projects.filter((project) => project.status === status).length;
  const budget = projects.filter((project) => project.status !== "cancelado").reduce((sum, project) => sum + (Number(project.budget) || 0), 0);

  const refresh = () => qc.invalidateQueries({ queryKey: ["pm"] });

  async function save(changes: EditableTableChanges<ProjectRow>) {
    await saveProjectRows(db, companyId, { role: session.membership.role as Role, userId: session.user.id }, changes);
  }

  const columns: EditableColumn<ProjectRow>[] = [
    { key: "name", header: "Nome", kind: "text", required: true, render: (project) => <Link to={`/projects/${project.id}`} className="font-medium hover:underline">{project.name}</Link> },
    { key: "status", header: "Status", kind: "select", options: PROJECT_STATUS_OPTIONS, required: true, render: (project) => <StatusBadge status={project.status} /> },
    { key: "budget", header: "Orçamento", kind: "money" },
    { key: "start_date", header: "Início", kind: "date" },
    { key: "end_date", header: "Prazo", kind: "date" },
    { key: "stage", header: "Etapa atual", kind: "text", readOnly: true },
    { key: "progress", header: "Progresso", kind: "text", readOnly: true },
  ];

  const switcher = (
    <div role="group" aria-label="Ver projetos em" className="inline-flex rounded-md border p-0.5">
      {VIEWS.map(({ id, text, Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => setView(id)}
          className={cn("inline-flex items-center gap-1.5 rounded px-3 py-1 text-sm font-medium transition-colors", view === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
        >
          <Icon size={14} aria-hidden="true" /> {text}
        </button>
      ))}
    </div>
  );

  return (
    <>
      {view === "painel" && (
        <div className="space-y-4">
          <div className="flex justify-end">{switcher}</div>
          {panel}
        </div>
      )}
      {/* A tabela fica montada (só escondida) no Cronograma e no Painel: trocar de visão não perde em silêncio o rascunho. */}
      <div hidden={view === "painel"} className="space-y-6">
        <PageHeader
          title={title}
          description="Nome, status, orçamento e datas se editam na tabela; o plano em etapas e as tarefas ficam na página de cada projeto. Importar e exportar do app Project Manager fica no Painel."
          actions={switcher}
          className="pb-0"
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard title="Em andamento" value={count("andamento")} />
          <KpiCard title="Planejados" value={count("planejado")} />
          <KpiCard title="Concluídos" value={count("concluido")} />
          <KpiCard title="Orçamento total" value={formatCurrency(budget)} />
        </div>

        <div hidden={view !== "tabela"}>
          <EditableTable<ProjectRow>
            resource="projects"
            label="Projetos"
            title="Projetos"
            rows={rows}
            columns={columns}
            loading={projectsQuery.isLoading}
            newRow={() => ({ status: "planejado", budget: 0 })}
            onSave={save}
            onRefresh={refresh}
            rowActions={(project) => (
              <Link to={`/projects/${project.id}`} aria-label={`Abrir plano de ${project.name}`} className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted">Abrir plano</Link>
            )}
            emptyMessage="Nenhum projeto ainda. Use Adicionar e depois abra o projeto para montar o plano em etapas."
          />
        </div>
        {view === "cronograma" && <CalendarView items={projectCalendarItems(projects, stages, tasks)} label="Cronograma dos projetos" />}
      </div>
    </>
  );
}
