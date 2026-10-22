import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ListTree, Plus, Table2 } from "lucide-react";
import { FormDialog, type FieldDef } from "../ui/Dialog";
import { EmptyState } from "../ui/EmptyState";
import { StatCard } from "../ui/StatCard";
import { StatusBadge, STATUS_LABELS } from "../ui/StatusBadge";
import { cn } from "../ui/cn";
import { formatCurrency, formatDay } from "../ui/format";
import { FlowStepper } from "../components/FlowStepper";
import { StagePlan } from "../components/StagePlan";
import { TaskBoard } from "../components/TaskBoard";
import { buildFlow, type FlowStep } from "../flow";
import { useProjectManager } from "../context";
import { PRIORITIES, STAGE_STATUSES, TASK_STATUSES, type Priority, type StageStatus, type Task, type TaskStatus } from "../types";

type Tab = "fluxo" | "quadro";
type Dialog = { kind: "task"; task: Task | null } | { kind: "stage"; step: FlowStep | null };

const EMPTY_TASK = { title: "", description: "", stage_id: "", status: "aberta", priority: "media", due_date: "", estimate_hours: "" };
const EMPTY_STAGE = { name: "", description: "", status: "a_seguir", start_date: "", end_date: "" };

export default function ProjectPage() {
  const { projectId = "" } = useParams();
  const { companyId, canEdit, repo } = useProjectManager();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("fluxo");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [taskForm, setTaskForm] = useState<Record<string, string>>(EMPTY_TASK);
  const [stageForm, setStageForm] = useState<Record<string, string>>(EMPTY_STAGE);
  const [error, setError] = useState("");
  const fail = (action: string) => (cause: unknown) => setError(`Não foi possível ${action}: ${cause instanceof Error ? cause.message : String(cause)}`);

  const { data: project, isLoading } = useQuery({ queryKey: ["pm", "project", companyId, projectId], queryFn: () => repo.getProject(projectId) });
  const { data: tasks = [] } = useQuery({ queryKey: ["pm", "tasks", companyId, projectId], queryFn: () => repo.listTasks(projectId) });
  const { data: stages = [] } = useQuery({ queryKey: ["pm", "stages", companyId, projectId], queryFn: () => repo.listStages(projectId) });
  const flow = useMemo(() => buildFlow(stages, tasks), [stages, tasks]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["pm"] });

  const taskMutation = useMutation({
    mutationFn: async () => {
      const input = {
        title: taskForm.title.trim(),
        description: taskForm.description.trim() || null,
        stage_id: taskForm.stage_id || null,
        status: taskForm.status as TaskStatus,
        priority: taskForm.priority as Priority,
        due_date: taskForm.due_date || null,
        estimate_hours: taskForm.estimate_hours === "" ? null : Number(taskForm.estimate_hours),
      };
      if (dialog?.kind === "task" && dialog.task) await repo.updateTask(dialog.task.id, input);
      else await repo.createTask(projectId, input);
    },
    onSuccess: () => { void refresh(); setDialog(null); setError(""); },
    onError: fail("salvar a tarefa"),
  });

  const stageMutation = useMutation({
    mutationFn: async () => {
      const input = {
        name: stageForm.name.trim(),
        description: stageForm.description.trim() || null,
        status: stageForm.status as StageStatus,
        start_date: stageForm.start_date || null,
        end_date: stageForm.end_date || null,
      };
      if (dialog?.kind === "stage" && dialog.step) await repo.updateStage(dialog.step.stage.id, input);
      else await repo.createStage(projectId, input);
    },
    onSuccess: () => { void refresh(); setDialog(null); setError(""); },
    onError: fail("salvar a etapa"),
  });

  const moveTask = useMutation({ mutationFn: ({ task, status }: { task: Task; status: TaskStatus }) => repo.moveTask(task.id, status), onSuccess: () => void refresh(), onError: fail("mover a tarefa") });
  const removeTask = useMutation({ mutationFn: (task: Task) => repo.deleteTask(task.id), onSuccess: () => void refresh(), onError: fail("remover a tarefa") });
  const moveStage = useMutation({ mutationFn: ({ id, direction }: { id: string; direction: -1 | 1 }) => repo.moveStage(projectId, id, direction), onSuccess: () => void refresh(), onError: fail("reordenar a etapa") });
  const removeStage = useMutation({ mutationFn: (step: FlowStep) => repo.deleteStage(step.stage.id), onSuccess: () => void refresh(), onError: fail("remover a etapa") });

  function openTask(task: Task | null, preset: Partial<Record<string, string>> = {}) {
    setTaskForm(task
      ? { title: task.title, description: task.description ?? "", stage_id: task.stage_id ?? "", status: task.status, priority: task.priority, due_date: task.due_date?.slice(0, 10) ?? "", estimate_hours: task.estimate_hours == null ? "" : String(task.estimate_hours) }
      : { ...EMPTY_TASK, ...preset });
    setDialog({ kind: "task", task });
  }

  function openStage(step: FlowStep | null) {
    setStageForm(step
      ? { name: step.stage.name, description: step.stage.description ?? "", status: step.stage.status, start_date: step.stage.start_date?.slice(0, 10) ?? "", end_date: step.stage.end_date?.slice(0, 10) ?? "" }
      : EMPTY_STAGE);
    setDialog({ kind: "stage", step });
  }

  function selectStage(stageId: string) {
    setTab("fluxo");
    const element = document.getElementById(`stage-${stageId}`);
    if (element instanceof HTMLDetailsElement) element.open = true;
    element?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  if (isLoading) return <div className="h-36 animate-pulse rounded-xl border bg-card" />;
  if (!project) {
    return <EmptyState title="Projeto não encontrado" action={<Link to=".." className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">Voltar aos projetos</Link>} />;
  }

  const current = flow.currentIndex === null ? null : flow.steps[flow.currentIndex];
  const taskFields: FieldDef[] = [
    { key: "title", label: "Título", required: true, wide: true },
    { key: "stage_id", label: "Etapa", type: "select", options: [{ value: "", label: "Sem etapa" }, ...flow.steps.map((step) => ({ value: step.stage.id, label: step.stage.name }))] },
    { key: "status", label: "Status", type: "select", options: TASK_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })) },
    { key: "priority", label: "Prioridade", type: "select", options: PRIORITIES.map((priority) => ({ value: priority, label: STATUS_LABELS[priority] })) },
    { key: "due_date", label: "Prazo", type: "date" },
    { key: "estimate_hours", label: "Estimativa (horas)", type: "number" },
    { key: "description", label: "Descrição", type: "textarea" },
  ];
  const stageFields: FieldDef[] = [
    { key: "name", label: "Nome da etapa", required: true, wide: true },
    { key: "start_date", label: "Início", type: "date" },
    { key: "end_date", label: "Prazo", type: "date" },
    { key: "status", label: "Status (vale só se a etapa não tiver tarefas)", type: "select", wide: true, options: STAGE_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })) },
    { key: "description", label: "Descrição", type: "textarea" },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link to=".." className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Projetos</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight">{project.name}</h1>
          <StatusBadge status={project.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {formatDay(project.start_date)} a {formatDay(project.end_date)}. Orçamento {formatCurrency(project.budget)}.
        </p>
      </div>

      {error && (
        <p role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-status-danger bg-card px-4 py-2.5 text-sm">
          <span><strong className="text-status-danger dark:text-red-400">Erro. </strong>{error}</span>
          <button onClick={() => setError("")} className="shrink-0 font-medium underline">fechar</button>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Progresso do projeto" value={`${flow.overallPercent}%`} hint={`${flow.tasksDone} de ${flow.tasksTotal} tarefas concluídas`} />
        <StatCard title="Etapas concluídas" value={`${flow.counts.concluida}/${flow.steps.length}`} hint={`${flow.counts.em_andamento} em andamento, ${flow.counts.a_seguir} a seguir`} />
        <StatCard title={current ? (current.status === "em_andamento" ? "Etapa atual" : "Próxima etapa") : "Etapa atual"} kind="text" value={current ? current.stage.name : flow.steps.length ? "Todas concluídas" : "Sem etapas"} hint={current ? `${current.done} de ${current.total} tarefas, ${current.percent}%` : undefined} />
        <StatCard title="Prazo do projeto" kind="text" value={formatDay(project.end_date)} hint={flow.steps.some((step) => step.late) ? "Há etapa com prazo vencido" : undefined} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b">
        <div role="tablist" className="flex gap-1">
          {([["fluxo", "Fluxo do projeto", ListTree], ["quadro", "Quadro de tarefas", Table2]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn("-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors", tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        {canEdit && (
          <div className="mb-2 flex gap-2">
            <button onClick={() => openStage(null)} className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"><Plus size={14} /> Nova etapa</button>
            <button onClick={() => openTask(null)} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Plus size={14} /> Nova tarefa</button>
          </div>
        )}
      </div>

      {tab === "fluxo" && (
        flow.steps.length === 0 && flow.unstaged.length === 0 ? (
          <EmptyState title="Este projeto ainda não tem plano" description={canEdit ? "Crie as etapas na ordem em que vão acontecer: o fluxo mostra o que já foi feito, o que está em andamento e o que vem a seguir." : "O plano será exibido aqui quando as etapas forem criadas."} action={canEdit ? <button onClick={() => openStage(null)} className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Criar a primeira etapa</button> : undefined} />
        ) : (
          <div className="space-y-6">
            {flow.steps.length > 0 && <FlowStepper steps={flow.steps} currentIndex={flow.currentIndex} onSelect={selectStage} />}
            <StagePlan
              flow={flow}
              canEdit={canEdit}
              onToggleTask={(task) => moveTask.mutate({ task, status: task.status === "concluida" ? "aberta" : "concluida" })}
              onEditTask={(task) => openTask(task)}
              onAddTask={(stageId) => openTask(null, { stage_id: stageId ?? "" })}
              onEditStage={openStage}
              onMoveStage={(id, direction) => moveStage.mutate({ id, direction })}
              onDeleteStage={(step) => removeStage.mutate(step)}
            />
          </div>
        )
      )}

      {tab === "quadro" && (
        <TaskBoard
          tasks={flow.steps.flatMap((step) => step.tasks).concat(flow.unstaged)}
          stages={stages}
          canEdit={canEdit}
          onMove={(task, status) => moveTask.mutate({ task, status })}
          onEdit={(task) => openTask(task)}
          onDelete={(task) => removeTask.mutate(task)}
          onAdd={(status) => openTask(null, { status })}
        />
      )}

      {dialog?.kind === "task" && (
        <FormDialog
          title={dialog.task ? "Editar tarefa" : "Nova tarefa"}
          fields={taskFields}
          values={taskForm}
          onChange={(key, value) => setTaskForm((current) => ({ ...current, [key]: value }))}
          onClose={() => setDialog(null)}
          onSubmit={() => taskMutation.mutate()}
          busy={taskMutation.isPending}
        />
      )}
      {dialog?.kind === "stage" && (
        <FormDialog
          title={dialog.step ? "Editar etapa" : "Nova etapa"}
          description="A etapa entra no fim do plano; use as setas para reordenar."
          fields={stageFields}
          values={stageForm}
          onChange={(key, value) => setStageForm((current) => ({ ...current, [key]: value }))}
          onClose={() => setDialog(null)}
          onSubmit={() => stageMutation.mutate()}
          busy={stageMutation.isPending}
        />
      )}
    </div>
  );
}
