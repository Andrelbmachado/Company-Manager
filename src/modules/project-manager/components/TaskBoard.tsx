import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { StatusBadge, STATUS_LABELS } from "../ui/StatusBadge";
import { formatDay } from "../ui/format";
import { TASK_STATUSES, type ProjectStage, type Task, type TaskStatus } from "../types";

interface TaskBoardProps {
  tasks: Task[];
  stages: ProjectStage[];
  canEdit: boolean;
  onMove: (task: Task, status: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onAdd: (status: TaskStatus) => void;
}

/** Quadro kanban: as mesmas tarefas do plano, agrupadas por status. */
export function TaskBoard({ tasks, stages, canEdit, onMove, onEdit, onDelete, onAdd }: TaskBoardProps) {
  const stageName = new Map(stages.map((stage) => [stage.id, stage.name]));
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {TASK_STATUSES.map((status, columnIndex) => {
        const column = tasks.filter((task) => task.status === status);
        return (
          <section key={status} aria-label={STATUS_LABELS[status]} className="flex flex-col gap-3 rounded-xl border bg-muted p-3">
            <header className="flex items-center justify-between">
              <h2 className="text-sm font-bold">{STATUS_LABELS[status]} <span className="font-normal text-muted-foreground">({column.length})</span></h2>
              {canEdit && (
                <button onClick={() => onAdd(status)} aria-label={`Nova tarefa em ${STATUS_LABELS[status]}`} className="rounded-md p-1 text-muted-foreground hover:bg-card hover:text-foreground">
                  <Plus size={15} />
                </button>
              )}
            </header>
            {column.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Sem tarefas</p>}
            {column.map((task) => (
              <article key={task.id} className="space-y-2 rounded-lg border bg-card p-3">
                <button onClick={() => canEdit && onEdit(task)} className="block w-full text-left text-sm font-semibold hover:underline">{task.title}</button>
                {task.stage_id && stageName.get(task.stage_id) && <p className="text-xs text-muted-foreground">Etapa: {stageName.get(task.stage_id)}</p>}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge status={task.priority} />
                  {task.due_date && <span>até {formatDay(task.due_date)}</span>}
                  {task.estimate_hours != null && <span>{task.estimate_hours} h</span>}
                </div>
                {canEdit && (
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1">
                      <button disabled={columnIndex === 0} onClick={() => onMove(task, TASK_STATUSES[columnIndex - 1])} aria-label="Mover para a coluna anterior" className="rounded-md border p-1 hover:bg-muted disabled:opacity-30"><ChevronLeft size={14} /></button>
                      <button disabled={columnIndex === TASK_STATUSES.length - 1} onClick={() => onMove(task, TASK_STATUSES[columnIndex + 1])} aria-label="Mover para a próxima coluna" className="rounded-md border p-1 hover:bg-muted disabled:opacity-30"><ChevronRight size={14} /></button>
                    </div>
                    <button onClick={() => onDelete(task)} aria-label={`Remover tarefa ${task.title}`} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-status-danger"><Trash2 size={14} /></button>
                  </div>
                )}
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
