// Conciliação bancária: importa o extrato (OFX ou CSV) sem duplicar, concilia sozinho o que tem um único candidato
// exato e deixa o resto para casar com uma conta, categorizar (tarifa, rendimento) ou ignorar, na ficha aberta abaixo
// da lista. Lançamento manual entra pela própria tabela (Adicionar). Regras em lib/erp/reconcile.
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Ban, FileUp, Link2, ListChecks, Tags, Undo2 } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { accountBalances } from "@/lib/erp/cashflow";
import { loadPayables, loadReceivables, toEntry } from "@/lib/erp/financeCommon";
import {
  categorizeTransaction,
  decodeStatementBytes,
  ignoreTransaction,
  matchTransaction,
  parseStatementFile,
  reconcile,
  suggestMatches,
  undoTransaction,
  type MatchTarget,
  type ReconcileResult,
} from "@/lib/erp/reconcile";
import { formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { usePermission } from "@/hooks/usePermission";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import type { BankTransaction, BankTransactionStatus } from "@/types";
import { saveTransactionChanges, transactionRow, type TransactionRow } from "../data/transactionEditing";
import { useEditContext } from "../data/useEditContext";
import { InfoGrid, InfoItem, InlinePanel } from "../components/inline";
import {
  ConfirmButton,
  ErrorNote,
  Field,
  Money,
  SuccessNote,
  categoryOptions,
  errorMessage,
  inputClass,
  invalidateFinance,
  primaryButton,
  secondaryButton,
  useFinanceLookups,
  type FinanceLookups,
} from "../components/financeShared";

const TABS: { id: BankTransactionStatus; label: string }[] = [
  { id: "pendente", label: "Pendentes" },
  { id: "conciliada", label: "Conciliados" },
  { id: "ignorada", label: "Ignorados" },
];

function readBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("Não foi possível ler o arquivo."));
    reader.readAsArrayBuffer(file);
  });
}

interface ImportSummary {
  fileName: string;
  result: ReconcileResult;
  balance: number | null;
  balanceDate: string | null;
}

function transactionColumns(tab: BankTransactionStatus): EditableColumn<TransactionRow>[] {
  return [
    { key: "posted_at", header: "Data", kind: "date", required: true, width: 120 },
    { key: "description", header: "Descrição", kind: "text", required: true, width: 260 },
    { key: "amount", header: "Valor", kind: "money", required: true, placeholder: "-0,00 para saída", render: (row) => <Money value={row.amount} signed className="font-medium" /> },
    { key: "memo", header: "Observação", kind: "text", width: 200 },
    ...(tab === "conciliada" ? [{ key: "linked", header: "Ligado a", kind: "text", readOnly: true } as EditableColumn<TransactionRow>] : []),
    { key: "origin", header: "Origem", kind: "text", readOnly: true },
  ];
}

