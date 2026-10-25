import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn, formatDay, todayIso } from "@/lib/utils";
import { ensureMyEmployee } from "@/lib/hr/queries";
import { addTimeEntry, fetchEmployeeTimeEntries, formatMinutes, timeBankSummary, withdrawTimeEntry } from "@/lib/hr/timebank";
import { TimeEntryDialog, type TimeEntryDraft } from "../components/TimeEntryDialog";
import { BTN_PRIMARY, BTN_SMALL, ErrorAlert, Panel, TH, balanceTone, errorMessage } from "../components/hrUi";

/** Meu RH > Banco de horas: o colaborador vê o próprio saldo e informa horas extras ou compensações (o RH aprova). */
export default function MyTimeBankPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const companyId = session.company.id;
  const today = todayIso();
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");

  const { data: me } = useQuery({ queryKey: ["hr", "me", companyId, session.user.id], queryFn: () => ensureMyEmployee(session) });
  const employeeId = me?.id ?? "";
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["hr", "my-time-entries", companyId, employeeId],
    queryFn: async () => fetchEmployeeTimeEntries(await getDb(), companyId, employeeId),
    enabled: !!me,
  });
  const summary = timeBankSummary(entries);
  const daily = Number(me?.daily_minutes) || 480;

  const refresh = () => qc.invalidateQueries({ queryKey: ["hr"] });

  const inform = useMutation({
    mutationFn: async (draft: TimeEntryDraft) => {
      if (!me) throw new Error("Seu cadastro ainda está carregando.");
      const id = await addTimeEntry(await getDb(), companyId, { ...draft, employeeId: me.id }, session.user.id, today);
      await emit({ type: "hr_time_entry.created", companyId, actorId: session.user.id, entityType: "hr_time_entry", entityId: id, title: `Banco de horas informado por ${me.name}: ${formatMinutes(draft.minutes ?? 0)}`, module: "hr" });
    },
    onSuccess: () => { void refresh(); setDialog(false); setDialogError(""); },
    onError: (cause) => setDialogError(errorMessage(cause)),
  });

  const withdraw = useMutation({
    mutationFn: async (id: string) => withdrawTimeEntry(await getDb(), companyId, id, employeeId),
    onSuccess: () => { void refresh(); setError(""); },
    onError: (cause) => { void refresh(); setError(errorMessage(cause)); },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meu banco de horas"
        description="Suas horas extras (crédito) e compensações (débito). O que você informa entra no saldo depois que o RH aprova."
        actions={<button type="button" disabled={!me} onClick={() => { setDialogError(""); setDialog(true); }} className={BTN_PRIMARY}><Plus size={14} /> Informar horas</button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Saldo" value={<span className={balanceTone(summary.balance)}>{formatMinutes(summary.balance)}</span>} hint={summary.balance < 0 ? "Você deve horas: combine a reposição com o RH" : "Horas aprovadas a compensar"} />
        <StatCard title="Em análise" value={summary.pendingCount} hint={summary.pendingCount ? `${formatMinutes(summary.pending)} aguardando o RH` : "Nada aguardando o RH"} />
        <StatCard title="Créditos aprovados" value={formatMinutes(summary.credits, { signed: false })} hint={`${formatMinutes(summary.debits, { signed: false })} já compensadas`} />
        <StatCard title="Jornada diária" kind="text" value={formatMinutes(daily, { signed: false })} hint={summary.balance > 0 ? `Seu saldo equivale a ${(summary.balance / daily).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dia(s) de folga` : "Base para converter horas em dias de folga"} />
      </div>

      <ErrorAlert message={error} onClose={() => setError("")} />

      <Panel title="Extrato">
        {!me || isLoading ? <div className="m-5 h-24 animate-pulse rounded-lg bg-muted" /> : entries.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Nenhum lançamento ainda. Fez hora extra? Use “Informar horas” e o RH aprova.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted"><tr>{["Data", "Horas", "Motivo", "Status", ""].map((h, index) => <th key={h || index} className={TH}>{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDay(entry.entry_date)}</td>
                    <td className={cn("px-4 py-3 font-medium tabular-nums", balanceTone(entry.minutes))}>{formatMinutes(entry.minutes)}</td>
                    <td className="max-w-72 truncate px-4 py-3 text-muted-foreground">{entry.reason ?? "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={entry.status} tone={entry.status === "aprovada" ? "success" : undefined} /></td>
                    <td className="px-4 py-3 text-right">
                      {entry.status === "pendente" && <button type="button" disabled={withdraw.isPending} onClick={() => withdraw.mutate(entry.id)} className={BTN_SMALL} aria-label={`Retirar lançamento de ${formatDay(entry.entry_date)}`}>Retirar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {dialog && me && (
        <TimeEntryDialog
          title="Informar horas"
          today={today}
          employeeId={me.id}
          submitLabel="Enviar para o RH"
          busy={inform.isPending}
          error={dialogError}
          help="Entra no saldo depois que o RH aprovar."
          onClose={() => setDialog(false)}
          onSubmit={(draft) => inform.mutate(draft)}
        />
      )}
    </div>
  );
}
