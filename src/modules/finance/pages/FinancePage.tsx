// Contas a pagar e a receber: lista editável na própria tabela (Editar / Adicionar / Atualizar), visão de calendário
// dos vencimentos, baixa total ou parcial, estorno, aprovação, cancelamento e exclusão na ficha aberta abaixo da
// lista. As regras ficam em lib/erp (settlements, financeSetup, recurring); a tela só chama e mostra.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, FileText, HandCoins, Trash2, Undo2 } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { displayStatus, isOverdue, isTrue, loadPayables, loadReceivables, SETTLED_STATUS, toEntry, type EntryKind, type FinanceEntry } from "@/lib/erp/financeCommon";
import { runRecurring } from "@/lib/erp/recurring";
import { approvePayable, cancelEntry, deleteEntry, listSettlements, reverseSettlement, settlementCash } from "@/lib/erp/settlements";
import { useLabel } from "@/lib/labels/useLabel";
import { sumMoney } from "@/lib/money";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { CalendarView, type CalendarItem } from "@/components/shared/CalendarView";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { FileAttachments } from "@/components/shared/FileAttachments";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatusBadge, statusLabel } from "@/components/shared/StatusBadge";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import type { Payable, Receivable, RecurringKind } from "@/types";
import { ENTRY_RESOURCE, entryRow, saveEntryChanges, type EntryRow } from "../data/entryEditing";
import { useEditContext } from "../data/useEditContext";
import { InfoGrid, InfoItem, InlinePanel, ViewToggle, type ListOrCalendar } from "../components/inline";
import { SettleForm } from "../components/SettleForm";
import {
  ConfirmButton,
  ErrorNote,
  PAYMENT_METHODS,
  SuccessNote,
  categoryLabel,
  categoryTree,
  errorMessage,
  inputClass,
  invalidateFinance,
  paymentMethodLabel,
  primaryButton,
  secondaryButton,
  useFinanceLookups,
  type FinanceLookups,
} from "../components/financeShared";

type Tab = "receivables" | "payables";
type StatusFilter = "abertas" | "vencidas" | "quitadas" | "canceladas" | "todas";

const TABS = [
  { id: "receivables", label: "A receber" },
  { id: "payables", label: "A pagar" },
] as const;
const KIND: Record<Tab, EntryKind> = { receivables: "receivable", payables: "payable" };
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "abertas", label: "Em aberto" },
  { value: "vencidas", label: "Vencidas" },
  { value: "quitadas", label: "Quitadas" },
  { value: "canceladas", label: "Canceladas" },
  { value: "todas", label: "Todas" },
];
const ORIGIN_LABELS: Record<string, string> = {
  Manual: "Lançamento manual",
  recurring_entry: "Recorrência",
  invoice: "Fatura",
  purchase_order: "Pedido de compra",
  goods_receipt: "Recebimento de mercadoria",
  sales_order: "Pedido de venda",
  payroll: "Folha de pagamento",
};

/** Recorrências geradas uma vez por sessão (por empresa, tipos e mês), ao abrir o financeiro. */
const recurringRunKeys = new Set<string>();

function matchesStatus(entry: FinanceEntry, filter: StatusFilter, today: string): boolean {
  if (filter === "abertas") return entry.remaining > 0 && entry.status !== "cancelada";
  if (filter === "vencidas") return isOverdue(entry, today) && entry.status !== "cancelada";
  if (filter === "quitadas") return entry.status === SETTLED_STATUS[entry.kind];
  if (filter === "canceladas") return entry.status === "cancelada";
  return true;
}