export default function ReconciliationPage() {
  const ctx = useEditContext();
  const companyId = ctx.companyId;
  const qc = useQueryClient();
  const today = todayIso();
  const [params] = useSearchParams();
  const lookups = useFinanceLookups(companyId);
  const canCreate = usePermission("create", "bank");
  const canEdit = usePermission("edit", "bank");
  const [chosenAccount, setChosenAccount] = useState<string | null>(null);
  const [tab, setTab] = useState<BankTransactionStatus>("pendente");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Só vale conta da empresa: id do link que não está na lista (outra empresa, excluída) não libera nada.
  const requestedAccount = chosenAccount ?? params.get("conta") ?? lookups.defaultBankAccountId ?? "";
  const account = lookups.bankAccounts.find((item) => item.id === requestedAccount) ?? null;
  const accountId = account?.id ?? "";

  const transactionsQuery = useQuery({
    queryKey: ["finance", companyId, "bank-transactions", accountId],
    enabled: Boolean(accountId),
    queryFn: async () =>
      (await getDb()).select<BankTransaction[]>("SELECT * FROM bank_transactions WHERE company_id=? AND bank_account_id=? AND deleted_at IS NULL ORDER BY posted_at DESC", [companyId, accountId]),
  });
  const transactions = useMemo(() => transactionsQuery.data ?? [], [transactionsQuery.data]);
  const { data: payables = [] } = useQuery({ queryKey: ["payables", companyId], queryFn: async () => loadPayables(await getDb(), companyId) });
  const { data: receivables = [] } = useQuery({ queryKey: ["receivables", companyId], queryFn: async () => loadReceivables(await getDb(), companyId) });
  const { data: balance } = useQuery({
    queryKey: ["bank_accounts", companyId, "balances", today],
    queryFn: async () => accountBalances(await getDb(), companyId, today),
    select: (items) => items.find((item) => item.accountId === accountId),
  });

  const linkedName = (transaction: BankTransaction) => {
    if (transaction.payable_id) {
      const row = payables.find((item) => item.id === transaction.payable_id);
      return row ? `Conta a pagar: ${toEntry("payable", row).description}` : "Conta a pagar";
    }
    if (transaction.receivable_id) {
      const row = receivables.find((item) => item.id === transaction.receivable_id);
      return row ? `Conta a receber: ${toEntry("receivable", row).description}` : "Conta a receber";
    }
    if (transaction.category_id) return `Categoria: ${lookups.categoryName(transaction.category_id)}`;
    return "—";
  };

  const byStatus = (status: BankTransactionStatus) => transactions.filter((item) => item.status === status);
  const pending = byStatus("pendente");
  const rows = byStatus(tab).map((transaction) => transactionRow(transaction, linkedName(transaction)));
  const columns = useMemo(() => transactionColumns(tab), [tab]);
  const selected = selectedId ? (transactions.find((item) => item.id === selectedId && item.status === "pendente") ?? null) : null;

  const importFile = useMutation({
    mutationFn: async (file: File) => {
      if (!accountId) throw new Error("Escolha a conta bancária do extrato.");
      const parsed = parseStatementFile(decodeStatementBytes(await readBytes(file)));
      if (parsed.transactions.length === 0) throw new Error("Nenhum lançamento encontrado no arquivo.");
      const result = await reconcile(await getDb(), accountId, parsed.transactions, { companyId, userId: ctx.userId, source: parsed.source });
      return { fileName: file.name, result, balance: parsed.balance, balanceDate: parsed.balanceDate };
    },
    onSuccess: async (imported) => {
      invalidateFinance(qc, companyId);
      setSummary(imported);
      setTab("pendente");
      await emit({ type: "finance.statement.imported", companyId, actorId: ctx.userId, entityType: "bank_account", entityId: accountId, module: "finance", title: `Extrato importado (${imported.fileName}): ${imported.result.imported} lançamento(s), ${imported.result.matched} conciliado(s)` });
    },
  });
  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) importFile.mutate(file);
  };

  const undo = useMutation({
    mutationFn: async (id: string) => undoTransaction(await getDb(), companyId, id),
    onSuccess: () => invalidateFinance(qc, companyId),
  });

  async function save(changes: EditableTableChanges<TransactionRow>) {
    if (!accountId) throw new Error("Escolha a conta bancária.");
    await saveTransactionChanges(await getDb(), ctx, accountId, changes);
    invalidateFinance(qc, companyId);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conciliação bancária"
        actions={
          canCreate && (
            <>
              <button type="button" disabled={!accountId || importFile.isPending} onClick={() => fileInput.current?.click()} className={primaryButton}>
                <FileUp size={14} aria-hidden="true" /> {importFile.isPending ? "Importando…" : "Importar extrato"}
              </button>
              <input ref={fileInput} type="file" accept=".ofx,.qfx,.csv,.txt" className="hidden" aria-label="Arquivo do extrato (OFX ou CSV)" onChange={onFile} />
            </>
          )
        }
      />

      <div className="flex flex-wrap items-end gap-3 border-b pb-4">
        <Field label="Conta bancária">
          <select value={accountId} onChange={(event) => { setChosenAccount(event.target.value); setSelectedId(null); setSummary(null); }} className={inputClass}>
            {!accountId && <option value="">Escolha a conta</option>}
            {lookups.bankAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
      </div>

      {summary && (
        <SuccessNote onClose={() => setSummary(null)}>
          {summary.fileName}: {summary.result.imported} lançamento(s) importado(s), {summary.result.matched} conciliado(s) automaticamente, {summary.result.pending} pendente(s)
          {summary.result.duplicates > 0 && `, ${summary.result.duplicates} já importado(s) antes`}
          {summary.result.invalid > 0 && `, ${summary.result.invalid} linha(s) sem data ou valor`}.
          {summary.balance != null && ` Saldo do extrato: ${formatCurrency(summary.balance)}${summary.balanceDate ? ` em ${formatDay(summary.balanceDate)}` : ""}.`}
        </SuccessNote>
      )}
      <ErrorNote message={importFile.error ? errorMessage(importFile.error) : null} />
      <ErrorNote message={undo.error ? errorMessage(undo.error) : null} />

      {lookups.bankAccounts.length === 0 ? (
        <EmptyState icon={ListChecks} title="Nenhuma conta bancária" />
      ) : !account ? (
        <EmptyState icon={ListChecks} title="Escolha a conta bancária" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard title="Pendentes" value={String(pending.length)} />
            <KpiCard title="Saldo no sistema" value={formatCurrency(balance?.balance ?? 0)} />
            <KpiCard title="Saldo do extrato" value={balance?.statementBalance != null ? formatCurrency(balance.statementBalance) : "—"} />
          </div>

          <div>
            <TabList
              tabs={TABS.map((item) => ({ id: item.id, label: `${item.label} (${byStatus(item.id).length})` }))}
              value={tab}
              onChange={(next) => { setTab(next); setSelectedId(null); }}
              label="Situação dos lançamentos"
              idPrefix="conciliacao"
            />
          </div>
          <TabPanel idPrefix="conciliacao" id={tab}>
            <EditableTable<TransactionRow>
              resource="bank"
              label={`Extrato de ${account.name}`}
              rows={rows}
              columns={columns}
              loading={transactionsQuery.isLoading}
              newRow={() => ({ posted_at: today, origin: "Lançamento manual" })}
              onSave={save}
              onRefresh={() => qc.invalidateQueries({ queryKey: ["finance", companyId, "bank-transactions", accountId] })}
              emptyMessage={tab === "pendente" ? "Nada para conciliar" : "Nenhum lançamento"}
              rowActions={(row) =>
                tab === "pendente" ? (
                  canEdit && (
                    <button type="button" onClick={() => setSelectedId(row.id)} className={secondaryButton} aria-label={`Conciliar ${row.description ?? ""}`.trim()}>
                      <Link2 size={14} aria-hidden="true" /> Conciliar
                    </button>
                  )
                ) : (
                  canEdit && <ConfirmButton label="Desfazer" confirmLabel="Confirmar" tone="neutral" icon={<Undo2 size={14} aria-hidden="true" />} busy={undo.isPending} onConfirm={() => undo.mutate(row.id)} />
                )
              }
            />
          </TabPanel>
        </>
      )}

      {selected && <TransactionPanel key={selected.id} transaction={selected} lookups={lookups} canEdit={canEdit} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

/** Ficha do lançamento pendente, abaixo da lista: contas que podem casar, categorizar ou ignorar. */
function TransactionPanel({ transaction, lookups, canEdit, onClose }: { transaction: BankTransaction; lookups: FinanceLookups; canEdit: boolean; onClose: () => void }) {
  const ctx = useEditContext();
  const companyId = ctx.companyId;
  const qc = useQueryClient();
  const amount = Number(transaction.amount);
  const inflow = amount > 0;
  const [categoryId, setCategoryId] = useState("");
  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ["finance", companyId, "match-suggestions", transaction.id],
    queryFn: async () => suggestMatches(await getDb(), companyId, transaction.id),
  });

  const operation = useMutation({
    mutationFn: async (run: { type: "match"; target: MatchTarget } | { type: "categorize" } | { type: "ignore" }) => {
      const db = await getDb();
      if (run.type === "match") await matchTransaction(db, companyId, transaction.id, run.target, ctx.userId);
      else if (run.type === "categorize") {
        if (!categoryId) throw new Error("Escolha a categoria.");
        await categorizeTransaction(db, companyId, transaction.id, categoryId, ctx.userId);
      } else await ignoreTransaction(db, companyId, transaction.id);
      return run;
    },
    onSuccess: async (run) => {
      invalidateFinance(qc, companyId);
      if (run.type === "match") {
        await emit({ type: "finance.statement.matched", companyId, actorId: ctx.userId, entityType: run.target.kind, entityId: run.target.id, module: "finance", title: `Extrato conciliado: ${transaction.description ?? formatCurrency(amount)}` });
      }
      onClose();
    },
  });

  return (
    <InlinePanel title={transaction.description || transaction.memo || "Lançamento do extrato"} subtitle={inflow ? "Entrada no extrato" : "Saída no extrato"} onClose={onClose}>
      <InfoGrid>
        <InfoItem label="Data" value={formatDay(transaction.posted_at)} />
        <InfoItem label="Valor" value={<Money value={amount} signed />} />
        <InfoItem label="Conta" value={lookups.bankAccountName(transaction.bank_account_id)} />
        <InfoItem label="Origem" value={transaction.source === "manual" ? "Lançamento manual" : transaction.source.toUpperCase()} />
      </InfoGrid>

      <section aria-label="Contas que podem casar" className="space-y-2">
        <h3 className="text-sm font-semibold">{inflow ? "Contas a receber que podem casar" : "Contas a pagar que podem casar"}</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Procurando…</p>
        ) : suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma conta em aberto {inflow ? "a receber" : "a pagar"}.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {suggestions.map(({ entry, exact, daysApart, sameAccount }) => {
              const partial = !exact && Math.abs(amount) < entry.remaining;
              return (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{entry.description}</p>
                    <p className="text-xs text-muted-foreground">
                      Saldo {formatCurrency(entry.remaining)} · vence {formatDay(entry.dueDate)}
                      {entry.partyId && ` · ${lookups.partyName(entry.kind, entry.partyId)}`}
                      {daysApart != null && daysApart !== 0 && ` · ${Math.abs(daysApart)} dia(s) de diferença`}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1 text-xs">
                      {exact && <span className="rounded bg-status-success px-1.5 py-0.5 font-medium text-white">Valor exato</span>}
                      {!sameAccount && <span className="rounded bg-muted px-1.5 py-0.5">Outra conta bancária prevista</span>}
                      {partial && <span className="rounded bg-muted px-1.5 py-0.5">Baixa parcial</span>}
                      {!exact && !partial && <span className="rounded bg-muted px-1.5 py-0.5">A diferença entra como juros</span>}
                    </p>
                  </div>
                  {canEdit && (
                    <button type="button" disabled={operation.isPending} onClick={() => operation.mutate({ type: "match", target: { kind: entry.kind, id: entry.id } })} className={exact ? primaryButton : secondaryButton} aria-label={`Conciliar com ${entry.description}`}>
                      <Link2 size={14} aria-hidden="true" /> Conciliar
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canEdit && (
        <section aria-label="Sem conta ligada" className="space-y-2">
          <h3 className="text-sm font-semibold">Sem conta ligada</h3>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Categoria">
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={inputClass}>
                <option value="">Escolha…</option>
                {categoryOptions(lookups.categories, inflow ? "receita" : "despesa").map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <button type="button" disabled={operation.isPending || !categoryId} onClick={() => operation.mutate({ type: "categorize" })} className={secondaryButton}>
              <Tags size={14} aria-hidden="true" /> Categorizar
            </button>
            <button type="button" disabled={operation.isPending} onClick={() => operation.mutate({ type: "ignore" })} className={secondaryButton}>
              <Ban size={14} aria-hidden="true" /> Ignorar
            </button>
          </div>
        </section>
      )}
      <ErrorNote message={operation.error ? errorMessage(operation.error) : null} />
    </InlinePanel>
  );
}
