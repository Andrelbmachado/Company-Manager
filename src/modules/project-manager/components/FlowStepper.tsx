import { Check } from "lucide-react";
import { cn } from "../ui/cn";
import { formatShortDay } from "../ui/format";
import type { FlowStep } from "../flow";

interface FlowStepperProps {
  steps: FlowStep[];
  currentIndex: number | null;
  onSelect?: (stageId: string) => void;
}

/** Linha do projeto: etapas concluídas (verde, com check), a atual (azul, destacada) e as seguintes (contorno). */
export function FlowStepper({ steps, currentIndex, onSelect }: FlowStepperProps) {
  const counts = {
    concluida: steps.filter((step) => step.status === "concluida").length,
    em_andamento: steps.filter((step) => step.status === "em_andamento").length,
    a_seguir: steps.filter((step) => step.status === "a_seguir").length,
  };

  return (
    <div className="rounded-xl border bg-card p-5">
      <ul className="mb-5 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Legenda do fluxo">
        <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-status-success" />Concluídas <strong>{counts.concluida}</strong></li>
        <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-primary" />Em andamento <strong>{counts.em_andamento}</strong></li>
        <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full border-2 border-input" />A seguir <strong>{counts.a_seguir}</strong></li>
      </ul>

      <ol className="flex flex-col md:flex-row md:items-start">
        {steps.map((step, index) => {
          const isCurrent = index === currentIndex;
          const last = index === steps.length - 1;
          const done = step.status === "concluida";
          const started = step.status === "em_andamento";
          const warn = step.late || step.blocked > 0;
          const dates = step.stage.start_date || step.stage.end_date
            ? `${formatShortDay(step.stage.start_date) || "?"} a ${formatShortDay(step.stage.end_date) || "?"}`
            : null;
          return (
            <li key={step.stage.id} className="relative flex gap-3 pb-7 last:pb-0 md:flex-1 md:flex-col md:items-center md:gap-0 md:pb-0">
              {!last && (
                <>
                  {/* conector vertical (celular) */}
                  <span aria-hidden className="absolute left-[17px] top-10 -bottom-0 w-0.5 md:hidden">
                    {done ? <span className="block h-full w-full bg-status-success" />
                      : started ? <span className="block h-full w-full bg-border"><span className="block w-full bg-primary" style={{ height: `${step.percent}%` }} /></span>
                      : <span className="block h-full w-0 border-l-2 border-dashed border-input" />}
                  </span>
                  {/* conector horizontal (desktop) */}
                  <span aria-hidden className="absolute left-[calc(50%+26px)] right-[calc(-50%+26px)] top-[17px] hidden h-0.5 md:block">
                    {done ? <span className="block h-full w-full bg-status-success" />
                      : started ? <span className="block h-full w-full bg-border"><span className="block h-full bg-primary" style={{ width: `${step.percent}%` }} /></span>
                      : <span className="block h-0 w-full border-t-2 border-dashed border-input" />}
                  </span>
                </>
              )}

              <button
                type="button"
                onClick={() => onSelect?.(step.stage.id)}
                aria-label={`Etapa ${index + 1}: ${step.stage.name}`}
                className={cn(
                  "relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                  done && "bg-status-success text-white",
                  started && "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-card",
                  !done && !started && "border-2 border-input bg-card text-muted-foreground",
                  !done && !started && isCurrent && "border-primary text-primary",
                )}
              >
                {done ? <Check size={18} strokeWidth={3} /> : index + 1}
                {warn && <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-status-danger text-[10px] font-bold text-white" title={step.late ? "Prazo vencido" : "Tarefa bloqueada"}>!</span>}
              </button>

              <div className="min-w-0 md:mt-3 md:px-2 md:text-center">
                <p className={cn("text-sm font-semibold leading-snug", !done && !started && !isCurrent && "text-muted-foreground")}>{step.stage.name}</p>
                <p className="mt-0.5 text-xs">
                  {done && <span className="font-semibold text-status-success dark:text-green-400">Concluída</span>}
                  {started && <span className="font-semibold text-primary">Em andamento, {step.percent}%</span>}
                  {!done && !started && <span className="text-muted-foreground">{isCurrent ? "Próxima etapa" : "A seguir"}</span>}
                  {step.late && <span className="ml-1.5 font-semibold text-status-danger dark:text-red-400">Atrasada</span>}
                </p>
                {dates && <p className="mt-0.5 text-xs text-muted-foreground">{dates}</p>}
                {step.total > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{step.done}/{step.total} tarefas</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
