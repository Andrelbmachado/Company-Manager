// Contas a pagar e a receber: lista com filtros, baixa total ou parcial, estorno, aprovação, cancelamento e exclusão.
// As regras ficam em lib/erp (settlements, financeSetup, recurring); a tela só chama e mostra.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, CheckCircle2, HandCoins, Plus, Trash2, TrendingDown, TrendingUp, Undo2, Wallet } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { displayStatus, isOverdue, loadPayables, loadReceivables, SETTLED_STATUS, toEntry, type EntryKind, type FinanceEntry } from "@/lib/erp/financeCommon";
import { runRecurring } from "@/lib/erp/recurring";
import { approvePayable, cancelEntry, deleteEntry, listSettlements, reverseSettlement, settlementCash } from "@/lib/erp/settlements";
import { sumMoney } from "@/lib/money";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { DetailDrawer, DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { FileAttachments } from "@/components/shared/FileAttachments";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import type { Payable, Receivable, RecurringKind } from "@/types";
import { EntryFormDialog } from "../components/EntryFormDialog";
import { SettleDialog } from "../components/SettleDialog";
import {
  ConfirmButton,
  ErrorNote,
  SuccessNote,
  errorMessage,
  inputClass,
  invalidateFinance,
  paymentMethodLabel,
  primaryButton,
  secondaryButton,
  td,
  th,
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

function totals(entries: FinanceEntry[], today: string) {
  const open = entries.filter((entry) => entry.remaining > 0);
  const overdue = open.filter((entry) => isOverdue(entry, today));
  return { open: sumMoney(open.map((entry) => entry.remaining)), overdue: sumMoney(overdue.map((entry) => entry.remaining)), overdueCount: overdue.length };
}

export default function FinancePage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const today = todayIso();
  const lookups = useFinanceLookups(companyId);
  const [tab, setTab] = useState<Tab>("receivables");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("abertas");
  const [month, setMonth] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formFor, setFormFor] = useState<{ entry: FinanceEntry | null } | null>(null);
  const [settling, setSettling] = useState<FinanceEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const permissions = {
    payables: { create: usePermission("create", "payables"), edit: usePermission("edit", "payables"), remove: usePermission("delete", "payables"), approve: usePermission("approve", "payables") },
    receivables: { create: usePermission("create", "receivables"), edit: usePermission("edit", "receivables"), remove: usePermission("delete", "receivables"), approve: false },
  };
  const can = permissions[tab];
  const kind = KIND[tab];

  const { data: payables = [] } = useQuery({ queryKey: ["payables", companyId], queryFn: async () => loadPayables(await getDb(), companyId) });
  const { data: receivables = [] } = useQuery({ queryKey: ["receivables", companyId], queryFn: async () => loadReceivables(await getDb(), companyId) });
  const payableEntries = useMemo(() => payables.map((row: Payable) => toEntry("payable", row)), [payables]);
  const receivableEntries = useMemo(() => receivables.map((row: Receivable) => toEntry("receivable", row)), [receivables]);
  const entries = tab === "payables" ? payableEntries : receivableEntries;

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
  const rows = entries
    .filter((entry) => matchesStatus(entry, statusFilter, today))
    .filter((entry) => !month || (entry.dueDate ?? "").startsWith(month))
    .filter(
      (entry) =>
        !term ||
        [entry.description, lookups.partyName(entry.kind, entry.partyId), lookups.categoryName(entry.categoryId), entry.raw.document_number ?? ""].some((value) =>
          value.toLocaleLowerCase("pt-BR").includes(term),
        ),
    )
    .sort(byDueDate);
  const selected = selectedId ? (entries.find((entry) => entry.id === selectedId) ?? null) : null;
  const partyLabel = tab === "payables" ? "Fornecedor" : "Cliente";
  const paidLabel = tab === "payables" ? "Pago" : "Recebido";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financeiro"
        description="Contas a pagar e a receber, com baixa total ou parcial, aprovação e estorno."
        actions={
          <>
            <ImportExportButtons entity={tab} onImported={() => invalidateFinance(qc, companyId)} />
            {can.create && (
              <button type="button" onClick={() => setFormFor({ entry: null })} className={primaryButton}>
                <Plus size={14} aria-hidden="true" /> {tab === "payables" ? "Nova conta a pagar" : "Nova conta a receber"}
              </button>
            )}
          </>
        }
      />

      {notice && <SuccessNote onClose={() => setNotice(null)}>{notice}</SuccessNote>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="A receber" value={formatCurrency(rec.open)} subtitle={rec.overdueCount ? `${rec.overdueCount} vencida(s): ${formatCurrency(rec.overdue)}` : "Nenhuma vencida"} icon={TrendingUp} iconClassName="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" />
        <KpiCard title="A pagar" value={formatCurrency(pay.open)} subtitle={pay.overdueCount ? `${pay.overdueCount} vencida(s): ${formatCurrency(pay.overdue)}` : "Nenhuma vencida"} icon={TrendingDown} iconClassName="bg-red-600/10 text-red-700 dark:text-red-400" />
        <KpiCard title="Vencidas" value={String(rec.overdueCount + pay.overdueCount)} subtitle={`${formatCurrency(rec.overdue)} a receber · ${formatCurrency(pay.overdue)} a pagar`} icon={AlertTriangle} iconClassName="bg-amber-500/10 text-amber-700 dark:text-amber-400" />
        <KpiCard title="Saldo projetado" value={formatCurrency(rec.open - pay.open)} subtitle="A receber menos a pagar (em aberto)" icon={Wallet} />
      </div>

      <div className="border-b">
        <TabList tabs={TABS} value={tab} onChange={(next) => { setTab(next); setSelectedId(null); }} label="Tipo de conta" idPrefix="financeiro" />
      </div>

      <TabPanel idPrefix="financeiro" id={tab}>
        <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder={`Buscar descrição, ${partyLabel.toLowerCase()} ou documento`}>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Situação
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className={inputClass}>
              {STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Vencimento em
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className={inputClass} />
          </label>
          {month && <button type="button" onClick={() => setMonth("")} className={secondaryButton}>Todos os meses</button>}
        </PageToolbar>

        {rows.length === 0 ? (
          <EmptyState icon={Wallet} title="Nenhum lançamento" description={statusFilter === "abertas" && !term && !month ? "Nada em aberto. Escolha a situação Todas para ver o histórico." : "Nenhuma conta com esses filtros."} />
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className={th}>Descrição</th>
                  <th className={th}>{partyLabel}</th>
                  <th className={th}>Categoria</th>
                  <th className={th}>Vencimento</th>
                  <th className={cn(th, "text-right")}>Valor</th>
                  <th className={cn(th, "text-right")}>{paidLabel}</th>
                  <th className={cn(th, "text-right")}>Saldo</th>
                  <th className={th}>Status</th>
                  <th className={th}><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((entry) => (
                  <tr key={entry.id} onClick={() => setSelectedId(entry.id)} className="cursor-pointer hover:bg-muted/20">
                    <td className={td}>
                      <p className="font-medium">{entry.description}</p>
                      {entry.raw.document_number && <p className="text-xs text-muted-foreground">Doc. {entry.raw.document_number}</p>}
                    </td>
                    <td className={td}>{lookups.partyName(entry.kind, entry.partyId)}</td>
                    <td className={td}>{lookups.categoryName(entry.categoryId)}</td>
                    <td className={cn(td, "whitespace-nowrap", isOverdue(entry, today) && "font-medium text-red-700 dark:text-red-400")}>{formatDay(entry.dueDate)}</td>
                    <td className={cn(td, "text-right tabular-nums")}>{formatCurrency(entry.amount)}</td>
                    <td className={cn(td, "text-right tabular-nums")}>{formatCurrency(entry.paid)}</td>
                    <td className={cn(td, "text-right font-medium tabular-nums")}>{formatCurrency(entry.remaining)}</td>
                    <td className={td}><StatusBadge status={displayStatus(entry, today)} /></td>
                    <td className={cn(td, "text-right")}>
                      {can.edit && entry.remaining > 0 && entry.status !== "cancelada" && (
                        <button type="button" onClick={(event) => { event.stopPropagation(); setSettling(entry); }} className={secondaryButton} aria-label={`Baixar ${entry.description}`}>
                          <HandCoins size={14} aria-hidden="true" /> Baixar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/20 font-medium">
                <tr>
                  <td className={td} colSpan={4}>Total ({rows.length})</td>
                  <td className={cn(td, "text-right tabular-nums")}>{formatCurrency(sumMoney(rows.map((entry) => entry.amount)))}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{formatCurrency(sumMoney(rows.map((entry) => entry.paid)))}</td>
                  <td className={cn(td, "text-right tabular-nums")}>{formatCurrency(sumMoney(rows.map((entry) => entry.remaining)))}</td>
                  <td className={td} colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </TabPanel>

      {selected && (
        <EntryDrawer
          entry={selected}
          lookups={lookups}
          permissions={can}
          today={today}
          onClose={() => setSelectedId(null)}
          onEdit={() => setFormFor({ entry: selected })}
          onSettle={() => setSettling(selected)}
        />
      )}
      {formFor && <EntryFormDialog kind={kind} entry={formFor.entry} lookups={lookups} onClose={() => setFormFor(null)} />}
      {settling && <SettleDialog entry={settling} lookups={lookups} onClose={() => setSettling(null)} />}
    </div>
  );
}

interface EntryPermissions {
  create: boolean;
  edit: boolean;
  remove: boolean;
  approve: boolean;
}

type DrawerAction = "approve" | "cancel" | "delete" | "reverse";
const ACTION_TITLES: Record<DrawerAction, string> = { approve: "Conta aprovada", cancel: "Conta cancelada", delete: "Conta excluída", reverse: "Baixa estornada" };
const ACTION_EVENTS: Record<DrawerAction, string> = { approve: "approved", cancel: "cancelled", delete: "deleted", reverse: "reversed" };

function EntryDrawer({ entry, lookups, permissions, today, onClose, onEdit, onSettle }: {
  entry: FinanceEntry;
  lookups: FinanceLookups;
  permissions: EntryPermissions;
  today: string;
  onClose: () => void;
  onEdit: () => void;
  onSettle: () => void;
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
    mutationFn: async (run: { type: DrawerAction; settlementId?: string }) => {
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
  const canApprove = payable && permissions.approve && ["aberta", "vencida"].includes(entry.status) && entry.paid === 0;
  const canCancel = permissions.edit && entry.status !== "cancelada" && entry.status !== SETTLED_STATUS[entry.kind];

  return (
    <DetailDrawer title={entry.description} subtitle={payable ? "Conta a pagar" : "Conta a receber"} onClose={onClose} onEdit={permissions.edit && entry.status !== "cancelada" ? onEdit : undefined}>
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {permissions.edit && entry.remaining > 0 && entry.status !== "cancelada" && (
            <button type="button" onClick={onSettle} className={primaryButton}>
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
        </div>
        <ErrorNote message={action.error ? errorMessage(action.error) : null} />

        <DetailGrid>
          <DetailItem label="Status" value={<StatusBadge status={displayStatus(entry, today)} />} />
          <DetailItem label="Valor" value={formatCurrency(entry.amount)} />
          <DetailItem label={payable ? "Pago" : "Recebido"} value={formatCurrency(entry.paid)} />
          <DetailItem label="Saldo em aberto" value={formatCurrency(entry.remaining)} />
          <DetailItem label="Vencimento" value={formatDay(entry.dueDate)} />
          <DetailItem label="Competência" value={raw.competence ? `${raw.competence.slice(5, 7)}/${raw.competence.slice(0, 4)}` : null} />
          <DetailItem label={payable ? "Fornecedor" : "Cliente"} value={entry.partyId ? lookups.partyName(entry.kind, entry.partyId) : null} />
          <DetailItem label="Categoria" value={entry.categoryId ? lookups.categoryName(entry.categoryId) : null} />
          <DetailItem label="Centro de custo" value={entry.costCenterId ? lookups.costCenterName(entry.costCenterId) : null} />
          <DetailItem label="Conta bancária prevista" value={entry.bankAccountId ? lookups.bankAccountName(entry.bankAccountId) : null} />
          <DetailItem label="Documento" value={raw.document_number} />
          <DetailItem label="Forma de pagamento" value={raw.payment_method ? paymentMethodLabel(raw.payment_method) : null} />
          <DetailItem label="Emissão" value={raw.issue_date ? formatDay(raw.issue_date) : null} />
          <DetailItem label="Parcela" value={raw.installment_count ? `${raw.installment_number}/${raw.installment_count}` : null} />
          <DetailItem label="Origem" value={origin} />
          {payable && <DetailItem label="Aprovação" value={entry.approverId ? "Aprovada" : "Sem aprovação"} />}
        </DetailGrid>
        {raw.notes && <p className="whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm">{raw.notes}</p>}

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
      </div>
    </DetailDrawer>
  );
}
