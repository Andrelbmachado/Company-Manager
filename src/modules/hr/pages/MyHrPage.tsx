import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { CheckCircle2, Circle, Megaphone, Plus } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn, formatDay, todayIso } from "@/lib/utils";
import { ensureMyEmployee, fetchAnnouncements, fetchMyHrTasks, fetchMyRequests } from "@/lib/hr/queries";
import { REQUEST_TYPES, REQUEST_TYPE_LABEL, inclusiveDays, tenureLabel, vacationBalance, validateRequest } from "@/lib/hr/rules";
import type { HrRequestType } from "@/types";

const EMPTY = { type: "ferias", start_date: "", end_date: "", reason: "" };

/** "Meu RH": a área de RH de qualquer colaborador (férias, solicitações, comunicados e pendências do próprio cadastro). */
export default function MyHrPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const companyId = session.company.id;
  const today = todayIso();
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const [formError, setFormError] = useState("");

  const { data: me } = useQuery({ queryKey: ["hr", "me", companyId, session.user.id], queryFn: () => ensureMyEmployee(session) });
  const employeeId = me?.id ?? "";
  const { data: requests = [] } = useQuery({ queryKey: ["hr", "my-requests", companyId, employeeId], queryFn: () => fetchMyRequests(companyId, employeeId), enabled: !!me });
  const { data: todos = [] } = useQuery({ queryKey: ["hr", "my-tasks", companyId, employeeId], queryFn: () => fetchMyHrTasks(companyId, employeeId), enabled: !!me });
  const { data: announcements = [] } = useQuery({ queryKey: ["hr", "announcements", companyId], queryFn: () => fetchAnnouncements(companyId) });

  const balance = me ? vacationBalance(me, requests, Number(today.slice(0, 4))) : null;
  const openTodos = todos.filter((todo) => todo.status === "pendente");
  const pendingRequests = requests.filter((request) => request.status === "pendente");
  const sortedAnnouncements = [...announcements].sort((a, b) => b.pinned - a.pinned || b.published_at.localeCompare(a.published_at));

  const refresh = () => qc.invalidateQueries({ queryKey: ["hr"] });

  const requestMutation = useMutation({
    mutationFn: async () => {
      if (!me || !balance) return;
      const type = form.type as HrRequestType;
      // O saldo é o do ano em que as férias começam (não o de hoje): pedir para o ano que vem usa o saldo do ano que vem.
      const requestYear = Number((form.start_date || today).slice(0, 4));
      const error = validateRequest({ type, start: form.start_date, end: form.end_date }, vacationBalance(me, requests, requestYear), today);
      if (error) throw new Error(error);
      const id = uuidv4();
      await (await getDb()).execute(
        "INSERT INTO hr_requests (id, company_id, employee_id, type, start_date, end_date, days, reason, status) VALUES (?,?,?,?,?,?,?,?,?)",
        [id, companyId, me.id, type, form.start_date, form.end_date, inclusiveDays(form.start_date, form.end_date), form.reason.trim() || null, "pendente"],
      );
      await emit({ type: "hr_request.created", companyId, actorId: session.user.id, entityType: "hr_request", entityId: id, title: `${REQUEST_TYPE_LABEL[type]} solicitada por ${me.name}`, module: "hr" });
    },
    onSuccess: () => { void refresh(); setDialog(false); setForm(EMPTY); setFormError(""); },
    onError: (error) => setFormError(error instanceof Error ? error.message : String(error)),
  });

  const completeTodo = useMutation({
    mutationFn: async (id: string) => {
      await (await getDb()).execute("UPDATE hr_tasks SET status=?, updated_at=datetime('now') WHERE id=? AND company_id=?", ["concluida", id, companyId]);
    },
    onSuccess: () => void refresh(),
  });

  if (!me || !balance) return <div className="h-36 animate-pulse rounded-xl border bg-card" />;

  const previewDays = form.start_date && form.end_date ? inclusiveDays(form.start_date, form.end_date) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meu RH"
        description={`${me.name}, ${me.position ?? "colaborador"} em ${me.department ?? "sua área"}. Aqui ficam suas férias, solicitações, comunicados e pendências.`}
        actions={<button onClick={() => { setForm(EMPTY); setFormError(""); setDialog(true); }} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Plus size={14} /> Nova solicitação</button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Férias disponíveis" value={`${balance.available} dias`} hint={`${balance.entitled} de direito, ${balance.used} aprovados, ${balance.pending} em análise`} />
        <StatCard title="Solicitações em análise" value={pendingRequests.length} hint={pendingRequests.length ? "Aguardando resposta do RH" : "Nada aguardando resposta"} />
        <StatCard title="Pendências abertas" value={openTodos.length} hint={openTodos.some((todo) => todo.due_date && todo.due_date < today) ? "Há pendência com prazo vencido" : "Itens que o RH pediu para você"} />
        <StatCard title="Tempo de empresa" kind="text" value={tenureLabel(me.hire_date, today)} hint={me.hire_date ? `Admissão em ${formatDay(me.hire_date)}` : "Admissão não informada"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
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
            <header className="border-b px-5 py-3"><h2 className="font-bold">Minhas solicitações</h2></header>
            {requests.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">Você ainda não fez solicitações. Use “Nova solicitação” para pedir férias, folga ou enviar um atestado.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted"><tr>{["Tipo", "Período", "Dias", "Status"].map((h) => <th key={h} className="px-5 py-2.5 text-left font-medium text-muted-foreground">{h}</th>)}</tr></thead>
                  <tbody className="divide-y">
                    {requests.map((request) => (
                      <tr key={request.id}>
                        <td className="px-5 py-3 font-medium">{REQUEST_TYPE_LABEL[request.type]}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{formatDay(request.start_date)} a {formatDay(request.end_date)}</td>
                        <td className="px-5 py-3 tabular-nums">{request.days}</td>
                        <td className="px-5 py-3"><StatusBadge status={request.status} tone={request.status === "aprovada" ? "success" : undefined} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

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

      {dialog && (
        <CrudDialog
          title="Nova solicitação"
          fields={[
            { key: "type", label: "Tipo", type: "select", options: REQUEST_TYPES.map((type) => ({ value: type.value, label: type.label })) },
            { key: "start_date", label: "Início", type: "date", required: true },
            { key: "end_date", label: "Fim", type: "date", required: true },
            { key: "reason", label: "Motivo (opcional)", type: "textarea" },
          ]}
          values={form}
          onChange={(key, value) => { setFormError(""); setForm((current) => ({ ...current, [key]: value })); }}
          onClose={() => setDialog(false)}
          onSubmit={() => requestMutation.mutate()}
          busy={requestMutation.isPending}
          submitLabel="Enviar ao RH"
        >
          <p className="mt-3 text-sm text-muted-foreground">
            {previewDays ? `${previewDays} dia(s) corridos. ` : ""}
            {form.type === "ferias" ? `Você pode pedir até ${balance.available} dia(s) de férias.` : ""}
          </p>
          {formError && <p role="alert" className="mt-2 text-sm font-medium text-status-danger dark:text-red-400">{formError}</p>}
        </CrudDialog>
      )}
    </div>
  );
}