const byDueDate = (a: FinanceEntry, b: FinanceEntry) =>
  (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99") || a.description.localeCompare(b.description, "pt-BR");

/** Contas que passam na situação e na busca (descrição, cliente/fornecedor, categoria ou documento), por vencimento. */
function filterEntries(entries: FinanceEntry[], statusFilter: StatusFilter, term: string, lookups: FinanceLookups, today: string): FinanceEntry[] {
  return entries
    .filter((entry) => matchesStatus(entry, statusFilter, today))
    .filter(
      (entry) =>
        !term ||
        [entry.description, lookups.partyName(entry.kind, entry.partyId), lookups.categoryName(entry.categoryId), entry.raw.document_number ?? ""].some((value) =>
          value.toLocaleLowerCase("pt-BR").includes(term),
        ),
    )
    .sort(byDueDate);
}

function totals(entries: FinanceEntry[], today: string) {
  const open = entries.filter((entry) => entry.remaining > 0);
  const overdue = open.filter((entry) => isOverdue(entry, today));
  return { open: sumMoney(open.map((entry) => entry.remaining)), overdue: sumMoney(overdue.map((entry) => entry.remaining)), overdueCount: overdue.length };
}

const options = (rows: readonly { id: string; name: string }[]) => rows.map((row) => ({ value: row.id, label: row.name }));

/** Categorias do tipo (receita/despesa) em árvore; as inativas continuam na lista, marcadas, para não sumir da conta. */
function categorySelect(lookups: FinanceLookups, kind: EntryKind) {
  const wanted = kind === "payable" ? "despesa" : "receita";
  return categoryTree(lookups.categories)
    .filter(({ category }) => category.kind === wanted)
    .map(({ category, depth }) => ({ value: category.id, label: `${"  ".repeat(depth)}${categoryLabel(category)}${isTrue(category.active) ? "" : " (inativa)"}` }));
}

function entryColumns(kind: EntryKind, lookups: FinanceLookups, byId: Map<string, FinanceEntry>, today: string): EditableColumn<EntryRow>[] {
  const payable = kind === "payable";
  return [
    { key: "description", header: "Descrição", kind: "text", required: true, width: 220 },
    { key: "party_id", header: payable ? "Fornecedor" : "Cliente", kind: "select", options: options(payable ? lookups.suppliers : lookups.customers), render: (row) => lookups.partyName(kind, row.party_id) },
    { key: "category_id", header: "Categoria", kind: "select", options: categorySelect(lookups, kind), render: (row) => lookups.categoryName(row.category_id) },
    { key: "cost_center_id", header: "Centro de custo", kind: "select", options: options(lookups.costCenters), render: (row) => lookups.costCenterName(row.cost_center_id) },
    {
      key: "due_date",
      header: "Vencimento",
      kind: "date",
      render: (row) => {
        const entry = byId.get(row.id);
        return <span className={cn("whitespace-nowrap", entry && isOverdue(entry, today) && "font-medium text-destructive")}>{formatDay(row.due_date)}</span>;
      },
    },
    { key: "amount", header: "Valor", kind: "money", required: true },
    { key: "paid", header: payable ? "Pago" : "Recebido", kind: "money", readOnly: true },
    { key: "remaining", header: "Saldo", kind: "money", readOnly: true },
    { key: "status", header: "Status", kind: "select", readOnly: true, sortValue: (row) => statusLabel(row.status), render: (row) => <StatusBadge status={row.status} /> },
    { key: "document_number", header: "Documento", kind: "text" },
    { key: "payment_method", header: "Forma de pagamento", kind: "select", options: PAYMENT_METHODS },
    { key: "bank_account_id", header: "Conta prevista", kind: "select", options: options(lookups.bankAccounts), render: (row) => lookups.bankAccountName(row.bank_account_id) },
    { key: "competence", header: "Competência", kind: "text", placeholder: "AAAA-MM" },
    { key: "issue_date", header: "Emissão", kind: "date" },
    {
      key: "installments",
      header: "Parcelas",
      kind: "number",
      placeholder: "1",
      // O campo da linha é só para gerar parcelas na conta nova; a tela mostra n/total: ordena e filtra pelo n.
      sortValue: (row) => {
        const raw = byId.get(row.id)?.raw;
        return raw?.installment_count ? raw.installment_number : null;
      },
      render: (row) => {
        const raw = byId.get(row.id)?.raw;
        return raw?.installment_count ? `${raw.installment_number}/${raw.installment_count}` : <span className="text-muted-foreground">—</span>;
      },
    },
    { key: "notes", header: "Observações", kind: "text", width: 200 },
  ];
}

export default function FinancePage() {
  const ctx = useEditContext();
  const companyId = ctx.companyId;
  const qc = useQueryClient();
  const today = todayIso();
  const title = useLabel("module.finance");
  const lookups = useFinanceLookups(companyId);
  const [tab, setTab] = useState<Tab>("receivables");
  const [view, setView] = useState<ListOrCalendar>("lista");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("abertas");
  const [month, setMonth] = useState("");
  const [selected, setSelected] = useState<{ id: string; settle: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const permissions = {
    payables: { create: usePermission("create", "payables"), edit: usePermission("edit", "payables"), remove: usePermission("delete", "payables"), approve: usePermission("approve", "payables") },
    receivables: { create: usePermission("create", "receivables"), edit: usePermission("edit", "receivables"), remove: usePermission("delete", "receivables"), approve: false },
  };
  const can = permissions[tab];

  const payablesQuery = useQuery({ queryKey: ["payables", companyId], queryFn: async () => loadPayables(await getDb(), companyId) });
  const receivablesQuery = useQuery({ queryKey: ["receivables", companyId], queryFn: async () => loadReceivables(await getDb(), companyId) });
  const payableEntries = useMemo(() => (payablesQuery.data ?? []).map((row: Payable) => toEntry("payable", row)), [payablesQuery.data]);
  const receivableEntries = useMemo(() => (receivablesQuery.data ?? []).map((row: Receivable) => toEntry("receivable", row)), [receivablesQuery.data]);
  const entries = tab === "payables" ? payableEntries : receivableEntries;
  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);

  // Lançamentos das recorrências do mês: gerados ao abrir o financeiro, só dos tipos que o papel pode criar.
  const createPayables = permissions.payables.create;
  const createReceivables = permissions.receivables.create;
  useEffect(() => {
    const kinds: RecurringKind[] = [...(createPayables ? (["pagar"] as const) : []), ...(createReceivables ? (["receber"] as const) : [])];
    const key = `${companyId}:${kinds.join(",")}:${today.slice(0, 7)}`;
    if (kinds.length === 0 || recurringRunKeys.has(key)) return;
    recurringRunKeys.add(key);
    void (async () => {
      try {
        const result = await runRecurring(await getDb(), companyId, today, { kinds });
        if (result.created > 0) {
          invalidateFinance(qc, companyId);
          setNotice(result.created === 1 ? "1 lançamento recorrente foi gerado para este mês." : `${result.created} lançamentos recorrentes foram gerados para este mês.`);
        }
      } catch {
        // Falha aqui não impede a tela; a página Recorrências mostra o erro ao gerar manualmente.
      }
    })();
  }, [companyId, today, createPayables, createReceivables, qc]);

  const pay = totals(payableEntries, today);
  const rec = totals(receivableEntries, today);

  const term = search.trim().toLocaleLowerCase("pt-BR");
  const filtered = filterEntries(entries, statusFilter, term, lookups, today);
  const selectedEntry = selected ? (byId.get(selected.id) ?? null) : null;
  const partyLabel = tab === "payables" ? "Fornecedor" : "Cliente";

  const calendarItems: CalendarItem[] = filtered
    .filter((entry) => entry.dueDate && entry.status !== "cancelada")
    .map((entry) => ({
      id: entry.id,
      title: `${entry.description} · ${formatCurrency(entry.remaining > 0 ? entry.remaining : entry.amount)}`,
      start: entry.dueDate!,
      allDay: true,
      color: isOverdue(entry, today) ? "hsl(var(--destructive))" : entry.remaining === 0 ? "hsl(var(--muted-foreground))" : undefined,
      sourceLabel: tab === "payables" ? "A pagar" : "A receber",
    }));
  const withoutDueDate = filtered.filter((entry) => !entry.dueDate && entry.status !== "cancelada").length;

  // Cada aba grava no próprio tipo (a tabela de uma aba nunca recebe o rascunho da outra).
  async function save(entryKind: EntryKind, changes: EditableTableChanges<EntryRow>) {
    const saved = await saveEntryChanges(await getDb(), ctx, entryKind, changes);
    invalidateFinance(qc, companyId);
    if (saved.created.length > 1) setNotice(`${saved.created.length} contas criadas.`);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={title} actions={<ImportExportButtons entity={tab} onImported={() => invalidateFinance(qc, companyId)} />} />

      {notice && <SuccessNote onClose={() => setNotice(null)}>{notice}</SuccessNote>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="A receber" value={formatCurrency(rec.open)} />
        <KpiCard title="A pagar" value={formatCurrency(pay.open)} />
        <KpiCard title="Vencidas" value={String(rec.overdueCount + pay.overdueCount)} />
        <KpiCard title="Saldo projetado" value={formatCurrency(rec.open - pay.open)} />
      </div>

      <div>
        <TabList tabs={TABS} value={tab} onChange={(next) => { setTab(next); setSelected(null); }} label="Tipo de conta" idPrefix="financeiro" />
      </div>

      <TabPanel idPrefix="financeiro" id={tab}>
        <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder={`Buscar descrição, ${partyLabel.toLowerCase()} ou documento`}>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Situação
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className={inputClass}>
              {STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {view === "lista" && (
            <>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Vencimento em
                <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className={inputClass} />
              </label>
              {month && <button type="button" onClick={() => setMonth("")} className={secondaryButton}>Todos os meses</button>}
            </>
          )}
          <ViewToggle value={view} onChange={setView} />
        </PageToolbar>

        {TABS.map(({ id }) => (
          <EntryList
            key={id}
            hidden={id !== tab || view !== "lista"}
            kind={KIND[id]}
            entries={id === "payables" ? payableEntries : receivableEntries}
            loading={(id === "payables" ? payablesQuery : receivablesQuery).isLoading}
            lookups={lookups}
            today={today}
            statusFilter={statusFilter}
            term={term}
            month={month}
            can={permissions[id]}
            onSave={(changes) => save(KIND[id], changes)}
            onRefresh={() => qc.invalidateQueries({ queryKey: [ENTRY_RESOURCE[KIND[id]], companyId] })}
            onSelect={(entryId, settle) => setSelected({ id: entryId, settle })}
          />
        ))}
        {view === "calendario" && (
          <div className="space-y-2">
            <CalendarView items={calendarItems} date={month ? `${month}-01` : undefined} label={tab === "payables" ? "Vencimentos a pagar" : "Vencimentos a receber"} onSelect={(item) => setSelected({ id: item.id, settle: false })} />
            {withoutDueDate > 0 && (
              <p className="px-1 text-sm text-muted-foreground">
                {withoutDueDate === 1 ? "1 conta sem vencimento não aparece no calendário (veja na Lista)." : `${withoutDueDate} contas sem vencimento não aparecem no calendário (veja na Lista).`}
              </p>
            )}
          </div>
        )}
      </TabPanel>

      {selectedEntry && (
        <EntryPanel
          key={selectedEntry.id}
          entry={selectedEntry}
          lookups={lookups}
          permissions={can}
          today={today}
          settleOpen={selected?.settle ?? false}
          onSettleOpen={(open) => setSelected({ id: selectedEntry.id, settle: open })}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

interface EntryListProps {
  kind: EntryKind;
  hidden: boolean;
  entries: FinanceEntry[];
  loading: boolean;
  lookups: FinanceLookups;
  today: string;
  statusFilter: StatusFilter;
  term: string;
  month: string;
  can: EntryPermissions;
  onSave(changes: EditableTableChanges<EntryRow>): Promise<void>;
  onRefresh(): Promise<unknown>;
  onSelect(id: string, settle: boolean): void;
}

/**
 * Lista editável de um tipo de conta. As duas abas (e a lista enquanto o calendário aparece) ficam montadas e só se
 * escondem: o rascunho de uma aba não vai parar na outra nem se perde em silêncio ao trocar de aba ou de visão.
 */
function EntryList({ kind, hidden, entries, loading, lookups, today, statusFilter, term, month, can, onSave, onRefresh, onSelect }: EntryListProps) {
  const payable = kind === "payable";
  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const listed = filterEntries(entries, statusFilter, term, lookups, today).filter((entry) => !month || (entry.dueDate ?? "").startsWith(month));
  const rows = listed.map((entry) => entryRow(entry, today));
  const columns = useMemo(() => entryColumns(kind, lookups, byId, today), [kind, lookups, byId, today]);

  return (
    <div hidden={hidden} className="space-y-2">
      <EditableTable<EntryRow>
        resource={ENTRY_RESOURCE[kind]}
        label={payable ? "Contas a pagar" : "Contas a receber"}
        rows={rows}
        columns={columns}
        loading={loading}
        newRow={() => ({ bank_account_id: lookups.defaultBankAccountId, due_date: month ? `${month}-10` : null })}
        onSave={onSave}
        onRefresh={onRefresh}
        emptyMessage={statusFilter === "abertas" && !term && !month ? "Nada em aberto. Escolha a situação Todas para ver o histórico." : "Nenhuma conta com esses filtros."}
        rowActions={(row) => {
          const entry = byId.get(row.id);
          if (!entry) return null;
          return (
            <span className="flex justify-end gap-1.5">
              {can.edit && entry.remaining > 0 && entry.status !== "cancelada" && (
                <button type="button" onClick={() => onSelect(entry.id, true)} className={secondaryButton} aria-label={`Baixar ${entry.description}`}>
                  <HandCoins size={14} aria-hidden="true" /> Baixar
                </button>
              )}
              <button type="button" onClick={() => onSelect(entry.id, false)} className={secondaryButton} aria-label={`Ficha de ${entry.description}`}>
                <FileText size={14} aria-hidden="true" /> Ficha
              </button>
            </span>
          );
        }}
      />
      {rows.length > 0 && (
        <p className="px-1 text-sm text-muted-foreground">
          Total ({rows.length}): valor {formatCurrency(sumMoney(listed.map((entry) => entry.amount)))} · {payable ? "pago" : "recebido"}{" "}
          {formatCurrency(sumMoney(listed.map((entry) => entry.paid)))} · saldo <span className="font-medium text-foreground">{formatCurrency(sumMoney(listed.map((entry) => entry.remaining)))}</span>
        </p>
      )}
    </div>
  );
}

interface EntryPermissions {
  create: boolean;
  edit: boolean;
  remove: boolean;
  approve: boolean;
}

type PanelAction = "approve" | "cancel" | "delete" | "reverse";
const ACTION_TITLES: Record<PanelAction, string> = { approve: "Conta aprovada", cancel: "Conta cancelada", delete: "Conta excluída", reverse: "Baixa estornada" };
const ACTION_EVENTS: Record<PanelAction, string> = { approve: "approved", cancel: "cancelled", delete: "deleted", reverse: "reversed" };

/** Ficha da conta, aberta abaixo da lista: baixa, aprovação, cancelamento, exclusão, baixas com estorno e anexos. */
function EntryPanel({ entry, lookups, permissions, today, settleOpen, onSettleOpen, onClose }: {
  entry: FinanceEntry;
  lookups: FinanceLookups;
  permissions: EntryPermissions;
  today: string;
  settleOpen: boolean;
  onSettleOpen: (open: boolean) => void;
  onClose: () => void;
}) {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const payable = entry.kind === "payable";
  const { data: settlements = [] } = useQuery({
    queryKey: ["finance", companyId, "settlements", entry.kind, entry.id],
    queryFn: async () => listSettlements(await getDb(), companyId, entry.kind, entry.id),
  });

  const action = useMutation({
    mutationFn: async (run: { type: PanelAction; settlementId?: string }) => {
      const db = await getDb();
      if (run.type === "approve") await approvePayable(db, companyId, entry.id, session.user.id);
      else if (run.type === "cancel") await cancelEntry(db, companyId, entry.kind, entry.id);
      else if (run.type === "delete") await deleteEntry(db, companyId, entry.kind, entry.id);
      else if (run.settlementId) await reverseSettlement(db, companyId, run.settlementId);
      return run;
    },
    onSuccess: async (run) => {
      invalidateFinance(qc, companyId);
      await emit({ type: `finance.${entry.kind}.${ACTION_EVENTS[run.type]}`, companyId, actorId: session.user.id, entityType: entry.kind, entityId: entry.id, module: "finance", title: `${ACTION_TITLES[run.type]}: ${entry.description}` });
      if (run.type === "delete") onClose();
    },
  });
  const raw = entry.raw;
  const origin = raw.ref_type ? (ORIGIN_LABELS[raw.ref_type] ?? raw.ref_type) : "—";
  const canSettle = permissions.edit && entry.remaining > 0 && entry.status !== "cancelada";
  const canApprove = payable && permissions.approve && ["aberta", "vencida"].includes(entry.status) && entry.paid === 0;
  const canCancel = permissions.edit && entry.status !== "cancelada" && entry.status !== SETTLED_STATUS[entry.kind];

  return (
    <InlinePanel
      title={entry.description}
      subtitle={payable ? "Conta a pagar" : "Conta a receber"}
      onClose={onClose}
      actions={
        <>
          {canSettle && !settleOpen && (
            <button type="button" onClick={() => onSettleOpen(true)} className={primaryButton}>
              <HandCoins size={14} aria-hidden="true" /> {payable ? "Registrar pagamento" : "Registrar recebimento"}
            </button>
          )}
          {canApprove && (
            <button type="button" disabled={action.isPending} onClick={() => action.mutate({ type: "approve" })} className={secondaryButton}>
              <CheckCircle2 size={14} aria-hidden="true" /> Aprovar
            </button>
          )}
          {canCancel && <ConfirmButton label="Cancelar conta" confirmLabel="Confirmar cancelamento" icon={<Ban size={14} aria-hidden="true" />} busy={action.isPending} onConfirm={() => action.mutate({ type: "cancel" })} />}
          {permissions.remove && <ConfirmButton label="Excluir" confirmLabel="Confirmar exclusão" icon={<Trash2 size={14} aria-hidden="true" />} busy={action.isPending} onConfirm={() => action.mutate({ type: "delete" })} />}
        </>
      }
    >
      <ErrorNote message={action.error ? errorMessage(action.error) : null} />
      {canSettle && settleOpen && <SettleForm entry={entry} lookups={lookups} onDone={() => onSettleOpen(false)} onCancel={() => onSettleOpen(false)} />}

      <InfoGrid>
        <InfoItem label="Status" value={<StatusBadge status={displayStatus(entry, today)} />} />
        <InfoItem label="Valor" value={formatCurrency(entry.amount)} />
        <InfoItem label={payable ? "Pago" : "Recebido"} value={formatCurrency(entry.paid)} />
        <InfoItem label="Saldo em aberto" value={formatCurrency(entry.remaining)} />
        <InfoItem label="Vencimento" value={formatDay(entry.dueDate)} />
        <InfoItem label="Parcela" value={raw.installment_count ? `${raw.installment_number}/${raw.installment_count}` : null} />
        <InfoItem label="Origem" value={origin} />
        {payable && <InfoItem label="Aprovação" value={entry.approverId ? "Aprovada" : "Sem aprovação"} />}
      </InfoGrid>
      <p className="text-xs text-muted-foreground">Descrição, valores, datas e cadastros desta conta se editam na própria tabela (botão Editar).</p>

      <section aria-label="Baixas" className="space-y-2">
        <h3 className="text-sm font-semibold">Baixas</h3>
        {settlements.length === 0 ? (
          <p className="text-sm text-muted-foreground">{entry.paid > 0 ? "Quitada antes do registro de baixas (sem detalhes)." : "Nenhuma baixa registrada."}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {settlements.map((settlement) => {
              const charges = Number(settlement.interest) + Number(settlement.fine);
              return (
                <li key={settlement.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium tabular-nums">{formatCurrency(settlementCash(settlement))} em {formatDay(settlement.paid_at)}</p>
                    <p className="text-xs text-muted-foreground">
                      Principal {formatCurrency(Number(settlement.amount))}
                      {charges > 0 && ` · juros e multa ${formatCurrency(charges)}`}
                      {Number(settlement.discount) > 0 && ` · desconto ${formatCurrency(Number(settlement.discount))}`}
                      {settlement.bank_account_id && ` · ${lookups.bankAccountName(settlement.bank_account_id)}`}
                      {settlement.payment_method && ` · ${paymentMethodLabel(settlement.payment_method)}`}
                      {settlement.bank_transaction_id && " · conciliada com o extrato"}
                    </p>
                  </div>
                  {permissions.edit && (
                    <ConfirmButton label="Estornar" confirmLabel="Confirmar estorno" icon={<Undo2 size={14} aria-hidden="true" />} tone="neutral" busy={action.isPending} onConfirm={() => action.mutate({ type: "reverse", settlementId: settlement.id })} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <FileAttachments entityType={entry.kind} entityId={entry.id} canEdit={permissions.edit} />
    </InlinePanel>
  );
}
