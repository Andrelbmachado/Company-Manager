// Contas bancárias e caixas: cadastro, conta padrão, saldo realizado (saldo inicial + baixas + extrato conciliado) e o
// último saldo informado no extrato, para conferir. Regras em lib/erp/financeSetup e lib/erp/cashflow.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Landmark, ListChecks, Plus, Trash2, Wallet } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { accountBalances, type AccountBalance } from "@/lib/erp/cashflow";
import { isTrue, parseMoneyInput } from "@/lib/erp/financeCommon";
import { BANK_ACCOUNT_KINDS, deleteBankAccount, saveBankAccount } from "@/lib/erp/financeSetup";
import { sumMoney, toCents } from "@/lib/money";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { DetailDrawer, DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { BankAccount, BankAccountKind } from "@/types";
import { BANK_ACCOUNT_KIND_LABELS, ConfirmButton, ErrorNote, Money, errorMessage, invalidateFinance, primaryButton, secondaryButton, td, th, useFinanceLookups } from "../components/financeShared";

const YES_NO = [
  { value: "1", label: "Sim" },
  { value: "0", label: "Não" },
];

const formFrom = (account: BankAccount | null): Record<string, string> => ({
  name: account?.name ?? "",
  kind: account?.kind ?? "corrente",
  bank_code: account?.bank_code ?? "",
  bank_name: account?.bank_name ?? "",
  agency: account?.agency ?? "",
  account_number: account?.account_number ?? "",
  pix_key: account?.pix_key ?? "",
  opening_balance: account ? String(account.opening_balance ?? 0) : "",
  opening_date: account?.opening_date?.slice(0, 10) ?? "",
  is_default: account ? (isTrue(account.is_default) ? "1" : "0") : "0",
  active: account ? (isTrue(account.active) ? "1" : "0") : "1",
  notes: account?.notes ?? "",
});

const hasDifference = (balance: AccountBalance) => balance.statementBalance != null && toCents(balance.statementBalance) !== toCents(balance.balance);

export default function BankAccountsPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = todayIso();
  const canCreate = usePermission("create", "bank");
  const canEdit = usePermission("edit", "bank");
  const canDelete = usePermission("delete", "bank");
  const lookups = useFinanceLookups(companyId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ account: BankAccount | null } | null>(null);
  const [form, setForm] = useState<Record<string, string>>(formFrom(null));

  const { data: balances = [], error } = useQuery({
    queryKey: ["bank_accounts", companyId, "balances", today],
    queryFn: async () => accountBalances(await getDb(), companyId, today),
  });
  const accounts = lookups.bankAccounts;
  const balanceOf = (id: string) => balances.find((item) => item.accountId === id);
  const active = balances.filter((item) => item.active);
  const differences = active.filter(hasDifference);
  const selected = selectedId ? (accounts.find((account) => account.id === selectedId) ?? null) : null;

  const openForm = (account: BankAccount | null) => {
    // A primeira conta já nasce como padrão (é a que as baixas e a conciliação sugerem).
    setForm(account ? formFrom(account) : { ...formFrom(null), is_default: accounts.length === 0 ? "1" : "0" });
    setEditing({ account });
  };

  const save = useMutation({
    mutationFn: async () => {
      const opening = form.opening_balance.trim() ? parseMoneyInput(form.opening_balance) : 0;
      if (!Number.isFinite(opening)) throw new Error("Saldo inicial inválido: use só números (ex.: 1.500,00).");
      return saveBankAccount(
        await getDb(),
        companyId,
        {
          name: form.name,
          kind: form.kind as BankAccountKind,
          bankCode: form.bank_code,
          bankName: form.bank_name,
          agency: form.agency,
          accountNumber: form.account_number,
          pixKey: form.pix_key,
          openingBalance: opening,
          openingDate: form.opening_date || null,
          isDefault: form.is_default === "1",
          active: form.active === "1",
          notes: form.notes,
        },
        editing?.account?.id,
      );
    },
    onSuccess: async (id) => {
      invalidateFinance(qc, companyId);
      await emit({ type: editing?.account ? "finance.bank_account.updated" : "finance.bank_account.created", companyId, actorId: session.user.id, entityType: "bank_account", entityId: id, module: "finance", title: `Conta bancária ${editing?.account ? "editada" : "criada"}: ${form.name.trim()}` });
      setEditing(null);
    },
  });

  const remove = useMutation({
    mutationFn: async (account: BankAccount) => {
      await deleteBankAccount(await getDb(), companyId, account.id);
      return account;
    },
    onSuccess: async (account) => {
      invalidateFinance(qc, companyId);
      await emit({ type: "finance.bank_account.deleted", companyId, actorId: session.user.id, entityType: "bank_account", entityId: account.id, module: "finance", title: `Conta bancária excluída: ${account.name}` });
      setSelectedId(null);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contas bancárias"
        description="Contas, caixas e cartões da empresa, com o saldo realizado e o último saldo do extrato."
        actions={
          <>
            <ImportExportButtons entity="bank_accounts" onImported={() => invalidateFinance(qc, companyId)} />
            {canCreate && (
              <button type="button" onClick={() => openForm(null)} className={primaryButton}>
                <Plus size={14} aria-hidden="true" /> Nova conta bancária
              </button>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard title="Saldo em contas" value={formatCurrency(sumMoney(active.map((item) => item.balance)))} subtitle={`Realizado até ${formatDay(today)}`} icon={Wallet} />
        <KpiCard title="Contas ativas" value={String(active.length)} subtitle={balances.length > active.length ? `${balances.length - active.length} inativa(s)` : undefined} icon={Landmark} />
        <KpiCard
          title="Diferença com o extrato"
          value={String(differences.length)}
          subtitle={differences.length ? "Conta(s) com saldo diferente do extrato: concilie os pendentes" : "Saldos batem com o último extrato"}
          icon={AlertTriangle}
          iconClassName={differences.length ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : undefined}
        />
      </div>
      <ErrorNote message={error ? errorMessage(error) : null} />

      {accounts.length === 0 ? (
        <EmptyState icon={Landmark} title="Nenhuma conta bancária" description="Cadastre as contas e o caixa da empresa para ver saldos, fluxo de caixa e conciliar extratos." />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className={th}>Conta</th>
                <th className={th}>Tipo</th>
                <th className={th}>Banco</th>
                <th className={cn(th, "text-right")}>Saldo</th>
                <th className={cn(th, "text-right")}>Extrato</th>
                <th className={th}>Status</th>
                <th className={th}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {accounts.map((account) => {
                const balance = balanceOf(account.id);
                return (
                  <tr key={account.id} onClick={() => setSelectedId(account.id)} className="cursor-pointer hover:bg-muted/20">
                    <td className={td}>
                      <span className="font-medium">{account.name}</span>
                      {isTrue(account.is_default) && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary-text">Padrão</span>}
                    </td>
                    <td className={td}>{BANK_ACCOUNT_KIND_LABELS[account.kind] ?? account.kind}</td>
                    <td className={td}>{[account.bank_name, account.agency && `ag. ${account.agency}`, account.account_number && `c/c ${account.account_number}`].filter(Boolean).join(" · ") || "—"}</td>
                    <td className={cn(td, "text-right font-medium")}><Money value={balance?.balance ?? 0} /></td>
                    <td className={cn(td, "text-right")}>
                      {balance?.statementBalance != null ? (
                        <span className={cn(hasDifference(balance) && "text-amber-700 dark:text-amber-400")}>
                          <Money value={balance.statementBalance} />
                          <span className="block text-xs text-muted-foreground">em {formatDay(balance.statementDate)}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={td}><StatusBadge status={isTrue(account.active) ? "active" : "inactive"} /></td>
                    <td className={cn(td, "text-right")}>
                      <button type="button" onClick={(event) => { event.stopPropagation(); navigate(`/finance/conciliacao?conta=${account.id}`); }} className={secondaryButton} aria-label={`Conciliar ${account.name}`}>
                        <ListChecks size={14} aria-hidden="true" /> Conciliar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <DetailDrawer title={selected.name} subtitle="Conta bancária" onClose={() => setSelectedId(null)} onEdit={canEdit ? () => openForm(selected) : undefined}>
          <div className="space-y-6">
            <DetailGrid>
              <DetailItem label="Tipo" value={BANK_ACCOUNT_KIND_LABELS[selected.kind] ?? selected.kind} />
              <DetailItem label="Status" value={<StatusBadge status={isTrue(selected.active) ? "active" : "inactive"} />} />
              <DetailItem label="Banco" value={[selected.bank_code, selected.bank_name].filter(Boolean).join(" · ")} />
              <DetailItem label="Agência e conta" value={[selected.agency, selected.account_number].filter(Boolean).join(" / ")} />
              <DetailItem label="Chave Pix" value={selected.pix_key} />
              <DetailItem label="Conta padrão" value={isTrue(selected.is_default) ? "Sim" : "Não"} />
              <DetailItem label="Saldo inicial" value={`${formatCurrency(Number(selected.opening_balance ?? 0))}${selected.opening_date ? ` em ${formatDay(selected.opening_date)}` : ""}`} />
              <DetailItem label="Entradas realizadas" value={formatCurrency(balanceOf(selected.id)?.inflow ?? 0)} />
              <DetailItem label="Saídas realizadas" value={formatCurrency(balanceOf(selected.id)?.outflow ?? 0)} />
              <DetailItem label="Saldo atual" value={formatCurrency(balanceOf(selected.id)?.balance ?? 0)} />
            </DetailGrid>
            {selected.notes && <p className="whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm">{selected.notes}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => navigate(`/finance/conciliacao?conta=${selected.id}`)} className={secondaryButton}>
                <ListChecks size={14} aria-hidden="true" /> Conciliar extrato
              </button>
              {canDelete && <ConfirmButton label="Excluir" confirmLabel="Confirmar exclusão" icon={<Trash2 size={14} aria-hidden="true" />} busy={remove.isPending} onConfirm={() => remove.mutate(selected)} />}
            </div>
            <ErrorNote message={remove.error ? errorMessage(remove.error) : null} />
          </div>
        </DetailDrawer>
      )}

      {editing && (
        <CrudDialog
          title={editing.account ? "Editar conta bancária" : "Nova conta bancária"}
          fields={[
            { key: "name", label: "Nome", required: true, placeholder: "Ex.: Itaú PJ, Caixa da loja" },
            { key: "kind", label: "Tipo", type: "select", options: BANK_ACCOUNT_KINDS.map((kind) => ({ value: kind, label: BANK_ACCOUNT_KIND_LABELS[kind] })) },
            { key: "bank_code", label: "Código do banco", placeholder: "341" },
            { key: "bank_name", label: "Banco" },
            { key: "agency", label: "Agência" },
            { key: "account_number", label: "Conta" },
            { key: "pix_key", label: "Chave Pix" },
            { key: "opening_balance", label: "Saldo inicial", placeholder: "0,00" },
            { key: "opening_date", label: "Data do saldo inicial", type: "date" },
            { key: "is_default", label: "Conta padrão", type: "select", options: YES_NO },
            { key: "active", label: "Ativa", type: "select", options: YES_NO },
            { key: "notes", label: "Observações", type: "textarea" },
          ]}
          values={form}
          onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
          onClose={() => setEditing(null)}
          onSubmit={() => save.mutate()}
          busy={save.isPending}
        >
          <p className="mt-4 text-sm text-muted-foreground">O saldo inicial vale a partir da data informada; movimentos anteriores a ela não entram no saldo.</p>
          <ErrorNote message={save.error ? errorMessage(save.error) : null} />
        </CrudDialog>
      )}
    </div>
  );
}
