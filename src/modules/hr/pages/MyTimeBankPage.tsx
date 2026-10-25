import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { CalendarView } from "@/components/shared/CalendarView";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn, formatDay, todayIso } from "@/lib/utils";
import { ensureMyEmployee } from "@/lib/hr/queries";
import { fetchEmployeeTimeEntries, formatMinutes, timeBankSummary, withdrawTimeEntry } from "@/lib/hr/timebank";
import { saveTimeEntryRows, timeEntryCalendarItems, timeEntryRows, type TimeEntryRow } from "@/lib/hr/tableEdits";
import { ViewSwitch, type ListOrCalendar } from "../components/ViewSwitch";
import { BTN_SMALL, ErrorAlert, balanceTone, errorMessage } from "../components/hrUi";
import type { Role } from "@/types";

const STATUSES = [
  { value: "pendente", label: "Pendente" },
  { value: "aprovada", label: "Aprovada" },
  { value: "recusada", label: "Recusada" },
];

/** Meu RH > Banco de horas: o colaborador vê o próprio saldo e informa horas na tabela (o RH aprova). */
export default function MyTimeBankPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const companyId = session.company.id;
  const today = todayIso();
  const [error, setError] = useState("");
  const [view, setView] = useState<ListOrCalendar>("lista");

  const { data: me } = useQuery({ queryKey: ["hr", "me", companyId, session.user.id], queryFn: () => ensureMyEmployee(session) });
  const employeeId = me?.id ?? "";
  const entriesQuery = useQuery({
    queryKey: ["hr", "my-time-entries", companyId, employeeId],
    queryFn: async () => fetchEmployeeTimeEntries(await getDb(), companyId, employeeId),
    enabled: !!me,
  });
  const entries = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);
  const rows = useMemo(() => timeEntryRows(entries), [entries]);
  const summary = timeBankSummary(entries);
  const daily = Number(me?.daily_minutes) || 480;
  const names = useMemo(() => new Map(me ? [[me.id, "Eu"]] : []), [me]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["hr"] });

  async function save(changes: EditableTableChanges<TimeEntryRow>) {
    if (!me) throw new Error("Seu cadastro ainda está carregando.");
    const { created } = await saveTimeEntryRows(await getDb(), companyId, { role: session.membership.role as Role, userId: session.user.id }, changes, today, { mode: "self", employeeId: me.id });
    for (const id of created) await emit({ type: "hr_time_entry.created", companyId, actorId: session.user.id, entityType: "hr_time_entry", entityId: id, title: `Banco de horas informado por ${me.name}`, module: "hr" });
  }

  const withdraw = useMutation({
    mutationFn: async (id: string) => withdrawTimeEntry(await getDb(), companyId, id, employeeId),
    onSuccess: () => { void refresh(); setError(""); },
    onError: (cause) => { void refresh(); setError(errorMessage(cause)); },
  });

  const columns: EditableColumn<TimeEntryRow>[] = [
    { key: "entry_date", header: "Data", kind: "date", required: true },
    { key: "hours", header: "Horas", kind: "text", required: true, placeholder: "1:30 ou -2h", render: (entry) => <span className={cn("font-medium tabular-nums", balanceTone(entry.minutes))}>{entry.hours}</span> },
    { key: "reason", header: "Motivo", kind: "text", required: true, placeholder: "Ex.: plantão, entrega para cliente" },
    { key: "status", header: "Status", kind: "select", options: STATUSES, readOnly: true, render: (entry) => <StatusBadge status={entry.status} tone={entry.status === "aprovada" ? "success" : undefined} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Meu banco de horas" description="Suas horas extras (crédito) e compensações (débito). O que você informa entra no saldo depois que o RH aprova." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Saldo" value={<span className={balanceTone(summary.balance)}>{formatMinutes(summary.balance)}</span>} />
        <KpiCard title="Em análise" value={summary.pendingCount} />
        <KpiCard title="Créditos aprovados" value={formatMinutes(summary.credits, { signed: false })} />
        <KpiCard title="Jornada diária" value={formatMinutes(daily, { signed: false })} />
      </div>

      <ErrorAlert message={error} onClose={() => setError("")} />

      <div className="flex justify-end"><ViewSwitch value={view} onChange={setView} label="Ver extrato em" /></div>
      {view === "lista" ? (
        <EditableTable<TimeEntryRow>
          resource="hr_self"
          label="Extrato do banco de horas"
          title="Extrato"
          rows={rows}
          columns={columns}
          loading={!me || entriesQuery.isLoading}
          newRow={() => ({ entry_date: today })}
          onSave={save}
          onRefresh={refresh}
          rowActions={(entry) => entry.status === "pendente" ? (
            <button type="button" disabled={withdraw.isPending} onClick={() => withdraw.mutate(entry.id)} className={BTN_SMALL} aria-label={`Retirar lançamento de ${formatDay(entry.entry_date)}`}>Retirar</button>
          ) : null}
          emptyMessage="Nenhum lançamento ainda. Fez hora extra? Use Adicionar (ex.: 1:30) e o RH aprova; compensação vai com sinal de menos (-2h)."
        />
      ) : (
        <CalendarView items={timeEntryCalendarItems(rows, names)} label="Meu banco de horas" />
      )}
    </div>
  );
}
