// Contas a pagar e a receber editadas na própria tabela: linha da EditableTable a partir da conta e gravação das
// alterações (permissão na camada de dados, validação de todas as linhas antes de gravar, depois updateEntry e
// createEntries do lib/erp). Status, pago e saldo acompanham as baixas e não se editam aqui.
import type { EditableTableChanges } from "@/components/shared/EditableTable";
import { emit } from "@/lib/events/bus";
import { displayStatus, getEntry, isIsoMonth, type EntryKind, type FinanceDb, type FinanceEntry } from "@/lib/erp/financeCommon";
import { createEntries, updateEntry, type EntryInput } from "@/lib/erp/financeSetup";
import { fromCents, toCents } from "@/lib/money";
import { formatCurrency } from "@/lib/utils";
import { requireTablePermission, rowError, type EditContext } from "./guard";

export interface EntryRow {
  id: string;
  description: string;
  party_id: string | null;
  category_id: string | null;
  cost_center_id: string | null;
  due_date: string | null;
  amount: number;
  paid: number;
  remaining: number;
  status: string;
  document_number: string | null;
  payment_method: string | null;
  bank_account_id: string | null;
  competence: string | null;
  issue_date: string | null;
  /** Só ao adicionar (divide o valor em parcelas mensais); nas contas gravadas fica vazio e a tela mostra "n/N". */
  installments: number | null;
  notes: string | null;
}

export const ENTRY_RESOURCE = { payable: "payables", receivable: "receivables" } as const;

export function entryRow(entry: FinanceEntry, today: string): EntryRow {
  const raw = entry.raw;
  return {
    id: entry.id,
    description: entry.description,
    party_id: entry.partyId,
    category_id: entry.categoryId,
    cost_center_id: entry.costCenterId,
    due_date: entry.dueDate,
    amount: entry.amount,
    paid: entry.paid,
    remaining: entry.remaining,
    status: displayStatus(entry, today),
    document_number: raw.document_number ?? null,
    payment_method: raw.payment_method ?? null,
    bank_account_id: entry.bankAccountId,
    competence: raw.competence ?? null,
    issue_date: raw.issue_date ? raw.issue_date.slice(0, 10) : null,
    installments: null,
    notes: raw.notes ?? null,
  };
}

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());
const has = <T extends object>(patch: T, key: keyof T) => Object.prototype.hasOwnProperty.call(patch, key);

/** Campos editáveis da linha → EntryInput (só os que vieram; `undefined` = updateEntry mantém o gravado). */
function inputFrom(values: Partial<EntryRow>, fallback: { description: string; amount: number }): EntryInput {
  const pick = <K extends keyof EntryRow>(key: K) => (has(values, key) ? ((values[key] ?? null) as string | null) : undefined);
  return {
    description: has(values, "description") ? text(values.description) : fallback.description,
    amount: has(values, "amount") ? Number(values.amount) : fallback.amount,
    dueDate: pick("due_date"),
    issueDate: pick("issue_date"),
    competence: pick("competence"),
    categoryId: pick("category_id"),
    costCenterId: pick("cost_center_id"),
    bankAccountId: pick("bank_account_id"),
    partyId: pick("party_id"),
    documentNumber: pick("document_number"),
    paymentMethod: pick("payment_method"),
    notes: pick("notes"),
  };
}

function checkCommon(label: string, input: EntryInput, competenceChanged: boolean): void {
  if (!text(input.description)) throw rowError(label, "informe a descrição.");
  if (!Number.isFinite(input.amount) || toCents(input.amount) <= 0) throw rowError(label, "informe um valor maior que zero.");
  const competence = text(input.competence);
  if (competenceChanged && competence && !isIsoMonth(competence)) throw rowError(label, "competência inválida: use AAAA-MM (ex.: 2026-10).");
}

export interface SavedEntries {
  updated: string[];
  created: string[];
}

/**
 * Grava as alterações da tabela de contas. Confere a permissão (edit/create em payables ou receivables) e valida
 * todas as linhas antes da primeira gravação, para um erro não deixar metade gravada (o banco não tem transação).
 */
export async function saveEntryChanges(db: FinanceDb, ctx: EditContext, kind: EntryKind, changes: EditableTableChanges<EntryRow>): Promise<SavedEntries> {
  requireTablePermission(ctx.role, ENTRY_RESOURCE[kind], changes);

  const updates: { id: string; input: EntryInput; label: string }[] = [];
  for (const patch of changes.updated) {
    const current = await getEntry(db, ctx.companyId, kind, patch.id);
    const label = current.description;
    if (current.status === "cancelada") throw rowError(label, "conta cancelada não se edita.");
    if (has(patch, "installments") && patch.installments !== null) {
      throw rowError(label, "parcelas só ao adicionar. Para mudar uma conta gravada, edite o valor e o vencimento.");
    }
    const input = inputFrom(patch, { description: current.description, amount: current.amount });
    checkCommon(label, input, has(patch, "competence"));
    if (toCents(input.amount) < toCents(current.paid)) throw rowError(label, `o valor não pode ficar abaixo do já pago (${formatCurrency(fromCents(toCents(current.paid)))}).`);
    updates.push({ id: patch.id, input, label: text(input.description) || label });
  }

  const creates: { input: EntryInput & { installments: number }; label: string }[] = [];
  for (const values of changes.created) {
    const input = inputFrom(values, { description: "", amount: Number.NaN });
    const label = text(input.description) || "Linha nova";
    checkCommon(label, input, true);
    const installments = values.installments == null ? 1 : Number(values.installments);
    if (!Number.isInteger(installments) || installments < 1 || installments > 120) throw rowError(label, "número de parcelas inválido (1 a 120).");
    if (installments > 1 && !text(input.dueDate)) throw rowError(label, "informe o vencimento da primeira parcela.");
    creates.push({ input: { ...input, installments }, label });
  }

  const saved: SavedEntries = { updated: [], created: [] };
  for (const update of updates) {
    await updateEntry(db, ctx.companyId, kind, update.id, update.input);
    saved.updated.push(update.id);
    await emit({ type: `finance.${kind}.updated`, companyId: ctx.companyId, actorId: ctx.userId, entityType: kind, entityId: update.id, module: "finance", title: `Conta editada: ${update.label}` });
  }
  for (const create of creates) {
    const ids = await createEntries(db, ctx.companyId, kind, create.input);
    saved.created.push(...ids);
    await emit({
      type: `finance.${kind}.created`,
      companyId: ctx.companyId,
      actorId: ctx.userId,
      entityType: kind,
      entityId: ids[0],
      module: "finance",
      title: `${ids.length > 1 ? `${ids.length} parcelas criadas` : "Conta criada"}: ${create.label}`,
    });
  }
  return saved;
}
