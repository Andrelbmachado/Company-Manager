import { ChevronLeft, ChevronRight, OctagonAlert, Plus, Trash2 } from "lucide-react";
import { StatusBadge, STATUS_LABELS } from "../ui/StatusBadge";
import { formatDay } from "../ui/format";
import { TASK_STATUSES, type ProjectStage, type Task, type TaskStatus } from "../types";

/** Caminho normal de uma tarefa. Bloqueada é um desvio: entra pelo botão de bloqueio e sai voltando para Em andamento. */
const FLOW: TaskStatus[] = ["aberta", "em_andamento", "concluida"];

interface TaskBoardProps {
  tasks: Task[];
  stages: ProjectStage[];
  canEdit: boolean;
  onMove: (task: Task, status: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onAdd: (status: TaskStatus) => void;
}

const iconButton = "rounded-md border p-1.5 hover:bg-muted disabled:opacity-30";

/** Quadro kanban: as mesmas tarefas do plano, agrupadas por status. */
export function TaskBoard({ tasks, stages, canEdit, onMove, onEdit, onDelete, onAdd }: TaskBoardProps) {
  const stageName = new Map(stages.map((stage) => [stage.id, stage.name]));
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {TASK_STATUSES.map((status) => {
        const column = tasks.filter((task) => task.status === status);
        return (
          <section key={status} aria-label={STATUS_LABELS[status]} className="flex flex-col gap-3 rounded-xl border bg-muted p-3">
            <header className="flex items-center justify-between">
              <h2 className="text-sm font-bold">{STATUS_LABELS[status]} <span className="font-normal text-muted-foreground">({column.length})</span></h2>
              {canEdit && (
                <button onClick={() => onAdd(status)} aria-label={`Nova tarefa em ${STATUS_LABELS[status]}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-card hover:text-foreground">
                  <Plus size={15} />
                </button>
              )}
            </header>
            {column.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Sem tarefas</p>}
            {column.map((task) => {
              const blocked = task.status === "bloqueada";
              const index = FLOW.indexOf(task.status);
              return (
                <article key={task.id} className="space-y-2 rounded-lg border bg-card p-3">
                  <button onClick={() => canEdit && onEdit(task)} title={task.title} className="block w-full break-words text-left text-sm font-semibold hover:underline">{task.title}</button>
                  {task.stage_id && stageName.get(task.stage_id) && <p className="text-xs text-muted-foreground">Etapa: {stageName.get(task.stage_id)}</p>}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <StatusBadge status={task.priority} />
                    {task.due_date && <span>até {formatDay(task.due_date)}</span>}
                    {task.estimate_hours != null && <span>{task.estimate_hours} h</span>}
                  </div>
                  {canEdit && (
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1">
                        <button
                          disabled={!blocked && index <= 0}
                          onClick={() => onMove(task, blocked ? "em_andamento" : FLOW[index - 1])}
                          aria-label={blocked ? "Desbloquear e voltar para Em andamento" : "Mover para a coluna anterior"}
                          className={iconButton}
                        ><ChevronLeft size={14} /></button>
                        <button
                          disabled={blocked || index === FLOW.length - 1}
                          onClick={() => onMove(task, FLOW[index + 1])}
                          aria-label="Mover para a próxima coluna"
                          className={iconButton}
                        ><ChevronRight size={14} /></button>
                        {!blocked && task.status !== "concluida" && (
                          <button onClick={() => onMove(task, "bloqueada")} aria-label={`Marcar como bloqueada: ${task.title}`} title="Marcar como bloqueada" className={`${iconButton} text-status-danger dark:text-red-400`}><OctagonAlert size={14} /></button>
                        )}
                      </div>
                      <button onClick={() => onDelete(task)} aria-label={`Remover tarefa ${task.title}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-status-danger dark:hover:text-red-400"><Trash2 size={14} /></button>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
