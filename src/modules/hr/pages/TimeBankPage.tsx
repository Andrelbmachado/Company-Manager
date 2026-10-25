import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { CalendarView } from "@/components/shared/CalendarView";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn, todayIso } from "@/lib/utils";
import { fetchEmployees } from "@/lib/hr/queries";
import { decideTimeEntry, fetchTimeEntries, formatMinutes, timeBankByEmployee, timeBankSummary } from "@/lib/hr/timebank";
import { saveTimeEntryRows, timeEntryCalendarItems, timeEntryRows, type TimeEntryRow } from "@/lib/hr/tableEdits";
import { ViewSwitch, type ListOrCalendar } from "../components/ViewSwitch";
import { ErrorAlert, INPUT, Panel, TH, balanceTone, errorMessage } from "../components/hrUi";
import type { Role } from "@/types";

const STATUSES = [
  { value: "pendente", label: "Pendente" },
  { value: "aprovada", label: "Aprovada" },
  { value: "recusada", label: "Recusada" },
];

/** Gestão de RH > Banco de horas: lançamentos editáveis na tabela (o RH lança já aprovado), aprovação e saldos. */
export default function TimeBankPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const companyId = session.company.id;
  const actor = { role: session.membership.role as Role, userId: session.user.id };
  const today = todayIso();
  const canApprove = usePermission("approve", "hr_admin");
  const [error, setError] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("todos");
  const [onlyPending, setOnlyPending] = useState(false);
  const [view, setView] = useState<ListOrCalendar>("lista");

  const employeesQuery = useQuery({ queryKey: ["hr", "employees", companyId], queryFn: () => fetchEmployees(companyId) });
  const entriesQuery = useQuery({ queryKey: ["hr", "time-entries", companyId], queryFn: async () => fetchTimeEntries(await getDb(), companyId) });
  const employees = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data]);
  const entries = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);

  const byId = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const names = useMemo(() => new Map(employees.map((employee) => [employee.id, employee.name])), [employees]);
  const summaries = useMemo(() => timeBankByEmployee(entries), [entries]);
  const team = timeBankSummary(entries);
  const pending = entries.filter((entry) => entry.status === "pendente");
  const month = today.slice(0, 7);
  const monthCredits = entries.filter((entry) => entry.status === "aprovada" && entry.minutes > 0 && entry.entry_date.startsWith(month)).reduce((sum, entry) => sum + entry.minutes, 0);
  const rows = employees
    .filter((employee) => employee.status !== "desligado" || summaries.has(employee.id))
    .map((employee) => ({ employee, summary: summaries.get(employee.id) ?? timeBankSummary([]) }));
  const negative = rows.filter((row) => row.summary.balance < 0).length;
  const shown = timeEntryRows(entries.filter((entry) => (employeeFilter === "todos" || entry.employee_id === employeeFilter) && (!onlyPending || entry.status === "pendente")));
  const employeeOptions = employees.map((employee) => ({ value: employee.id, label: employee.status === "desligado" ? `${employee.name} (desligado)` : employee.name }));

  const refresh = () => qc.invalidateQueries({ queryKey: ["hr"] });

  const decide = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      await decideTimeEntry(await getDb(), companyId, id, approve, session.user.id);
      const entry = entries.find((item) => item.id === id);
      const who = entry ? `: ${byId.get(entry.employee_id)?.name ?? "colaborador"} ${formatMinutes(entry.minutes)}` : "";
      await emit({ type: "hr_time_entry.decided", companyId, actorId: session.user.id, entityType: "hr_time_entry", entityId: id, title: `Banco de horas ${approve ? "aprovado" : "recusado"}${who}`, module: "hr_manage" });
    },
    onSuccess: () => { void refresh(); setError(""); },
    onError: (cause) => { void refresh(); setError(errorMessage(cause)); },
  });

  async function save(changes: EditableTableChanges<TimeEntryRow>) {
    const { created } = await saveTimeEntryRows(await getDb(), companyId, actor, changes, today, { mode: "rh" });
    for (const id of created) await emit({ type: "hr_time_entry.created", companyId, actorId: session.user.id, entityType: "hr_time_entry", entityId: id, title: "Banco de horas: lançamento do RH", module: "hr_manage" });
  }

  const columns: EditableColumn<TimeEntryRow>[] = [
    { key: "entry_date", header: "Data", kind: "date", required: true },
    { key: "employee_id", header: "Colaborador", kind: "select", options: employeeOptions, required: true, render: (entry) => <span className="font-medium">{names.get(entry.employee_id) ?? "—"}</span> },
    { key: "hours", header: "Horas", kind: "text", required: true, placeholder: "1:30 ou -0:30", render: (entry) => <span className={cn("tabular-nums", balanceTone(entry.minutes))}>{entry.hours}</span> },
    { key: "reason", header: "Motivo", kind: "text", required: true },
    { key: "status", header: "Status", kind: "select", options: STATUSES, readOnly: true, render: (entry) => <StatusBadge status={entry.status} tone={entry.status === "aprovada" ? "success" : undefined} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Banco de horas da equipe" description="Horas extras (crédito) e compensações (débito) de cada colaborador. Só o que foi aprovado entra no saldo." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Saldo da equipe" value={formatMinutes(team.balance)} />
        <KpiCard title="Aguardando aprovação" value={pending.length} />
        <KpiCard title="Horas extras no mês" value={formatMinutes(monthCredits, { signed: false })} />
        <KpiCard title="Saldo negativo" value={negative} />
      </div>

      <ErrorAlert message={error} onClose={() => setError("")} />

      <section aria-label="Lançamentos" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-pressed={!onlyPending} onClick={() => setOnlyPending(false)} className={cn("rounded-md border px-3 py-1.5 text-sm font-medium", !onlyPending ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>Todos</button>
            <button type="button" aria-pressed={onlyPending} onClick={() => setOnlyPending(true)} className={cn("rounded-md border px-3 py-1.5 text-sm font-medium", onlyPending ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>Aguardando aprovação ({pending.length})</button>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Colaborador</span>
              <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)} className={cn(INPUT, "w-56")}>
                <option value="todos">Todos</option>
                {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
              </select>
            </label>
          </div>
          <ViewSwitch value={view} onChange={setView} label="Ver lançamentos em" />
        </div>
        {view === "lista" ? (
          <EditableTable<TimeEntryRow>
            resource="hr_admin"
            label="Lançamentos do banco de horas"
            title="Lançamentos"
            rows={shown}
            columns={columns}
            loading={entriesQuery.isLoading}
            newRow={() => ({ entry_date: today, employee_id: employeeFilter === "todos" ? undefined : employeeFilter })}
            onSave={save}
            onRefresh={refresh}
            rowActions={(entry) => entry.status === "pendente" && canApprove ? (
              <span className="inline-flex gap-1.5">
                <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: entry.id, approve: true })} className="flex items-center gap-1 rounded-md bg-status-success px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"><Check size={13} /> Aprovar</button>
                <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: entry.id, approve: false })} className="flex items-center gap-1 rounded-md bg-status-danger px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"><X size={13} /> Recusar</button>
              </span>
            ) : null}
            emptyMessage={onlyPending ? "Nenhum lançamento aguardando. Quando um colaborador informar horas no Meu banco de horas, aparece aqui." : "Nenhum lançamento. Adicionar lança horas já aprovadas (positivo = hora extra, negativo = compensação)."}
          />
        ) : (
          <CalendarView items={timeEntryCalendarItems(shown, names)} label="Lançamentos do banco de horas" />
        )}
        <p className="text-xs text-muted-foreground">Lançado pelo RH já entra aprovado no saldo. Só lançamento em análise pode ser corrigido; para mudar um aprovado, lance um ajuste.</p>
      </section>

      <Panel title="Saldo por colaborador">
        {rows.length === 0 ? <EmptyState title="Nenhum colaborador cadastrado" description="Cadastre os colaboradores em Gestão de RH para controlar o banco de horas." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted"><tr>{["Colaborador", "Jornada", "Créditos", "Compensações", "Saldo", "Em análise"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {rows.map(({ employee, summary }) => (
                  <tr key={employee.id}>
                    <td className="px-4 py-3">
                      <Link to={`/hr/manage/colaboradores/${employee.id}`} className="font-medium hover:underline">{employee.name}</Link>
                      <p className="text-xs text-muted-foreground">{employee.department ?? "—"}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">{formatMinutes(Number(employee.daily_minutes) || 480, { signed: false })}/dia</td>
                    <td className="px-4 py-3 tabular-nums">{formatMinutes(summary.credits)}</td>
                    <td className="px-4 py-3 tabular-nums">{formatMinutes(summary.debits)}</td>
                    <td className={cn("px-4 py-3 font-semibold tabular-nums", balanceTone(summary.balance))}>{formatMinutes(summary.balance)}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{summary.pendingCount ? `${formatMinutes(summary.pending)} (${summary.pendingCount})` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
