// Lançamentos recorrentes (aluguel, assinaturas, contratos): cadastro editável na própria tabela, próximo lançamento,
// pausa e geração das contas do mês sem duplicar. Regras em lib/erp/recurring e lib/erp/financeSetup.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Trash2 } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { isTrue } from "@/lib/erp/financeCommon";
import { deleteRecurring, RECURRING_FREQUENCIES, setRecurringActive } from "@/lib/erp/financeSetup";
import { FREQUENCY_LABELS, nextOccurrence, runRecurring } from "@/lib/erp/recurring";
import { roundMoney, sumMoney } from "@/lib/money";
import { formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { usePermission } from "@/hooks/usePermission";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import type { RecurringEntry, RecurringFrequency, RecurringKind } from "@/types";
import { partyKey, recurringRow, saveRecurringChanges, type RecurringRow } from "../data/recurringEditing";
import { useEditContext } from "../data/useEditContext";
import { ConfirmButton, ErrorNote, SuccessNote, categoryLabel, categoryTree, errorMessage, invalidateFinance, secondaryButton, useFinanceLookups, type FinanceLookups } from "../components/financeShared";

/** Quantas vezes por mês, para o total mensal equivalente. */
const PER_MONTH: Record<RecurringFrequency, number> = { semanal: 52 / 12, mensal: 1, bimestral: 1 / 2, trimestral: 1 / 3, semestral: 1 / 6, anual: 1 / 12 };
const KIND_OPTIONS: { value: RecurringKind; label: string }[] = [
  { value: "pagar", label: "A pagar" },
  { value: "receber", label: "A receber" },
];
const FREQUENCY_OPTIONS = RECURRING_FREQUENCIES.map((frequency) => ({ value: frequency, label: FREQUENCY_LABELS[frequency] }));

function recurringColumns(lookups: FinanceLookups): EditableColumn<RecurringRow>[] {
  const parties = [
    ...lookups.suppliers.map((supplier) => ({ value: partyKey("pagar", supplier.id), label: `Fornecedor · ${supplier.name}` })),
    ...lookups.customers.map((customer) => ({ value: partyKey("receber", customer.id), label: `Cliente · ${customer.name}` })),
  ];
  const categories = categoryTree(lookups.categories).map(({ category, depth }) => ({
    value: category.id,
    label: `${"  ".repeat(depth)}${categoryLabel(category)} (${category.kind === "receita" ? "receita" : "despesa"})${isTrue(category.active) ? "" : " (inativa)"}`,
  }));
  const named = (rows: readonly { id: string; name: string }[]) => rows.map((row) => ({ value: row.id, label: row.name }));
  return [
    { key: "description", header: "Descrição", kind: "text", required: true, placeholder: "Ex.: Aluguel do escritório", width: 220 },
    { key: "kind", header: "Tipo", kind: "select", options: KIND_OPTIONS },
    { key: "amount", header: "Valor", kind: "money", required: true },
    { key: "frequency", header: "Frequência", kind: "select", options: FREQUENCY_OPTIONS },
    { key: "day_of_month", header: "Dia do vencimento", kind: "number", placeholder: "Dia do início" },
    { key: "start_date", header: "Início", kind: "date", required: true },
    { key: "end_date", header: "Fim", kind: "date" },
    { key: "party", header: "Fornecedor / cliente", kind: "select", options: parties, render: (row) => (row.party ? row.party.split(":")[0] === "fornecedor" ? lookups.partyName("payable", row.party.split(":")[1]) : lookups.partyName("receivable", row.party.split(":")[1]) : <span className="text-muted-foreground">—</span>) },
    { key: "category_id", header: "Categoria", kind: "select", options: categories, render: (row) => lookups.categoryName(row.category_id) },
    { key: "cost_center_id", header: "Centro de custo", kind: "select", options: named(lookups.costCenters), render: (row) => lookups.costCenterName(row.cost_center_id) },
    { key: "bank_account_id", header: "Conta prevista", kind: "select", options: named(lookups.bankAccounts), render: (row) => lookups.bankAccountName(row.bank_account_id) },
    { key: "active", header: "Ativa", kind: "bool" },
    { key: "next", header: "Próximo", kind: "text", readOnly: true },
    { key: "last", header: "Último gerado", kind: "text", readOnly: true },
    { key: "notes", header: "Observações", kind: "text", width: 200 },
  ];
}

export default function RecurringEntriesPage() {
  const ctx = useEditContext();
  const companyId = ctx.companyId;
  const qc = useQueryClient();
  const today = todayIso();
  const lookups = useFinanceLookups(companyId);
  const canEdit = usePermission("edit", "finance");
  const canDelete = usePermission("delete", "finance");
  const createPayables = usePermission("create", "payables");
  const createReceivables = usePermission("create", "receivables");
  const [notice, setNotice] = useState<string | null>(null);

  const { data: entries = [], isLoading } = useQuery({
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
  const columns = useMemo(() => recurringColumns(lookups), [lookups]);
  const rows = entries.map((entry) => recurringRow(entry, today));

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
        await emit({ type: "finance.recurring.generated", companyId, actorId: ctx.userId, entityType: "recurring_entry", entityId: companyId, module: "finance", title: `${result.created} lançamento(s) recorrente(s) gerado(s)` });
      }
    },
  });

  async function save(changes: EditableTableChanges<RecurringRow>) {
    await saveRecurringChanges(await getDb(), ctx, changes, today);
    invalidateFinance(qc, companyId);
  }

  const update = useMutation({
    mutationFn: async (run: { type: "toggle" | "delete"; row: RecurringRow }) => {
      const db = await getDb();
      if (run.type === "toggle") await setRecurringActive(db, companyId, run.row.id, !run.row.active);
      else await deleteRecurring(db, companyId, run.row.id);
    },
    onSuccess: () => invalidateFinance(qc, companyId),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lançamentos recorrentes"
        actions={
          kinds.length > 0 && (
            <button type="button" disabled={generate.isPending} onClick={() => generate.mutate()} className={secondaryButton}>
              <Play size={14} aria-hidden="true" /> Gerar lançamentos do mês
            </button>
          )
        }
      />

      {notice && <SuccessNote onClose={() => setNotice(null)}>{notice}</SuccessNote>}
      <ErrorNote message={generate.error ? errorMessage(generate.error) : update.error ? errorMessage(update.error) : null} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Ativas" value={String(active.length)} />
        <KpiCard title="A pagar por mês" value={formatCurrency(monthly("pagar"))} />
        <KpiCard title="A receber por mês" value={formatCurrency(monthly("receber"))} />
        <KpiCard title="Próximo lançamento" value={upcoming ? formatDay(upcoming.next.dueDate) : "—"} />
      </div>

      <EditableTable<RecurringRow>
        resource="finance"
        label="Lançamentos recorrentes"
        rows={rows}
        columns={columns}
        loading={isLoading}
        newRow={() => ({ kind: "pagar", frequency: "mensal", start_date: today, active: 1 })}
        onSave={save}
        onRefresh={() => qc.invalidateQueries({ queryKey: ["recurring_entries", companyId] })}
        emptyMessage="Nenhuma recorrência"
        rowActions={(row) => (
          <span className="flex justify-end gap-1.5">
            {canEdit && (
              <button type="button" disabled={update.isPending} onClick={() => update.mutate({ type: "toggle", row })} className={secondaryButton} aria-label={`${row.active ? "Pausar" : "Retomar"} ${row.description}`}>
                {row.active ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />} {row.active ? "Pausar" : "Retomar"}
              </button>
            )}
            {canDelete && (
              <ConfirmButton label="" ariaLabel={`Excluir ${row.description}`} confirmLabel="Confirmar exclusão" icon={<Trash2 size={15} aria-hidden="true" />} busy={update.isPending} onConfirm={() => update.mutate({ type: "delete", row })} />
            )}
          </span>
        )}
      />
    </div>
  );
}
