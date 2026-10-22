import { useQuery } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDate } from "@/lib/utils";
import type { Task } from "@/types";

/** Tarefas do projeto (somente leitura). Quem edita é o Project Manager; troca por arquivo JSON. */
export function ProjectTasks({ projectId }: { projectId: string }) {
  const session = useRequiredSession();
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", session.company.id, projectId],
    queryFn: async () => (await getDb()).select<Task[]>(
      "SELECT * FROM tasks WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at ASC",
      [session.company.id],
    ),
    select: (rows) => rows.filter((task) => task.project_id === projectId),
  });
  const done = tasks.filter((task) => task.status === "concluida").length;

  return (
    <section className="mt-6 space-y-3">
      <h3 className="text-sm font-semibold">Tarefas ({done}/{tasks.length} concluídas)</h3>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem tarefas. Importe do Project Manager ou crie por lá.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{task.title}</p>
                {task.due_date && <p className="text-xs text-muted-foreground">prazo {formatDate(task.due_date)}</p>}
              </div>
              <StatusBadge status={task.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
