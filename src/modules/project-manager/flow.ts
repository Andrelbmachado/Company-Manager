// Fluxo do projeto: transforma etapas + tarefas no plano linear (concluídas, em andamento, a seguir).
// Função pura, sem acesso a banco — é o que a tela "Fluxo" desenha.
import { todayIso } from "./ui/format";
import type { ProjectStage, StageStatus, Task } from "./types";

export interface FlowStep {
  stage: ProjectStage;
  tasks: Task[];
  /** Derivado das tarefas quando existem; senão o status gravado na etapa. */
  status: StageStatus;
  done: number;
  total: number;
  percent: number;
  /** Tarefas bloqueadas na etapa. */
  blocked: number;
  /** Prazo da etapa vencido sem concluir. */
  late: boolean;
}

export interface Flow {
  steps: FlowStep[];
  /** Tarefas do projeto sem etapa. */
  unstaged: Task[];
  /** Índice da primeira etapa não concluída (a atual, ou a próxima se ainda não começou). null = tudo concluído ou sem etapas. */
  currentIndex: number | null;
  counts: Record<StageStatus, number>;
  tasksDone: number;
  tasksTotal: number;
  /** Progresso geral: tarefas concluídas / total; sem tarefas, etapas concluídas / total. */
  overallPercent: number;
}

/** Com tarefas: todas concluídas = concluída; alguma iniciada ou concluída = em andamento; senão a seguir. */
export function deriveStageStatus(stage: Pick<ProjectStage, "status">, tasks: Pick<Task, "status">[]): StageStatus {
  if (tasks.length === 0) return stage.status;
  if (tasks.every((task) => task.status === "concluida")) return "concluida";
  if (tasks.some((task) => task.status !== "aberta")) return "em_andamento";
  return "a_seguir";
}

export function buildFlow(stages: ProjectStage[], tasks: Task[], today: string = todayIso()): Flow {
  const live = tasks.filter((task) => !task.deleted_at);
  const ordered = stages.filter((stage) => !stage.deleted_at).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  const knownIds = new Set(ordered.map((stage) => stage.id));

  const steps = ordered.map<FlowStep>((stage) => {
    const own = live.filter((task) => task.stage_id === stage.id);
    const status = deriveStageStatus(stage, own);
    const done = own.filter((task) => task.status === "concluida").length;
    const percent = own.length ? Math.round((done / own.length) * 100) : status === "concluida" ? 100 : 0;
    const end = stage.end_date?.slice(0, 10);
    return {
      stage,
      tasks: own,
      status,
      done,
      total: own.length,
      percent,
      blocked: own.filter((task) => task.status === "bloqueada").length,
      late: status !== "concluida" && !!end && end < today,
    };
  });

  const counts: Record<StageStatus, number> = { concluida: 0, em_andamento: 0, a_seguir: 0 };
  for (const step of steps) counts[step.status] += 1;

  const tasksDone = live.filter((task) => task.status === "concluida").length;
  const overallPercent = live.length
    ? Math.round((tasksDone / live.length) * 100)
    : steps.length ? Math.round((counts.concluida / steps.length) * 100) : 0;
  const currentIndex = steps.findIndex((step) => step.status !== "concluida");

  return {
    steps,
    unstaged: live.filter((task) => !task.stage_id || !knownIds.has(task.stage_id)),
    currentIndex: currentIndex === -1 ? null : currentIndex,
    counts,
    tasksDone,
    tasksTotal: live.length,
    overallPercent,
  };
}
