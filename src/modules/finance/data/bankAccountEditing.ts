// Contas bancárias editadas na própria tabela: permissão "bank" na camada de dados, campos alterados mesclados com
// a conta gravada e saveBankAccount (uma conta padrão por empresa) do lib/erp.
import type { EditableTableChanges } from "@/components/shared/EditableTable";
import { emit } from "@/lib/events/bus";
import { isTrue, loadBankAccounts, type FinanceDb } from "@/lib/erp/financeCommon";
import { BANK_ACCOUNT_KINDS, saveBankAccount, type BankAccountInput } from "@/lib/erp/financeSetup";
import type { BankAccount, BankAccountKind } from "@/types";
import { requireTablePermission, rowError, type EditContext } from "./guard";

export interface BankAccountRow {
  id: string;
  name: string;
  kind: BankAccountKind;
  bank_code: string | null;
  bank_name: string | null;
  agency: string | null;
  account_number: string | null;
  pix_key: string | null;
  opening_balance: number;
  opening_date: string | null;
  is_default: number;
  active: number;
  inflow: number;
  outflow: number;
  balance: number;
  statement: number | null;
  notes: string | null;
}

export function bankAccountRow(account: BankAccount, balance?: { inflow: number; outflow: number; balance: number; statementBalance: number | null }): BankAccountRow {
  return {
    id: account.id,
    name: account.name,
    kind: account.kind,
    bank_code: account.bank_code ?? null,
    bank_name: account.bank_name ?? null,
    agency: account.agency ?? null,
    account_number: account.account_number ?? null,
    pix_key: account.pix_key ?? null,
    opening_balance: Number(account.opening_balance ?? 0),
    opening_date: account.opening_date ? account.opening_date.slice(0, 10) : null,
    is_default: isTrue(account.is_default) ? 1 : 0,
    active: isTrue(account.active) ? 1 : 0,
    inflow: balance?.inflow ?? 0,
    outflow: balance?.outflow ?? 0,
    balance: balance?.balance ?? 0,
    statement: balance?.statementBalance ?? null,
    notes: account.notes ?? null,
  };
}

const has = <T extends object>(patch: T, key: keyof T) => Object.prototype.hasOwnProperty.call(patch, key);

function merged(values: Partial<BankAccountRow>, current: BankAccount | undefined): BankAccountInput {
  const pick = <K extends keyof BankAccountRow & keyof BankAccount>(key: K) => (has(values, key) ? values[key] : current?.[key]) as string | null | undefined;
  return {
    name: String((has(values, "name") ? values.name : current?.name) ?? "").trim(),
    kind: ((has(values, "kind") ? values.kind : current?.kind) ?? "corrente") as BankAccountKind,
    bankCode: pick("bank_code") ?? null,
    bankName: pick("bank_name") ?? null,
    agency: pick("agency") ?? null,
    accountNumber: pick("account_number") ?? null,
    pixKey: pick("pix_key") ?? null,
    openingBalance: Number((has(values, "opening_balance") ? values.opening_balance : current?.opening_balance) ?? 0),
    openingDate: pick("opening_date") ?? null,
    isDefault: has(values, "is_default") ? isTrue(values.is_default) : current ? isTrue(current.is_default) : undefined,
    active: has(values, "active") ? isTrue(values.active) : current ? isTrue(current.active) : true,
    notes: pick("notes") ?? null,
  };
}

function check(label: string, input: BankAccountInput): void {
  if (!input.name) throw rowError(label, "informe o nome da conta.");
  if (!BANK_ACCOUNT_KINDS.includes(input.kind)) throw rowError(label, "tipo de conta inválido.");
  if (!Number.isFinite(input.openingBalance ?? 0)) throw rowError(label, "saldo inicial inválido.");
}

/** Grava as alterações da tabela de contas bancárias (valida todas as linhas antes da primeira gravação). */
export async function saveBankAccountChanges(db: FinanceDb, ctx: EditContext, changes: EditableTableChanges<BankAccountRow>): Promise<string[]> {
  requireTablePermission(ctx.role, "bank", changes);
  const accounts = await loadBankAccounts(db, ctx.companyId);
  const work: { id?: string; input: BankAccountInput; label: string }[] = [];
  for (const patch of changes.updated) {
    const current = accounts.find((account) => account.id === patch.id);
    if (!current) throw rowError(patch.name, "conta bancária não encontrada.");
    const input = merged(patch, current);
    check(current.name, input);
    work.push({ id: current.id, input, label: input.name });
  }
  for (const values of changes.created) {
    const input = merged(values, undefined);
    check(input.name || "Linha nova", input);
    work.push({ input, label: input.name });
  }
  const ids: string[] = [];
  for (const item of work) {
    const id = await saveBankAccount(db, ctx.companyId, item.input, item.id);
    ids.push(id);
    await emit({
      type: item.id ? "finance.bank_account.updated" : "finance.bank_account.created",
      companyId: ctx.companyId,
      actorId: ctx.userId,
      entityType: "bank_account",
      entityId: id,
      module: "finance",
      title: `Conta bancária ${item.id ? "editada" : "criada"}: ${item.label}`,
    });
  }
  return ids;
}
