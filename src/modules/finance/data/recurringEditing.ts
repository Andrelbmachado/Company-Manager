// Recorrências editadas na própria tabela: permissão "finance" na camada de dados, campos alterados mesclados com a
// recorrência gravada, fornecedor/cliente e categoria conferidos contra o tipo (pagar/receber) e saveRecurring do
// lib/erp (reativar pela tabela retoma sem gerar os meses da pausa).
import type { EditableTableChanges } from "@/components/shared/EditableTable";
import { isTrue, isIsoDay, loadCategories, monthLabel, type FinanceDb } from "@/lib/erp/financeCommon";
import { RECURRING_FREQUENCIES, saveRecurring, type RecurringInput } from "@/lib/erp/financeSetup";
import { nextOccurrence } from "@/lib/erp/recurring";
import { formatDay } from "@/lib/utils";
import type { RecurringEntry, RecurringFrequency, RecurringKind } from "@/types";
import { requireTablePermission, rowError, type EditContext } from "./guard";

export interface RecurringRow {
  id: string;
  description: string;
  kind: RecurringKind;
  amount: number;
  frequency: RecurringFrequency;
  day_of_month: number | null;
  start_date: string;
  end_date: string | null;
  /** "fornecedor:<id>" (a pagar) ou "cliente:<id>" (a receber). */
  party: string | null;
  category_id: string | null;
  cost_center_id: string | null;
  bank_account_id: string | null;
  active: number;
  /** Próximo vencimento, "Pausada" ou "Encerrada" (só leitura). */
  next: string;
  /** Competência do último lançamento gerado (só leitura). */
  last: string | null;
  notes: string | null;
}

export const partyKey = (kind: RecurringKind, id: string) => `${kind === "pagar" ? "fornecedor" : "cliente"}:${id}`;

const competenceText = (competence: string | null | undefined) => (!competence ? null : competence.length === 7 ? monthLabel(competence) : formatDay(competence));

export function recurringRow(entry: RecurringEntry, today: string): RecurringRow {
  const active = isTrue(entry.active);
  const next = active ? nextOccurrence(entry, today) : null;
  const partyId = entry.kind === "pagar" ? entry.supplier_id : entry.customer_id;
  return {
    id: entry.id,
    description: entry.description,
    kind: entry.kind,
    amount: Number(entry.amount),
    frequency: entry.frequency,
    day_of_month: entry.day_of_month ?? null,
    start_date: entry.start_date.slice(0, 10),
    end_date: entry.end_date ? entry.end_date.slice(0, 10) : null,
    party: partyId ? partyKey(entry.kind, partyId) : null,
    category_id: entry.category_id ?? null,
    cost_center_id: entry.cost_center_id ?? null,
    bank_account_id: entry.bank_account_id ?? null,
    active: active ? 1 : 0,
    next: active ? (next ? formatDay(next.dueDate) : "Encerrada") : "Pausada",
    last: competenceText(entry.last_competence),
    notes: entry.notes ?? null,
  };
}

const has = <T extends object>(patch: T, key: keyof T) => Object.prototype.hasOwnProperty.call(patch, key);

/** Valida e grava as alterações da tabela de recorrências (todas as linhas conferidas antes da primeira gravação). */
export async function saveRecurringChanges(db: FinanceDb, ctx: EditContext, changes: EditableTableChanges<RecurringRow>, today?: string): Promise<string[]> {
  requireTablePermission(ctx.role, "finance", changes);
  const entries = await db.select<RecurringEntry[]>("SELECT * FROM recurring_entries WHERE company_id=? AND deleted_at IS NULL", [ctx.companyId]);
  const categories = new Map((await loadCategories(db, ctx.companyId)).map((category) => [category.id, category]));
  const work: { id?: string; input: RecurringInput }[] = [];

  const build = (values: Partial<RecurringRow>, current: RecurringEntry | undefined): RecurringInput => {
    const base = current ? recurringRow(current, today ?? current.start_date) : undefined;
    const take = <K extends keyof RecurringRow>(key: K): RecurringRow[K] | undefined => (has(values, key) ? values[key] : base?.[key]);
    const kind = (take("kind") ?? "pagar") as RecurringKind;
    const party = take("party") ?? null;
    const label = String(take("description") ?? "").trim() || "Linha nova";
    let partyId: string | null = null;
    if (party) {
      const [type, id] = String(party).split(":");
      if ((type === "fornecedor" && kind !== "pagar") || (type === "cliente" && kind !== "receber")) {
        throw rowError(label, kind === "pagar" ? "recorrência a pagar leva fornecedor, não cliente." : "recorrência a receber leva cliente, não fornecedor.");
      }
      partyId = id ?? null;
    }
    const categoryId = take("category_id") ?? null;
    const category = categoryId ? categories.get(categoryId) : undefined;
    if (category && category.kind !== (kind === "pagar" ? "despesa" : "receita")) {
      throw rowError(label, kind === "pagar" ? "recorrência a pagar usa categoria de despesa." : "recorrência a receber usa categoria de receita.");
    }
    const frequency = (take("frequency") ?? "mensal") as RecurringFrequency;
    if (!RECURRING_FREQUENCIES.includes(frequency)) throw rowError(label, "frequência inválida.");
    const amount = Number(take("amount"));
    if (!Number.isFinite(amount) || amount <= 0) throw rowError(label, "informe um valor maior que zero.");
    if (label === "Linha nova") throw rowError(label, "informe a descrição.");
    const startDate = String(take("start_date") ?? "");
    if (!isIsoDay(startDate)) throw rowError(label, "informe a data de início.");
    const endDate = take("end_date") ?? null;
    if (endDate && endDate < startDate) throw rowError(label, "a data de fim vem antes do início.");
    const day = take("day_of_month");
    if (day != null && (!Number.isInteger(Number(day)) || Number(day) < 1 || Number(day) > 31)) throw rowError(label, "dia do vencimento deve ser de 1 a 31.");
    return {
      kind,
      description: label,
      amount,
      frequency,
      dayOfMonth: day == null ? null : Number(day),
      startDate,
      endDate,
      partyId,
      categoryId,
      costCenterId: take("cost_center_id") ?? null,
      bankAccountId: take("bank_account_id") ?? null,
      notes: take("notes") ?? null,
      active: isTrue(take("active") ?? 1),
    };
  };

  for (const patch of changes.updated) {
    const current = entries.find((entry) => entry.id === patch.id);
    if (!current) throw rowError(patch.description, "recorrência não encontrada.");
    work.push({ id: current.id, input: build(patch, current) });
  }
  for (const values of changes.created) work.push({ input: build(values, undefined) });

  const ids: string[] = [];
  for (const item of work) ids.push(await saveRecurring(db, ctx.companyId, item.input, ctx.userId, item.id, today));
  return ids;
}
