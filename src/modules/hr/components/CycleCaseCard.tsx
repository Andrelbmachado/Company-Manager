// Cartão de um processo de admissão ou desligamento: progresso do checklist e itens marcáveis.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CYCLE_LABEL, type CycleCase } from "@/lib/hr/employment";
import { cn, formatDay } from "@/lib/utils";

interface CycleCaseCardProps {
  item: CycleCase;
  today: string;
  canEdit: boolean;
  busy?: boolean;
  onToggle: (taskId: string, done: boolean) => void;
  /** Mostra o nome com link para a ficha (na lista geral). */
  linkEmployee?: boolean;
  actions?: ReactNode;
}

export function CycleCaseCard({ item, today, canEdit, busy, onToggle, linkEmployee, actions }: CycleCaseCardProps) {
  const percent = item.total ? Math.round((item.done / item.total) * 100) : 0;
  const scheduled = item.kind === "desligamento" && item.employee.status !== "desligado" && !!item.employee.termination_date;
  const label = `${CYCLE_LABEL[item.kind]} de ${item.employee.name}`;
  return (
    <article aria-label={label} className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b px-5 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{CYCLE_LABEL[item.kind]}{item.date ? ` · ${item.kind === "admissao" ? "início" : "saída"} em ${formatDay(item.date)}` : ""}</p>
          <h3 className="font-bold">
            {linkEmployee ? <Link to={`/hr/manage/colaboradores/${item.employee.id}`} className="hover:underline">{item.employee.name}</Link> : item.employee.name}
          </h3>
          <p className="text-xs text-muted-foreground">
            {[item.employee.position, item.employee.department].filter(Boolean).join(" · ") || "Cargo não informado"}
            {item.kind === "desligamento" && item.employee.termination_reason ? ` · ${item.employee.termination_reason}` : ""}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-1.5">
          {item.complete ? <StatusBadge status="concluida" /> : <StatusBadge status="em andamento" tone="info" />}
          {scheduled && <StatusBadge status="agendado" tone="warning" />}
          {item.late > 0 && <StatusBadge status={`${item.late} em atraso`} tone="danger" />}
        </span>
      </header>
      <div className="px-5 pt-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{item.done} de {item.total} itens</span>
          <span className="tabular-nums">{percent}%</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`Progresso: ${label}`} aria-valuemin={0} aria-valuemax={item.total} aria-valuenow={item.done}>
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <ul className="divide-y px-2 py-2">
        {item.tasks.map((task) => {
          const done = task.status === "concluida";
          const late = !done && !!task.due_date && task.due_date < today;
          return (
            <li key={task.id} className="flex items-start gap-3 px-3 py-2">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--primary))]"
                checked={done}
                disabled={!canEdit || busy}
                onChange={(event) => onToggle(task.id, event.target.checked)}
                aria-label={task.title}
              />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm", done && "text-muted-foreground line-through")}>{task.title}</p>
                <p className={cn("text-xs", late ? "font-medium text-status-danger dark:text-red-400" : "text-muted-foreground")}>{task.due_date ? `${late ? "venceu" : "prazo"} ${formatDay(task.due_date)}` : "sem prazo"}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {actions && <footer className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">{actions}</footer>}
    </article>
  );
}
