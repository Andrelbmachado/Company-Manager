// Contas bancárias e caixas: cadastro editável na própria tabela, conta padrão, saldo realizado (saldo inicial +
// baixas + extrato conciliado) e o último saldo informado no extrato, para conferir. Regras em
// lib/erp/financeSetup e lib/erp/cashflow.
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ListChecks, Trash2 } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { accountBalances, type AccountBalance } from "@/lib/erp/cashflow";
import { BANK_ACCOUNT_KINDS, deleteBankAccount } from "@/lib/erp/financeSetup";
import { sumMoney, toCents } from "@/lib/money";
import { formatCurrency, todayIso } from "@/lib/utils";
import { usePermission } from "@/hooks/usePermission";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { bankAccountRow, saveBankAccountChanges, type BankAccountRow } from "../data/bankAccountEditing";
import { useEditContext } from "../data/useEditContext";
import { BANK_ACCOUNT_KIND_LABELS, ConfirmButton, ErrorNote, Money, errorMessage, invalidateFinance, secondaryButton, useFinanceLookups } from "../components/financeShared";

const hasDifference = (balance: AccountBalance) => balance.statementBalance != null && toCents(balance.statementBalance) !== toCents(balance.balance);

const KIND_OPTIONS = BANK_ACCOUNT_KINDS.map((kind) => ({ value: kind, label: BANK_ACCOUNT_KIND_LABELS[kind] }));

function columns(balanceOf: (id: string) => AccountBalance | undefined): EditableColumn<BankAccountRow>[] {
  return [
    { key: "name", header: "Nome", kind: "text", required: true, placeholder: "Ex.: Itaú PJ, Caixa da loja", width: 200 },
    { key: "kind", header: "Tipo", kind: "select", options: KIND_OPTIONS },
    { key: "bank_code", header: "Código do banco", kind: "text", placeholder: "341" },
    { key: "bank_name", header: "Banco", kind: "text" },
    { key: "agency", header: "Agência", kind: "text" },
    { key: "account_number", header: "Conta", kind: "text" },
    { key: "pix_key", header: "Chave Pix", kind: "text" },
    { key: "opening_balance", header: "Saldo inicial", kind: "money" },
    { key: "opening_date", header: "Data do saldo inicial", kind: "date" },
    { key: "is_default", header: "Padrão", kind: "bool" },
    { key: "active", header: "Ativa", kind: "bool" },
    { key: "inflow", header: "Entradas", kind: "money", readOnly: true },
    { key: "outflow", header: "Saídas", kind: "money", readOnly: true },
    { key: "balance", header: "Saldo", kind: "money", readOnly: true, render: (row) => <Money value={row.balance} className="font-medium" /> },
    {
      key: "statement",
      header: "Extrato",
      kind: "money",
      readOnly: true,
      render: (row) => {
        const balance = balanceOf(row.id);
        if (!balance || balance.statementBalance == null) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="inline-flex flex-col items-end gap-0.5">
            <Money value={balance.statementBalance} />
            {hasDifference(balance) && <span className="rounded bg-status-warning px-1.5 text-xs font-medium text-status-warning-ink">Diferença</span>}
          </span>
        );
      },
    },
    { key: "notes", header: "Observações", kind: "text", width: 200 },
  ];
}

export default function BankAccountsPage() {
  const ctx = useEditContext();
  const companyId = ctx.companyId;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = todayIso();
  const canDelete = usePermission("delete", "bank");
  const lookups = useFinanceLookups(companyId);

  const { data: balances = [], error } = useQuery({
    queryKey: ["bank_accounts", companyId, "balances", today],
    queryFn: async () => accountBalances(await getDb(), companyId, today),
  });
  const accounts = lookups.bankAccounts;
  const balanceOf = useMemo(() => {
    const map = new Map(balances.map((item) => [item.accountId, item]));
    return (id: string) => map.get(id);
  }, [balances]);
  const active = balances.filter((item) => item.active);
  const differences = active.filter(hasDifference);
  const rows = accounts.map((account) => bankAccountRow(account, balanceOf(account.id)));
  const tableColumns = useMemo(() => columns(balanceOf), [balanceOf]);

  async function save(changes: EditableTableChanges<BankAccountRow>) {
    await saveBankAccountChanges(await getDb(), ctx, changes);
    invalidateFinance(qc, companyId);
  }

  const remove = useMutation({
    mutationFn: async (row: BankAccountRow) => {
      await deleteBankAccount(await getDb(), companyId, row.id);
      return row;
    },
    onSuccess: async (row) => {
      invalidateFinance(qc, companyId);
      await emit({ type: "finance.bank_account.deleted", companyId, actorId: ctx.userId, entityType: "bank_account", entityId: row.id, module: "finance", title: `Conta bancária excluída: ${row.name}` });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Contas bancárias" />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard title="Saldo em contas" value={formatCurrency(sumMoney(active.map((item) => item.balance)))} />
        <KpiCard title="Contas ativas" value={String(active.length)} />
        <KpiCard title="Diferença com o extrato" value={String(differences.length)} />
      </div>
      <ErrorNote message={error ? errorMessage(error) : remove.error ? errorMessage(remove.error) : null} />

      <EditableTable<BankAccountRow>
        resource="bank"
        label="Contas bancárias"
        rows={rows}
        columns={tableColumns}
        // A primeira conta já nasce como padrão (é a que as baixas e a conciliação sugerem).
        newRow={() => ({ kind: "corrente", opening_balance: 0, is_default: accounts.length === 0 ? 1 : 0, active: 1 })}
        onSave={save}
        onRefresh={() => qc.invalidateQueries({ queryKey: ["bank_accounts", companyId] })}
        emptyMessage="Nenhuma conta bancária"
        rowActions={(row) => (
          <span className="flex justify-end gap-1.5">
            <button type="button" onClick={() => navigate(`/finance/conciliacao?conta=${row.id}`)} className={secondaryButton} aria-label={`Conciliar ${row.name}`}>
              <ListChecks size={14} aria-hidden="true" /> Conciliar
            </button>
            {canDelete && (
              <ConfirmButton label="" ariaLabel={`Excluir ${row.name}`} confirmLabel="Confirmar exclusão" icon={<Trash2 size={14} aria-hidden="true" />} busy={remove.isPending} onConfirm={() => remove.mutate(row)} />
            )}
          </span>
        )}
      />
    </div>
  );
}
