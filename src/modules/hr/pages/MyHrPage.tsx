import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Megaphone } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { CalendarView } from "@/components/shared/CalendarView";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn, formatDay, todayIso } from "@/lib/utils";
import { ensureMyEmployee, fetchAnnouncements, fetchMyHrTasks, fetchMyRequests } from "@/lib/hr/queries";
import { REQUEST_TYPES, tenureLabel, vacationBalance } from "@/lib/hr/rules";
import { requestCalendarItems, saveRequestRows } from "@/lib/hr/tableEdits";
import { ViewSwitch, type ListOrCalendar } from "../components/ViewSwitch";
import type { HrRequest, Role } from "@/types";

const STATUSES = [
  { value: "pendente", label: "Pendente" },
  { value: "aprovada", label: "Aprovada" },
  { value: "recusada", label: "Recusada" },
];

/** "Meu RH": a área de RH de qualquer colaborador (férias, solicitações, comunicados e pendências do próprio cadastro). */
export default function MyHrPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const companyId = session.company.id;
  const today = todayIso();
  const [view, setView] = useState<ListOrCalendar>("lista");

  const { data: me } = useQuery({ queryKey: ["hr", "me", companyId, session.user.id], queryFn: () => ensureMyEmployee(session) });
  const employeeId = me?.id ?? "";
  const requestsQuery = useQuery({ queryKey: ["hr", "my-requests", companyId, employeeId], queryFn: () => fetchMyRequests(companyId, employeeId), enabled: !!me });
  const { data: todos = [] } = useQuery({ queryKey: ["hr", "my-tasks", companyId, employeeId], queryFn: () => fetchMyHrTasks(companyId, employeeId), enabled: !!me });
  const { data: announcements = [] } = useQuery({ queryKey: ["hr", "announcements", companyId], queryFn: () => fetchAnnouncements(companyId) });
  const requests = useMemo(() => requestsQuery.data ?? [], [requestsQuery.data]);
  const names = useMemo(() => new Map(me ? [[me.id, "Eu"]] : []), [me]);

  const balance = me ? vacationBalance(me, requests, Number(today.slice(0, 4))) : null;
  const openTodos = todos.filter((todo) => todo.status === "pendente");
  const pendingRequests = requests.filter((request) => request.status === "pendente");
  const sortedAnnouncements = [...announcements].sort((a, b) => b.pinned - a.pinned || b.published_at.localeCompare(a.published_at));

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
    { key: "start_date", header: "Início", kind: "date", required: true },
    { key: "end_date", header: "Fim", kind: "date", required: true },
    { key: "days", header: "Dias", kind: "number", readOnly: true },
    { key: "reason", header: "Motivo", kind: "text", placeholder: "opcional" },
    { key: "status", header: "Status", kind: "select", options: STATUSES, readOnly: true, render: (request) => <StatusBadge status={request.status} tone={request.status === "aprovada" ? "success" : undefined} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Meu RH" description={`${me.name}, ${me.position ?? "colaborador"} em ${me.department ?? "sua área"}. Aqui ficam suas férias, solicitações, comunicados e pendências.`} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Férias disponíveis" value={`${balance.available} dias`} />
        <KpiCard title="Solicitações em análise" value={pendingRequests.length} />
        <KpiCard title="Pendências abertas" value={openTodos.length} />
        <KpiCard title="Tempo de empresa" value={tenureLabel(me.hire_date, today)} />
      </div>

      <section aria-label="Minhas solicitações" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Peça férias, folga ou envie um atestado com Adicionar. Você pode pedir até {balance.available} dia(s) de férias.</p>
          <ViewSwitch value={view} onChange={setView} label="Ver solicitações em" />
        </div>
        {view === "lista" ? (
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
            emptyMessage="Você ainda não fez solicitações."
          />
        ) : (
          <CalendarView items={requestCalendarItems(requests, names)} label="Minhas férias e folgas" />
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="rounded-xl border bg-card">
          <header className="border-b px-5 py-3"><h2 className="font-bold">Minhas pendências</h2></header>
          {todos.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">Nenhuma pendência. Quando o RH precisar de algo seu, aparece aqui.</p> : (
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

        <section className="rounded-xl border bg-card">
          <header className="flex items-center gap-2 border-b px-5 py-3"><Megaphone size={16} className="text-muted-foreground" /><h2 className="font-bold">Comunicados do RH</h2></header>
          {sortedAnnouncements.length === 0 ? <EmptyState title="Sem comunicados" description="Os avisos do RH aparecem aqui." /> : (
            <ul className="divide-y">
              {sortedAnnouncements.map((item) => (
                <li key={item.id} className="space-y-1.5 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={item.category} className="shrink-0" />
                    {item.pinned ? <span className="text-xs font-semibold text-primary-text">Fixado</span> : null}
                    <span className="ml-auto text-xs text-muted-foreground">{formatDay(item.published_at)}</span>
                  </div>
                  <h3 className="text-sm font-bold leading-snug">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
