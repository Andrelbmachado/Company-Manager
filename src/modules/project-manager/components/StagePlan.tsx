import { ArrowDown, ArrowUp, CheckCircle2, ChevronDown, Circle, CircleDot, OctagonAlert, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "../ui/cn";
import { StatusBadge } from "../ui/StatusBadge";
import { formatDay } from "../ui/format";
import type { Flow, FlowStep } from "../flow";
import type { Task } from "../types";

interface StagePlanProps {
  flow: Flow;
  canEdit: boolean;
  onToggleTask: (task: Task) => void;
  onEditTask: (task: Task) => void;
  onAddTask: (stageId: string | null) => void;
  onEditStage: (step: FlowStep) => void;
  onMoveStage: (stageId: string, direction: -1 | 1) => void;
  onDeleteStage: (step: FlowStep) => void;
}

function TaskIcon({ status }: { status: Task["status"] }) {
  if (status === "concluida") return <CheckCircle2 size={20} className="text-status-success" />;
  if (status === "em_andamento") return <CircleDot size={20} className="text-primary" />;
  if (status === "bloqueada") return <OctagonAlert size={20} className="text-status-danger" />;
  return <Circle size={20} className="text-muted-foreground" />;
}

function TaskRow({ task, canEdit, onToggle, onEdit }: { task: Task; canEdit: boolean; onToggle: () => void; onEdit: () => void }) {
  const done = task.status === "concluida";
  return (
    <li className="flex items-center gap-3 py-2.5">
      <button
        type="button"
        onClick={onToggle}
        disabled={!canEdit}
        aria-label={done ? `Reabrir tarefa ${task.title}` : `Concluir tarefa ${task.title}`}
        className="-m-1 shrink-0 rounded-full p-1 disabled:cursor-default"
      >
        <TaskIcon status={task.status} />
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onEdit} disabled={!canEdit} className={cn("block max-w-full break-words text-left text-sm font-medium disabled:cursor-default", done && "text-muted-foreground line-through", canEdit && "hover:underline")}>
          {task.title}
        </button>
        <p className="text-xs text-muted-foreground">
          {task.due_date ? `prazo ${formatDay(task.due_date)}` : "sem prazo"}
          {task.estimate_hours != null ? `, ${task.estimate_hours} h` : ""}
        </p>
      </div>
      {(task.status === "bloqueada" || task.status === "em_andamento") && <StatusBadge status={task.status} />}
      {(task.priority === "alta" || task.priority === "urgente") && !done && <StatusBadge status={task.priority} />}
    </li>
  );
}

/** Plano linear: uma seção por etapa, na ordem do projeto, com as tarefas dentro. A etapa atual vem aberta. */
export function StagePlan({ flow, canEdit, onToggleTask, onEditTask, onAddTask, onEditStage, onMoveStage, onDeleteStage }: StagePlanProps) {
  return (
    <div className="space-y-3">
      {flow.steps.map((step, index) => {
        const open = index === flow.currentIndex;
        return (
          <details key={step.stage.id} id={`stage-${step.stage.id}`} open={open} className="group scroll-mt-4 rounded-xl border bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
              <span className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                step.status === "concluida" && "bg-status-success text-white",
                step.status === "em_andamento" && "bg-primary text-primary-foreground",
                step.status === "a_seguir" && "border-2 border-muted-foreground text-muted-foreground",
              )}>{index + 1}</span>
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-base font-bold leading-snug">{step.stage.name}</h3>
                <p className="truncate text-xs text-muted-foreground">
                  {step.stage.start_date || step.stage.end_date ? `${formatDay(step.stage.start_date)} a ${formatDay(step.stage.end_date)}` : "Sem datas definidas"}
                </p>
              </div>
              {step.late && <StatusBadge status="atrasada" />}
              <StatusBadge status={step.status} />
              <div className="hidden w-28 sm:block">
                <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${step.percent}%` }} /></div>
                <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">{step.done}/{step.total}</p>
              </div>
              <ChevronDown size={18} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>

            <div className="border-t px-4 pb-4 pt-2">
              {step.stage.description && <p className="py-2 text-sm text-muted-foreground">{step.stage.description}</p>}
              {step.tasks.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">Nenhuma tarefa nesta etapa{canEdit ? ". Adicione a primeira." : "."}</p>
              ) : (
                <ul className="divide-y">
                  {step.tasks.map((task) => (
                    <TaskRow key={task.id} task={task} canEdit={canEdit} onToggle={() => onToggleTask(task)} onEdit={() => onEditTask(task)} />
                  ))}
                </ul>
              )}
              {canEdit && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={() => onAddTask(step.stage.id)} className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
                    <Plus size={14} /> Nova tarefa
                  </button>
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={index === 0} onClick={() => onMoveStage(step.stage.id, -1)} aria-label={`Mover ${step.stage.name} para antes`} className="rounded-md border p-2 hover:bg-muted disabled:opacity-30"><ArrowUp size={14} /></button>
                    <button type="button" disabled={index === flow.steps.length - 1} onClick={() => onMoveStage(step.stage.id, 1)} aria-label={`Mover ${step.stage.name} para depois`} className="rounded-md border p-2 hover:bg-muted disabled:opacity-30"><ArrowDown size={14} /></button>
                    <button type="button" onClick={() => onEditStage(step)} aria-label={`Editar etapa ${step.stage.name}`} className="rounded-md border p-2 hover:bg-muted"><Pencil size={14} /></button>
                    <button type="button" onClick={() => onDeleteStage(step)} aria-label={`Remover etapa ${step.stage.name}`} className="rounded-md border p-2 text-status-danger hover:bg-muted dark:text-red-400"><Trash2 size={14} /></button>
                  </div>
                </div>
              )}
            </div>
          </details>
        );
      })}

      {flow.unstaged.length > 0 && (
        <details className="group rounded-xl border bg-card" open>
          <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-bold">Sem etapa</h3>
              <p className="text-xs text-muted-foreground">Tarefas que ainda não foram encaixadas no plano.</p>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">{flow.unstaged.length}</span>
            <ChevronDown size={18} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t px-4 pb-4 pt-2">
            <ul className="divide-y">
              {flow.unstaged.map((task) => (
                <TaskRow key={task.id} task={task} canEdit={canEdit} onToggle={() => onToggleTask(task)} onEdit={() => onEditTask(task)} />
              ))}
            </ul>
            {canEdit && (
              <button type="button" onClick={() => onAddTask(null)} className="mt-3 flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
                <Plus size={14} /> Nova tarefa
              </button>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
