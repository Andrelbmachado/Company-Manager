import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { useLabel } from "@/lib/labels/useLabel";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn, formatDay, todayIso } from "@/lib/utils";
import { ensureMyEmployee, fetchMyHrTasks, fetchMyRequests } from "@/lib/hr/queries";
import { REQUEST_TYPES, tenureLabel, vacationBalance } from "@/lib/hr/rules";
import { saveRequestRows } from "@/lib/hr/tableEdits";
import type { HrRequest, Role } from "@/types";

const STATUSES = [
  { value: "pendente", label: "Pendente" },
  { value: "aprovada", label: "Aprovada" },
  { value: "recusada", label: "Recusada" },
];

/** Data da solicitação que abre o Calendário naquele dia (quem está e quem não está na empresa). */
function CalendarDayLink({ day }: { day: string | null | undefined }) {
  if (!day) return null;
  const key = day.slice(0, 10);
  return (
    <Link to={`/calendar?dia=${key}`} title="Ver no calendário quem estará na empresa neste dia" className="text-primary-text underline-offset-2 hover:underline">
      {formatDay(key)}
    </Link>
  );
}

/** "Meu RH": a área de RH de qualquer colaborador (férias, solicitações e pendências do próprio cadastro). Os comunicados do RH chegam como notificação no menu da conta. */
export default function MyHrPage() {
  const session = useRequiredSession();
  const title = useLabel("module.hr");
  const qc = useQueryClient();
  const companyId = session.company.id;
  const today = todayIso();

  const { data: me } = useQuery({ queryKey: ["hr", "me", companyId, session.user.id], queryFn: () => ensureMyEmployee(session) });
  const employeeId = me?.id ?? "";
  const requestsQuery = useQuery({ queryKey: ["hr", "my-requests", companyId, employeeId], queryFn: () => fetchMyRequests(companyId, employeeId), enabled: !!me });
  const { data: todos = [] } = useQuery({ queryKey: ["hr", "my-tasks", companyId, employeeId], queryFn: () => fetchMyHrTasks(companyId, employeeId), enabled: !!me });
  const requests = useMemo(() => requestsQuery.data ?? [], [requestsQuery.data]);

  const balance = me ? vacationBalance(me, requests, Number(today.slice(0, 4))) : null;
  const openTodos = todos.filter((todo) => todo.status === "pendente");
  const pendingRequests = requests.filter((request) => request.status === "pendente");

  const refresh = () => qc.invalidateQueries({ queryKey: ["hr"] });

  async function save(changes: EditableTableChanges<HrRequest>) {
    if (!me) throw new Error("Seu cadastro ainda está carregando.");
    const { created } = await saveRequestRows(await getDb(), companyId, { role: session.membership.role as Role, userId: session.user.id }, changes, today, { employeeId: me.id, self: true });
    for (const id of created) await emit({ type: "hr_request.created", companyId, actorId: session.user.id, entityType: "hr_request", entityId: id, title: `Solicitação enviada por ${me.name}`, module: "hr" });
  }

  const completeTodo = useMutation({
    mutationFn: async (id: string) => {
      await (await getDb()).execute("UPDATE hr_tasks SET status=?, updated_at=datetime('now') WHERE id=? AND company_id=? AND employee_id=?", ["concluida", id, companyId, employeeId]);
    },
    onSuccess: () => void refresh(),
  });

  if (!me || !balance) return <div className="h-36 animate-pulse rounded-xl border bg-card" />;

  const columns: EditableColumn<HrRequest>[] = [
    { key: "type", header: "Tipo", kind: "select", options: REQUEST_TYPES, required: true },
    { key: "start_date", header: "Início", kind: "date", required: true, render: (request) => <CalendarDayLink day={request.start_date} /> },
    { key: "end_date", header: "Fim", kind: "date", required: true, render: (request) => <CalendarDayLink day={request.end_date} /> },
    { key: "days", header: "Dias", kind: "number", readOnly: true },
    { key: "reason", header: "Motivo", kind: "text", placeholder: "opcional" },
    { key: "status", header: "Status", kind: "select", options: STATUSES, readOnly: true, render: (request) => <StatusBadge status={request.status} tone={request.status === "aprovada" ? "success" : undefined} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={title} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Férias disponíveis" value={`${balance.available} dias`} />
        <KpiCard title="Solicitações em análise" value={pendingRequests.length} />
        <KpiCard title="Pendências abertas" value={openTodos.length} />
        {/* Sem data de admissão no cadastro, conta da criação da conta no app. */}
        <KpiCard title="Tempo de empresa" value={tenureLabel(me.hire_date || session.user.created_at, today)} />
      </div>

      <section aria-label="Minhas solicitações">
        <EditableTable<HrRequest>
          resource="hr_self"
          label="Minhas solicitações"
          title="Minhas solicitações"
          rows={requests}
          columns={columns}
          loading={requestsQuery.isLoading}
          newRow={() => ({ type: "ferias" })}
          onSave={save}
          onRefresh={refresh}
          emptyMessage="Nenhuma solicitação"
        />
      </section>

      <section aria-label="Minhas pendências" className="rounded-xl border bg-card">
        <header className="border-b px-5 py-3"><h2 className="font-bold">Minhas pendências</h2></header>
        {todos.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">Nenhuma pendência</p> : (
          <ul className="divide-y">
            {todos.map((todo) => {
              const done = todo.status === "concluida";
              const late = !done && !!todo.due_date && todo.due_date < today;
              return (
                <li key={todo.id} className="flex items-center gap-3 px-5 py-3">
                  <button type="button" disabled={done || completeTodo.isPending} onClick={() => completeTodo.mutate(todo.id)} aria-label={done ? `${todo.title}: concluída` : `Marcar como concluída: ${todo.title}`} className="shrink-0 disabled:cursor-default">
                    {done ? <CheckCircle2 size={20} className="text-status-success" /> : <Circle size={20} className="text-muted-foreground" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-medium", done && "text-muted-foreground line-through")}>{todo.title}</p>
                    <p className="text-xs text-muted-foreground">{todo.due_date ? `prazo ${formatDay(todo.due_date)}` : "sem prazo"}</p>
                  </div>
                  {late && <StatusBadge status="vencida" />}
                  {done && <StatusBadge status="concluida" />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
