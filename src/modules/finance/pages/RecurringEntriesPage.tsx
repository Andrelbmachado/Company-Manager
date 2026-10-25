// Lançamentos recorrentes (aluguel, assinaturas, contratos): cadastro, próximo lançamento e geração das contas do mês
// sem duplicar. Regras em lib/erp/recurring e lib/erp/financeSetup.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Pencil, Play, Plus, Repeat, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { isTrue, monthLabel, parseMoneyInput } from "@/lib/erp/financeCommon";
import { deleteRecurring, RECURRING_FREQUENCIES, saveRecurring, setRecurringActive } from "@/lib/erp/financeSetup";
import { FREQUENCY_LABELS, nextOccurrence, runRecurring } from "@/lib/erp/recurring";
import { roundMoney, sumMoney } from "@/lib/money";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { RecurringEntry, RecurringFrequency, RecurringKind } from "@/types";
import {
  ConfirmButton,
  ErrorNote,
  SuccessNote,
  categoryOptions,
  errorMessage,
  invalidateFinance,
  primaryButton,
  secondaryButton,
  td,
  th,
  useFinanceLookups,
  withEmpty,
} from "../components/financeShared";

/** Quantas vezes por mês, para o total mensal equivalente. */
const PER_MONTH: Record<RecurringFrequency, number> = { semanal: 52 / 12, mensal: 1, bimestral: 1 / 2, trimestral: 1 / 3, semestral: 1 / 6, anual: 1 / 12 };
const YES_NO = [
  { value: "1", label: "Sim" },
  { value: "0", label: "Não" },
];
const iconButton = "rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground";

const formFrom = (entry: RecurringEntry | null, today: string): Record<string, string> => ({
  kind: entry?.kind ?? "pagar",
  description: entry?.description ?? "",
  amount: entry ? String(entry.amount) : "",
  frequency: entry?.frequency ?? "mensal",
  day_of_month: entry?.day_of_month != null ? String(entry.day_of_month) : "",
  start_date: entry?.start_date?.slice(0, 10) ?? today,
  end_date: entry?.end_date?.slice(0, 10) ?? "",
  party_id: (entry?.kind === "receber" ? entry?.customer_id : entry?.supplier_id) ?? "",
  category_id: entry?.category_id ?? "",
  cost_center_id: entry?.cost_center_id ?? "",
  bank_account_id: entry?.bank_account_id ?? "",
  notes: entry?.notes ?? "",
  active: entry ? (isTrue(entry.active) ? "1" : "0") : "1",
});

const frequencyText = (entry: RecurringEntry) =>
  entry.frequency === "semanal" ? "Semanal" : `${FREQUENCY_LABELS[entry.frequency]}${entry.day_of_month ? `, dia ${entry.day_of_month}` : ""}`;

const competenceText = (competence: string | null | undefined) => (!competence ? "—" : competence.length === 7 ? monthLabel(competence) : formatDay(competence));

