import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn, formatDay, todayIso } from "@/lib/utils";
import { fetchEmployees } from "@/lib/hr/queries";
import { addTimeEntry, decideTimeEntry, fetchTimeEntries, formatMinutes, timeBankByEmployee, timeBankSummary } from "@/lib/hr/timebank";
import { TimeEntryDialog, type TimeEntryDraft } from "../components/TimeEntryDialog";
import { BTN_PRIMARY, ErrorAlert, INPUT, Panel, TH, balanceTone, errorMessage } from "../components/hrUi";

/** Gestão de RH > Banco de horas: saldos da equipe, aprovação do que os colaboradores informaram e lançamentos do RH. */
export default function TimeBankPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const companyId = session.company.id;
  const today = todayIso();
  const canCreate = usePermission("create", "hr_admin");
  const canApprove = usePermission("approve", "hr_admin");
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("todos");

  const { data: employees = [] } = useQuery({ queryKey: ["hr", "employees", companyId], queryFn: () => fetchEmployees(companyId) });
  const { data: entries = [], isLoading } = useQuery({ queryKey: ["hr", "time-entries", companyId], queryFn: async () => fetchTimeEntries(await getDb(), companyId) });

  const byId = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const summaries = useMemo(() => timeBankByEmployee(entries), [entries]);
  const team = timeBankSummary(entries);
  const pending = entries.filter((entry) => entry.status === "pendente").sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  const month = today.slice(0, 7);
  const monthCredits = entries.filter((entry) => entry.status === "aprovada" && entry.minutes > 0 && entry.entry_date.startsWith(month)).reduce((sum, entry) => sum + entry.minutes, 0);
  const rows = employees
    .filter((employee) => employee.status !== "desligado" || summaries.has(employee.id))
    .map((employee) => ({ employee, summary: summaries.get(employee.id) ?? timeBankSummary([]) }));
  const negative = rows.filter((row) => row.summary.balance < 0).length;
  const shown = employeeFilter === "todos" ? entries : entries.filter((entry) => entry.employee_id === employeeFilter);
  const active = employees.filter((employee) => employee.status !== "desligado");

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

  const launch = useMutation({
    mutationFn: async (draft: TimeEntryDraft) => {
      const id = await addTimeEntry(await getDb(), companyId, draft, session.user.id, today, session.user.id);
      await emit({ type: "hr_time_entry.created", companyId, actorId: session.user.id, entityType: "hr_time_entry", entityId: id, title: `Banco de horas: ${byId.get(draft.employeeId)?.name ?? "colaborador"} ${formatMinutes(draft.minutes ?? 0)}`, module: "hr_manage" });
    },
    onSuccess: () => { void refresh(); setDialog(false); setDialogError(""); },
    onError: (cause) => setDialogError(errorMessage(cause)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Banco de horas da equipe"
        description="Horas extras (crédito) e compensações (débito) de cada colaborador. Só o que foi aprovado entra no saldo."
        actions={canCreate && active.length > 0 ? <button type="button" onClick={() => { setDialogError(""); setDialog(true); }} className={BTN_PRIMARY}><Plus size={14} /> Lançar horas</button> : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Saldo da equipe" value={formatMinutes(team.balance)} />
        <StatCard title="Aguardando aprovação" value={pending.length} />
        <StatCard title="Horas extras no mês" value={formatMinutes(monthCredits, { signed: false })} />
        <StatCard title="Saldo negativo" value={negative} />
      </div>

      <ErrorAlert message={error} onClose={() => setError("")} />

      <Panel title={`Aguardando aprovação${pending.length ? ` (${pending.length})` : ""}`}>
        {pending.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">{isLoading ? "Carregando…" : "Nenhum lançamento aguardando. Quando um colaborador informar horas no Meu banco de horas, aparece aqui."}</p> : (
          <ul className="divide-y">
            {pending.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{byId.get(entry.employee_id)?.name ?? "Colaborador removido"} <span className={cn("ml-1 tabular-nums", balanceTone(entry.minutes))}>{formatMinutes(entry.minutes)}</span></p>
                  <p className="text-xs text-muted-foreground">{formatDay(entry.entry_date)} · {entry.reason ?? "sem motivo"}</p>
                </div>
                {canApprove && (
                  <span className="inline-flex gap-1.5">
                    <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: entry.id, approve: true })} className="flex items-center gap-1 rounded-md bg-status-success px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"><Check size={13} /> Aprovar</button>
                    <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: entry.id, approve: false })} className="flex items-center gap-1 rounded-md bg-status-danger px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"><X size={13} /> Recusar</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

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

      <Panel
        title="Lançamentos"
        actions={(
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Colaborador</span>
            <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)} className={cn(INPUT, "w-56")}>
              <option value="todos">Todos</option>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </select>
          </label>
        )}
      >
        {shown.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">Nenhum lançamento{employeeFilter === "todos" ? "" : " para este colaborador"}.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted"><tr>{["Data", "Colaborador", "Horas", "Motivo", "Status"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {shown.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDay(entry.entry_date)}</td>
                    <td className="px-4 py-3 font-medium">{byId.get(entry.employee_id)?.name ?? "—"}</td>
                    <td className={cn("px-4 py-3 tabular-nums", balanceTone(entry.minutes))}>{formatMinutes(entry.minutes)}</td>
                    <td className="max-w-72 truncate px-4 py-3 text-muted-foreground">{entry.reason ?? "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={entry.status} tone={entry.status === "aprovada" ? "success" : undefined} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {dialog && (
        <TimeEntryDialog
          title="Lançar horas"
          today={today}
          employees={active.map((employee) => ({ id: employee.id, name: employee.name }))}
          busy={launch.isPending}
          error={dialogError}
          help="Lançado pelo RH, já entra aprovado no saldo."
          onClose={() => setDialog(false)}
          onSubmit={(draft) => launch.mutate(draft)}
        />
      )}
    </div>
  );
}
