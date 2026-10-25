// Conciliação bancária: importa o extrato (OFX ou CSV) sem duplicar, concilia sozinho o que tem um único candidato
// exato e deixa o resto para casar com uma conta, categorizar (tarifa, rendimento) ou ignorar. Regras em lib/erp/reconcile.
import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Ban, FileUp, Link2, ListChecks, Plus, Tags, Undo2 } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { accountBalances } from "@/lib/erp/cashflow";
import { loadPayables, loadReceivables, parseMoneyInput, toEntry } from "@/lib/erp/financeCommon";
import {
  addManualTransaction,
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
import { sumMoney } from "@/lib/money";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { DetailDrawer, DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import type { BankTransaction, BankTransactionStatus } from "@/types";
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
  td,
  th,
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

export default function ReconciliationPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
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
  const [manualOpen, setManualOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Só vale conta da empresa: id do link que não está na lista (outra empresa, excluída) não libera nada.
  const requestedAccount = chosenAccount ?? params.get("conta") ?? lookups.defaultBankAccountId ?? "";
  const account = lookups.bankAccounts.find((item) => item.id === requestedAccount) ?? null;
  const accountId = account?.id ?? "";

  const { data: transactions = [] } = useQuery({
    queryKey: ["finance", companyId, "bank-transactions", accountId],
    enabled: Boolean(accountId),
    queryFn: async () =>
      (await getDb()).select<BankTransaction[]>("SELECT * FROM bank_transactions WHERE company_id=? AND bank_account_id=? AND deleted_at IS NULL ORDER BY posted_at DESC", [companyId, accountId]),
  });
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
  const rows = byStatus(tab);
  const selected = selectedId ? (transactions.find((item) => item.id === selectedId) ?? null) : null;

  const importFile = useMutation({
    mutationFn: async (file: File) => {
      if (!accountId) throw new Error("Escolha a conta bancária do extrato.");
      const parsed = parseStatementFile(decodeStatementBytes(await readBytes(file)));
      if (parsed.transactions.length === 0) throw new Error("Nenhum lançamento encontrado no arquivo.");
      const result = await reconcile(await getDb(), accountId, parsed.transactions, { companyId, userId: session.user.id, source: parsed.source });
      return { fileName: file.name, result, balance: parsed.balance, balanceDate: parsed.balanceDate };
    },
    onSuccess: async (imported) => {
      invalidateFinance(qc, companyId);
      setSummary(imported);
      setTab("pendente");
      await emit({ type: "finance.statement.imported", companyId, actorId: session.user.id, entityType: "bank_account", entityId: accountId, module: "finance", title: `Extrato importado (${imported.fileName}): ${imported.result.imported} lançamento(s), ${imported.result.matched} conciliado(s)` });
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conciliação bancária"
        description="Importe o extrato (OFX ou CSV) e ligue cada lançamento à conta paga ou recebida, a uma categoria ou ignore."
        actions={
          <>
            {canCreate && (
              <>
                <button type="button" disabled={!accountId} onClick={() => setManualOpen(true)} className={secondaryButton}>
                  <Plus size={14} aria-hidden="true" /> Lançamento manual
                </button>
                <button type="button" disabled={!accountId || importFile.isPending} onClick={() => fileInput.current?.click()} className={primaryButton}>
                  <FileUp size={14} aria-hidden="true" /> {importFile.isPending ? "Importando…" : "Importar extrato"}
                </button>
                <input ref={fileInput} type="file" accept=".ofx,.qfx,.csv,.txt" className="hidden" aria-label="Arquivo do extrato (OFX ou CSV)" onChange={onFile} />
              </>
            )}
          </>
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
        <EmptyState icon={ListChecks} title="Nenhuma conta bancária" description="Cadastre uma conta em Contas bancárias para importar o extrato." />
      ) : !account ? (
        <EmptyState icon={ListChecks} title="Escolha a conta bancária" description="Selecione acima a conta do extrato para conciliar." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard title="Pendentes" value={String(pending.length)} subtitle={`${formatCurrency(sumMoney(pending.filter((item) => item.amount > 0).map((item) => item.amount)))} entradas · ${formatCurrency(Math.abs(sumMoney(pending.filter((item) => item.amount < 0).map((item) => item.amount))))} saídas`} icon={ListChecks} />
            <KpiCard title="Saldo no sistema" value={formatCurrency(balance?.balance ?? 0)} subtitle={`Realizado até ${formatDay(today)}`} icon={Link2} />
            <KpiCard title="Saldo do extrato" value={balance?.statementBalance != null ? formatCurrency(balance.statementBalance) : "—"} subtitle={balance?.statementDate ? `Em ${formatDay(balance.statementDate)}` : "Importe um extrato com saldo"} icon={FileUp} />
          </div>

          <div className="border-b">
            <TabList
              tabs={TABS.map((item) => ({ id: item.id, label: `${item.label} (${byStatus(item.id).length})` }))}
              value={tab}
              onChange={(next) => { setTab(next); setSelectedId(null); }}
              label="Situação dos lançamentos"
              idPrefix="conciliacao"
            />
          </div>
          <TabPanel idPrefix="conciliacao" id={tab}>
            {rows.length === 0 ? (
              <EmptyState icon={ListChecks} title={tab === "pendente" ? "Nada para conciliar" : "Nenhum lançamento"} description={tab === "pendente" ? "Importe o extrato do banco para conciliar." : undefined} />
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className={th}>Data</th>
                      <th className={th}>Descrição</th>
                      <th className={cn(th, "text-right")}>Valor</th>
                      {tab === "conciliada" && <th className={th}>Ligado a</th>}
                      <th className={th}><span className="sr-only">Ações</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((transaction) => (
                      <tr key={transaction.id} onClick={() => tab === "pendente" && setSelectedId(transaction.id)} className={cn(tab === "pendente" && "cursor-pointer hover:bg-muted/20")}>
                        <td className={cn(td, "whitespace-nowrap")}>{formatDay(transaction.posted_at)}</td>
                        <td className={td}>
                          <p className="font-medium">{transaction.description || transaction.memo || "Sem descrição"}</p>
                          {transaction.memo && transaction.memo !== transaction.description && <p className="text-xs text-muted-foreground">{transaction.memo}</p>}
                        </td>
                        <td className={cn(td, "text-right font-medium")}><Money value={Number(transaction.amount)} signed /></td>
                        {tab === "conciliada" && <td className={td}>{linkedName(transaction)}</td>}
                        <td className={cn(td, "text-right")} onClick={(event) => event.stopPropagation()}>
                          {tab === "pendente" && canEdit && (
                            <button type="button" onClick={() => setSelectedId(transaction.id)} className={secondaryButton} aria-label={`Conciliar ${transaction.description ?? ""}`.trim()}>
                              <Link2 size={14} aria-hidden="true" /> Conciliar
                            </button>
                          )}
                          {tab !== "pendente" && canEdit && (
                            <ConfirmButton label="Desfazer" confirmLabel="Confirmar" tone="neutral" icon={<Undo2 size={14} aria-hidden="true" />} busy={undo.isPending} onConfirm={() => undo.mutate(transaction.id)} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabPanel>
        </>
      )}

      {selected && <TransactionDrawer transaction={selected} lookups={lookups} canEdit={canEdit} onClose={() => setSelectedId(null)} />}
      {manualOpen && account && <ManualTransactionDialog accountId={account.id} onClose={() => setManualOpen(false)} />}
    </div>
  );
}

function TransactionDrawer({ transaction, lookups, canEdit, onClose }: { transaction: BankTransaction; lookups: FinanceLookups; canEdit: boolean; onClose: () => void }) {
  const session = useRequiredSession();
  const companyId = session.company.id;
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
      if (run.type === "match") await matchTransaction(db, companyId, transaction.id, run.target, session.user.id);
      else if (run.type === "categorize") {
        if (!categoryId) throw new Error("Escolha a categoria.");
        await categorizeTransaction(db, companyId, transaction.id, categoryId, session.user.id);
      } else await ignoreTransaction(db, companyId, transaction.id);
      return run;
    },
    onSuccess: async (run) => {
      invalidateFinance(qc, companyId);
      if (run.type === "match") {
        await emit({ type: "finance.statement.matched", companyId, actorId: session.user.id, entityType: run.target.kind, entityId: run.target.id, module: "finance", title: `Extrato conciliado: ${transaction.description ?? formatCurrency(amount)}` });
      }
      onClose();
    },
  });

  return (
    <DetailDrawer title={transaction.description || transaction.memo || "Lançamento do extrato"} subtitle={inflow ? "Entrada no extrato" : "Saída no extrato"} onClose={onClose}>
      <div className="space-y-6">
        <DetailGrid>
          <DetailItem label="Data" value={formatDay(transaction.posted_at)} />
          <DetailItem label="Valor" value={<Money value={amount} signed />} />
          <DetailItem label="Conta" value={lookups.bankAccountName(transaction.bank_account_id)} />
          <DetailItem label="Origem" value={transaction.source === "manual" ? "Lançamento manual" : transaction.source.toUpperCase()} />
          {transaction.memo && <DetailItem label="Memo" value={transaction.memo} />}
        </DetailGrid>

        <section aria-label="Contas que podem casar" className="space-y-2">
          <h3 className="text-sm font-semibold">{inflow ? "Contas a receber que podem casar" : "Contas a pagar que podem casar"}</h3>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Procurando…</p>
          ) : suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma conta em aberto {inflow ? "a receber" : "a pagar"}. Categorize ou ignore o lançamento.</p>
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
                        {exact && <span className="rounded bg-emerald-600/10 px-1.5 py-0.5 font-medium text-emerald-800 dark:text-emerald-300">Valor exato</span>}
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
            <p className="text-sm text-muted-foreground">Tarifas, rendimentos e impostos debitados: escolha a categoria e o lançamento entra no caixa e na DRE. Transferências entre contas próprias: ignore.</p>
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
      </div>
    </DetailDrawer>
  );
}

function ManualTransactionDialog({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({ direction: "saida", posted_at: todayIso(), description: "", amount: "", memo: "" });
  const save = useMutation({
    mutationFn: async () => {
      const value = parseMoneyInput(form.amount);
      if (!Number.isFinite(value) || value <= 0) throw new Error("Informe um valor maior que zero.");
      return addManualTransaction(await getDb(), companyId, {
        bankAccountId: accountId,
        postedAt: form.posted_at,
        amount: form.direction === "saida" ? -value : value,
        description: form.description,
        memo: form.memo.trim() || null,
      });
    },
    onSuccess: () => {
      invalidateFinance(qc, companyId);
      onClose();
    },
  });
  return (
    <CrudDialog
      title="Lançamento manual"
      fields={[
        { key: "direction", label: "Tipo", type: "select", options: [{ value: "saida", label: "Saída" }, { value: "entrada", label: "Entrada" }] },
        { key: "posted_at", label: "Data", type: "date", required: true },
        { key: "description", label: "Descrição", required: true },
        { key: "amount", label: "Valor", required: true, placeholder: "0,00" },
        { key: "memo", label: "Observação", type: "textarea" },
      ]}
      values={form}
      onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
      onClose={onClose}
      onSubmit={() => save.mutate()}
      busy={save.isPending}
    >
      <p className="mt-4 text-sm text-muted-foreground">Para movimentos fora do extrato (ex.: caixa em dinheiro). O lançamento entra como pendente para conciliar.</p>
      <ErrorNote message={save.error ? errorMessage(save.error) : null} />
    </CrudDialog>
  );
}