export default function RecurringEntriesPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const today = todayIso();
  const lookups = useFinanceLookups(companyId);
  const canCreate = usePermission("create", "finance");
  const canEdit = usePermission("edit", "finance");
  const canDelete = usePermission("delete", "finance");
  const createPayables = usePermission("create", "payables");
  const createReceivables = usePermission("create", "receivables");
  const [form, setForm] = useState<{ id: string | null; values: Record<string, string> } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: entries = [] } = useQuery({
    queryKey: ["recurring_entries", companyId],
    queryFn: async () =>
      (await (await getDb()).select<RecurringEntry[]>("SELECT * FROM recurring_entries WHERE company_id=? AND deleted_at IS NULL", [companyId])).sort(
        (a, b) => Number(isTrue(b.active)) - Number(isTrue(a.active)) || a.description.localeCompare(b.description, "pt-BR"),
      ),
  });
  const active = entries.filter((entry) => isTrue(entry.active));
  const monthly = (kind: RecurringKind) => roundMoney(sumMoney(active.filter((entry) => entry.kind === kind).map((entry) => Number(entry.amount) * PER_MONTH[entry.frequency])));
  const upcoming = active
    .map((entry) => ({ entry, next: nextOccurrence(entry, today) }))
    .filter((item): item is { entry: RecurringEntry; next: NonNullable<typeof item.next> } => item.next !== null)
    .sort((a, b) => a.next.dueDate.localeCompare(b.next.dueDate))[0];
  const kinds: RecurringKind[] = [...(createPayables ? (["pagar"] as const) : []), ...(createReceivables ? (["receber"] as const) : [])];

  const generate = useMutation({
    mutationFn: async () => runRecurring(await getDb(), companyId, today, { kinds }),
    onSuccess: async (result) => {
      invalidateFinance(qc, companyId);
      setNotice(
        result.created === 0
          ? "Nada a gerar: as recorrências ativas já estão lançadas até este mês."
          : `${result.created} lançamento(s) gerado(s): ${result.payableIds.length} a pagar e ${result.receivableIds.length} a receber.`,
      );
      if (result.created > 0) {
        await emit({ type: "finance.recurring.generated", companyId, actorId: session.user.id, entityType: "recurring_entry", entityId: companyId, module: "finance", title: `${result.created} lançamento(s) recorrente(s) gerado(s)` });
      }
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return "";
      const values = form.values;
      const amount = parseMoneyInput(values.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Informe um valor maior que zero.");
      return saveRecurring(
        await getDb(),
        companyId,
        {
          kind: values.kind as RecurringKind,
          description: values.description,
          amount,
          frequency: values.frequency as RecurringFrequency,
          dayOfMonth: values.day_of_month ? Number(values.day_of_month) : null,
          startDate: values.start_date,
          endDate: values.end_date || null,
          partyId: values.party_id || null,
          categoryId: values.category_id || null,
          costCenterId: values.cost_center_id || null,
          bankAccountId: values.bank_account_id || null,
          notes: values.notes,
          active: values.active === "1",
        },
        session.user.id,
        form.id ?? undefined,
      );
    },
    onSuccess: () => {
      invalidateFinance(qc, companyId);
      setForm(null);
    },
  });
  const update = useMutation({
    mutationFn: async (run: { type: "toggle" | "delete"; entry: RecurringEntry }) => {
      const db = await getDb();
      if (run.type === "toggle") await setRecurringActive(db, companyId, run.entry.id, !isTrue(run.entry.active));
      else await deleteRecurring(db, companyId, run.entry.id);
    },
    onSuccess: () => invalidateFinance(qc, companyId),
  });

  const formKind = (form?.values.kind ?? "pagar") as RecurringKind;
  const payable = formKind === "pagar";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lançamentos recorrentes"
        description="Aluguel, assinaturas, contratos e outros lançamentos que se repetem. Ao abrir o financeiro, as contas do mês são geradas sozinhas, sem duplicar."
        actions={
          <>
            <ImportExportButtons entity="recurring_entries" onImported={() => invalidateFinance(qc, companyId)} />
            {kinds.length > 0 && (
              <button type="button" disabled={generate.isPending} onClick={() => generate.mutate()} className={secondaryButton}>
                <Play size={14} aria-hidden="true" /> Gerar lançamentos do mês
              </button>
            )}
            {canCreate && (
              <button type="button" onClick={() => setForm({ id: null, values: formFrom(null, today) })} className={primaryButton}>
                <Plus size={14} aria-hidden="true" /> Nova recorrência
              </button>
            )}
          </>
        }
      />

      {notice && <SuccessNote onClose={() => setNotice(null)}>{notice}</SuccessNote>}
      <ErrorNote message={generate.error ? errorMessage(generate.error) : update.error ? errorMessage(update.error) : null} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Ativas" value={String(active.length)} subtitle={entries.length > active.length ? `${entries.length - active.length} pausada(s)` : undefined} icon={Repeat} />
        <KpiCard title="A pagar por mês" value={formatCurrency(monthly("pagar"))} subtitle="Equivalente mensal" icon={TrendingDown} iconClassName="bg-red-600/10 text-red-700 dark:text-red-400" />
        <KpiCard title="A receber por mês" value={formatCurrency(monthly("receber"))} subtitle="Equivalente mensal" icon={TrendingUp} iconClassName="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" />
        <KpiCard title="Próximo lançamento" value={upcoming ? formatDay(upcoming.next.dueDate) : "—"} subtitle={upcoming?.entry.description} icon={CalendarClock} />
      </div>

      {entries.length === 0 ? (
        <EmptyState icon={Repeat} title="Nenhuma recorrência" description="Cadastre o que se repete (aluguel, internet, contratos de clientes) para as contas do mês aparecerem sozinhas." />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className={th}>Descrição</th>
                <th className={th}>Tipo</th>
                <th className={cn(th, "text-right")}>Valor</th>
                <th className={th}>Frequência</th>
                <th className={th}>Próximo</th>
                <th className={th}>Último gerado</th>
                <th className={th}>Categoria</th>
                <th className={th}>Status</th>
                <th className={th}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((entry) => {
                const next = isTrue(entry.active) ? nextOccurrence(entry, today) : null;
                const party = entry.kind === "pagar" ? lookups.partyName("payable", entry.supplier_id) : lookups.partyName("receivable", entry.customer_id);
                return (
                  <tr key={entry.id} className={cn(!isTrue(entry.active) && "text-muted-foreground")}>
                    <td className={td}>
                      <p className="font-medium">{entry.description}</p>
                      {party !== "—" && <p className="text-xs text-muted-foreground">{party}</p>}
                    </td>
                    <td className={td}>{entry.kind === "pagar" ? "A pagar" : "A receber"}</td>
                    <td className={cn(td, "text-right tabular-nums")}>{formatCurrency(Number(entry.amount))}</td>
                    <td className={td}>{frequencyText(entry)}</td>
                    <td className={cn(td, "whitespace-nowrap")}>{isTrue(entry.active) ? (next ? formatDay(next.dueDate) : "Encerrada") : "Pausada"}</td>
                    <td className={td}>{competenceText(entry.last_competence)}</td>
                    <td className={td}>{lookups.categoryName(entry.category_id)}</td>
                    <td className={td}><StatusBadge status={isTrue(entry.active) ? "active" : "inactive"} /></td>
                    <td className={cn(td, "whitespace-nowrap text-right")}>
                      <span className="inline-flex items-center gap-1">
                        {canEdit && (
                          <button type="button" disabled={update.isPending} onClick={() => update.mutate({ type: "toggle", entry })} className={cn(secondaryButton, "py-1")}>
                            {isTrue(entry.active) ? "Pausar" : "Retomar"}
                          </button>
                        )}
                        {canEdit && (
                          <button type="button" onClick={() => setForm({ id: entry.id, values: formFrom(entry, today) })} className={iconButton} aria-label={`Editar ${entry.description}`} title="Editar">
                            <Pencil size={15} aria-hidden="true" />
                          </button>
                        )}
                        {canDelete && (
                          <ConfirmButton label="" ariaLabel={`Excluir ${entry.description}`} confirmLabel="Confirmar exclusão" icon={<Trash2 size={15} aria-hidden="true" />} busy={update.isPending} onConfirm={() => update.mutate({ type: "delete", entry })} />
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <CrudDialog
          title={form.id ? "Editar recorrência" : "Nova recorrência"}
          fields={[
            { key: "kind", label: "Tipo", type: "select", options: [{ value: "pagar", label: "A pagar" }, { value: "receber", label: "A receber" }] },
            { key: "description", label: "Descrição", required: true, placeholder: "Ex.: Aluguel do escritório" },
            { key: "amount", label: "Valor", required: true, placeholder: "0,00" },
            { key: "frequency", label: "Frequência", type: "select", options: RECURRING_FREQUENCIES.map((frequency) => ({ value: frequency, label: FREQUENCY_LABELS[frequency] })) },
            { key: "day_of_month", label: "Dia do vencimento", type: "number", placeholder: "Dia da data de início" },
            { key: "start_date", label: "Início", type: "date", required: true },
            { key: "end_date", label: "Fim (opcional)", type: "date" },
            { key: "party_id", label: payable ? "Fornecedor" : "Cliente", type: "select", options: withEmpty((payable ? lookups.suppliers : lookups.customers).map((item) => ({ value: item.id, label: item.name }))) },
            { key: "category_id", label: "Categoria", type: "select", options: withEmpty(categoryOptions(lookups.categories, payable ? "despesa" : "receita"), "Sem categoria") },
            { key: "cost_center_id", label: "Centro de custo", type: "select", options: withEmpty(lookups.costCenters.map((item) => ({ value: item.id, label: item.name }))) },
            { key: "bank_account_id", label: "Conta bancária prevista", type: "select", options: withEmpty(lookups.bankAccounts.map((item) => ({ value: item.id, label: item.name }))) },
            { key: "active", label: "Ativa", type: "select", options: YES_NO },
            { key: "notes", label: "Observações", type: "textarea" },
          ]}
          values={form.values}
          onChange={(key, value) =>
            setForm((current) => current && { ...current, values: { ...current.values, [key]: value, ...(key === "kind" && value !== current.values.kind ? { party_id: "", category_id: "" } : {}) } })
          }
          onClose={() => setForm(null)}
          onSubmit={() => save.mutate()}
          busy={save.isPending}
        >
          <p className="mt-4 text-sm text-muted-foreground">
            {form.values.frequency === "semanal"
              ? "Semanal: uma conta a cada 7 dias a partir do início."
              : "O primeiro lançamento sai no mês atual (ou no início, se for depois); meses anteriores não são gerados."}
          </p>
          <ErrorNote message={save.error ? errorMessage(save.error) : null} />
        </CrudDialog>
      )}
    </div>
  );
}
