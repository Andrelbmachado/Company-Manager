// Cadastros do financeiro com as regras de negócio fora das telas: contas a pagar/receber (com parcelas), contas
// bancárias (uma padrão), plano de contas (sem ciclo, código único), centros de custo e recorrências.
// Excluir é sempre soft delete e só vale para o que não está em uso (o resto se desativa, para não sumir dinheiro).
import { v4 as uuidv4 } from "uuid";
import { fromCents, roundMoney, splitInstallments, toCents } from "@/lib/money";
import { formatCurrency, todayIso } from "@/lib/utils";
import type { BankAccountKind, CostCenter, DreGroup, FinanceCategory, FinanceCategoryKind, FinancialStatus, RecurringEntry, RecurringFrequency, RecurringKind } from "@/types";
import {
  ENTRY_TABLE,
  PARTIAL_STATUS,
  SETTLED_STATUS,
  addMonths,
  assertIsoDay,
  daysInMonth,
  getEntry,
  isIsoMonth,
  isTrue,
  loadBankAccounts,
  loadCategories,
  monthLabel,
  type EntryKind,
  type FinanceDb,
} from "./financeCommon";
import { DRE_GROUPS } from "./dre";
import { resumeCompetence } from "./recurring";

const blank = (value: string | null | undefined): string | null => {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
};

function optionalDay(value: string | null | undefined, label: string): string | null {
  const text = blank(value);
  return text === null ? null : assertIsoDay(text, label);
}

function positiveAmount(value: number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || toCents(amount) <= 0) throw new Error("Informe um valor maior que zero.");
  return roundMoney(amount);
}

/** Mesmo dia `months` meses depois; dia que não existe no mês vira o último dia (31/01 → 28/02). */
export function addMonthsToDay(day: string, months: number): string {
  const month = addMonths(day.slice(0, 7), months);
  return `${month}-${String(Math.min(Number(day.slice(8, 10)), daysInMonth(month))).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Contas a pagar e a receber
// ---------------------------------------------------------------------------------------------------------------

export interface EntryInput {
  description: string;
  amount: number;
  dueDate?: string | null;
  issueDate?: string | null;
  /** 'YYYY-MM' (regime de competência na DRE); vazio = a DRE usa emissão ou vencimento. */
  competence?: string | null;
  categoryId?: string | null;
  costCenterId?: string | null;
  bankAccountId?: string | null;
  /** Fornecedor (pagar) ou cliente (receber). */
  partyId?: string | null;
  documentNumber?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
}

function validateEntry(input: EntryInput): { description: string; amount: number; dueDate: string | null; issueDate: string | null; competence: string | null } {
  const description = blank(input.description);
  if (!description) throw new Error("Informe a descrição.");
  const amount = positiveAmount(input.amount);
  const competence = blank(input.competence);
  if (competence !== null && !isIsoMonth(competence)) throw new Error("Competência inválida: use AAAA-MM.");
  return { description, amount, dueDate: optionalDay(input.dueDate, "Vencimento"), issueDate: optionalDay(input.issueDate, "Data de emissão"), competence };
}

/** Cria a conta (ou as parcelas: valores com splitInstallments, vencimentos mês a mês). Devolve os ids. */
export async function createEntries(db: FinanceDb, companyId: string, kind: EntryKind, input: EntryInput & { installments?: number }): Promise<string[]> {
  const { description, amount, dueDate, issueDate, competence } = validateEntry(input);
  const count = input.installments ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 120) throw new Error("Número de parcelas inválido (1 a 120).");
  if (count > 1 && !dueDate) throw new Error("Informe o vencimento da primeira parcela.");
  const values = splitInstallments(amount, count);
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const id = uuidv4();
    const label = count > 1 ? `${description} (${index + 1}/${count})` : description;
    const due = dueDate ? addMonthsToDay(dueDate, index) : null;
    const common = [
      values[index],
      due,
      "aberta",
      blank(input.costCenterId),
      blank(input.categoryId),
      blank(input.bankAccountId),
      issueDate,
      competence,
      blank(input.documentNumber),
      blank(input.paymentMethod),
      blank(input.notes),
      count > 1 ? index + 1 : null,
      count > 1 ? count : null,
      "Manual",
      0,
    ];
    if (kind === "payable") {
      await db.execute(
        "INSERT INTO payables (id, company_id, description, supplier_id, amount, due_date, status, cost_center_id, category_id, bank_account_id, issue_date, competence, document_number, payment_method, notes, installment_number, installment_count, ref_type, paid_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [id, companyId, label, blank(input.partyId), ...common],
      );
    } else {
      await db.execute(
        "INSERT INTO receivables (id, company_id, description, customer_id, amount, due_date, status, cost_center_id, category_id, bank_account_id, issue_date, competence, document_number, payment_method, notes, installment_number, installment_count, ref_type, received_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [id, companyId, label, blank(input.partyId), ...common],
      );
    }
    ids.push(id);
  }
  return ids;
}

/**
 * Edita a conta. Campo `undefined` fica como está; `null`/"" limpa. O valor não pode ficar abaixo do já pago e o
 * status acompanha (paga, paga em parte ou o status em aberto de antes). Origem (ref_type/ref_id) não muda.
 */
export async function updateEntry(db: FinanceDb, companyId: string, kind: EntryKind, id: string, input: EntryInput): Promise<void> {
  const entry = await getEntry(db, companyId, kind, id);
  const { description, amount } = validateEntry({ ...input, dueDate: null, issueDate: null, competence: null });
  const raw = entry.raw;
  const keepOr = (value: string | null | undefined, current: string | null | undefined) => (value === undefined ? (current ?? null) : blank(value));
  const dueDate = input.dueDate === undefined ? (raw.due_date ?? null) : optionalDay(input.dueDate, "Vencimento");
  const issueDate = input.issueDate === undefined ? (raw.issue_date ?? null) : optionalDay(input.issueDate, "Data de emissão");
  const competence = input.competence === undefined ? (raw.competence ?? null) : blank(input.competence);
  // Lançamento de recorrência semanal guarda o dia ('YYYY-MM-DD'): o formulário devolve esse valor sem mudar.
  const competenceChanged = competence !== (raw.competence ?? null);
  if (competence !== null && competenceChanged && !isIsoMonth(competence)) throw new Error("Competência inválida: use AAAA-MM.");
  if (competence !== null && competenceChanged && entry.recurringEntryId) {
    // Uma competência por recorrência (o índice único inclui os excluídos): erro legível em vez do UNIQUE do SQLite.
    const siblings = await db.select<{ id: string; competence?: string | null }[]>(`SELECT * FROM ${ENTRY_TABLE[kind]} WHERE company_id=? AND recurring_entry_id=?`, [companyId, entry.recurringEntryId]);
    if (siblings.some((row) => row.id !== id && row.competence === competence)) throw new Error(`Esta recorrência já tem um lançamento na competência ${monthLabel(competence)}.`);
  }

  const paidCents = toCents(entry.paid);
  const amountCents = toCents(amount);
  if (amountCents < paidCents) throw new Error(`O valor não pode ficar abaixo do já pago (${formatCurrency(fromCents(paidCents))}).`);
  let status: FinancialStatus | string = entry.status;
  if (status !== "cancelada") {
    if (paidCents > 0) status = paidCents >= amountCents ? SETTLED_STATUS[kind] : PARTIAL_STATUS[kind];
    else if (status === SETTLED_STATUS[kind] || status === PARTIAL_STATUS[kind]) status = kind === "payable" && entry.approverId ? "aprovada" : "aberta";
  }
  const settledAt = status === SETTLED_STATUS[kind] ? entry.settledAt : null;
  const [partyColumn, paidColumn, dateColumn] = kind === "payable" ? ["supplier_id", "paid_amount", "paid_at"] : ["customer_id", "received_amount", "received_at"];
  await db.execute(
    `UPDATE ${ENTRY_TABLE[kind]} SET description=?, amount=?, due_date=?, issue_date=?, competence=?, category_id=?, cost_center_id=?, bank_account_id=?, ${partyColumn}=?, document_number=?, payment_method=?, notes=?, ${paidColumn}=?, status=?, ${dateColumn}=?, updated_at=datetime('now') WHERE company_id=? AND id=?`,
    [
      description,
      amount,
      dueDate,
      issueDate,
      competence,
      keepOr(input.categoryId, entry.categoryId),
      keepOr(input.costCenterId, entry.costCenterId),
      keepOr(input.bankAccountId, entry.bankAccountId),
      keepOr(input.partyId, entry.partyId),
      keepOr(input.documentNumber, raw.document_number),
      keepOr(input.paymentMethod, raw.payment_method),
      keepOr(input.notes, raw.notes),
      fromCents(paidCents),
      status,
      settledAt,
      companyId,
      id,
    ],
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Contas bancárias
// ---------------------------------------------------------------------------------------------------------------

export const BANK_ACCOUNT_KINDS: readonly BankAccountKind[] = ["corrente", "poupanca", "caixa", "cartao", "investimento"];

export interface BankAccountInput {
  name: string;
  kind: BankAccountKind;
  bankCode?: string | null;
  bankName?: string | null;
  agency?: string | null;
  accountNumber?: string | null;
  pixKey?: string | null;
  openingBalance?: number | null;
  openingDate?: string | null;
  isDefault?: boolean;
  active?: boolean;
  notes?: string | null;
}

/** Cria ou edita a conta bancária. A primeira conta da empresa vira a padrão; marcar uma como padrão desmarca as outras. */
export async function saveBankAccount(db: FinanceDb, companyId: string, input: BankAccountInput, id?: string): Promise<string> {
  const name = blank(input.name);
  if (!name) throw new Error("Informe o nome da conta.");
  if (!BANK_ACCOUNT_KINDS.includes(input.kind)) throw new Error("Tipo de conta inválido.");
  const openingBalance = Number(input.openingBalance ?? 0);
  if (!Number.isFinite(openingBalance)) throw new Error("Saldo inicial inválido.");
  const openingDate = optionalDay(input.openingDate, "Data do saldo inicial");
  const accounts = await loadBankAccounts(db, companyId);
  const current = id ? accounts.find((account) => account.id === id) : undefined;
  if (id && !current) throw new Error("Conta bancária não encontrada.");
  const isDefault = input.isDefault ?? (current ? isTrue(current.is_default) : accounts.length === 0);
  const active = input.active ?? (current ? isTrue(current.active) : true);
  const values = [name, input.kind, blank(input.bankCode), blank(input.bankName), blank(input.agency), blank(input.accountNumber), blank(input.pixKey), roundMoney(openingBalance), openingDate, isDefault ? 1 : 0, active ? 1 : 0, blank(input.notes)];
  const accountId = id ?? uuidv4();
  if (current) {
    await db.execute(
      "UPDATE bank_accounts SET name=?, kind=?, bank_code=?, bank_name=?, agency=?, account_number=?, pix_key=?, opening_balance=?, opening_date=?, is_default=?, active=?, notes=?, updated_at=datetime('now') WHERE company_id=? AND id=?",
      [...values, companyId, accountId],
    );
  } else {
    await db.execute(
      "INSERT INTO bank_accounts (id, company_id, name, kind, bank_code, bank_name, agency, account_number, pix_key, opening_balance, opening_date, is_default, active, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [accountId, companyId, ...values],
    );
  }
  if (isDefault) {
    for (const other of accounts.filter((account) => account.id !== accountId && isTrue(account.is_default))) {
      await db.execute("UPDATE bank_accounts SET is_default=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [0, companyId, other.id]);
    }
  }
  return accountId;
}

async function hasRows(db: FinanceDb, table: string, column: string, companyId: string, value: string, activeOnly = true): Promise<boolean> {
  const rows = await db.select<{ deleted_at?: string | null }[]>(`SELECT * FROM ${table} WHERE company_id=? AND ${column}=?`, [companyId, value]);
  return rows.some((row) => !activeOnly || !row.deleted_at);
}

/** Exclui (soft delete) a conta bancária sem movimento; com movimento, o caminho é desativar. */
export async function deleteBankAccount(db: FinanceDb, companyId: string, id: string): Promise<void> {
  const account = (await loadBankAccounts(db, companyId)).find((item) => item.id === id);
  if (!account) throw new Error("Conta bancária não encontrada.");
  // Faturas guardam a conta prevista e passam para as contas a receber ao emitir/parcelar.
  for (const table of ["bank_transactions", "finance_settlements", "payables", "receivables", "recurring_entries", "invoices"]) {
    if (await hasRows(db, table, "bank_account_id", companyId, id)) throw new Error("Esta conta tem lançamentos ligados: desative em vez de excluir.");
  }
  await db.execute("UPDATE bank_accounts SET deleted_at=datetime('now'), is_default=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [0, companyId, id]);
}

// ---------------------------------------------------------------------------------------------------------------
// Plano de contas
// ---------------------------------------------------------------------------------------------------------------

export interface CategoryInput {
  name: string;
  kind: FinanceCategoryKind;
  code?: string | null;
  parentId?: string | null;
  /** Linha da DRE; vazio = herda da categoria pai (ou receita/despesa pelo tipo). */
  dreGroup?: DreGroup | null;
  position?: number | null;
  active?: boolean;
}

export async function saveCategory(db: FinanceDb, companyId: string, input: CategoryInput, id?: string): Promise<string> {
  const name = blank(input.name);
  if (!name) throw new Error("Informe o nome da categoria.");
  if (input.kind !== "receita" && input.kind !== "despesa") throw new Error("Tipo inválido: receita ou despesa.");
  const dreGroup = blank(input.dreGroup) as DreGroup | null;
  if (dreGroup !== null && !DRE_GROUPS.includes(dreGroup)) throw new Error("Linha da DRE inválida.");
  const categories = await loadCategories(db, companyId);
  const current = id ? categories.find((category) => category.id === id) : undefined;
  if (id && !current) throw new Error("Categoria não encontrada.");
  const code = blank(input.code);
  if (code && categories.some((category) => category.id !== id && (category.code ?? "").trim().toLowerCase() === code.toLowerCase())) {
    throw new Error(`Já existe uma categoria com o código ${code}.`);
  }
  const parentId = blank(input.parentId);
  if (parentId) {
    const byId = new Map(categories.map((category) => [category.id, category]));
    if (!byId.has(parentId)) throw new Error("Categoria pai não encontrada.");
    const seen = new Set<string>();
    for (let cursor: FinanceCategory | undefined = byId.get(parentId); cursor && !seen.has(cursor.id); cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined) {
      if (cursor.id === id) throw new Error("A categoria não pode ficar dentro dela mesma (nem de uma subcategoria dela).");
      seen.add(cursor.id);
    }
  }
  const position = input.position != null && Number.isFinite(Number(input.position)) ? Math.trunc(Number(input.position)) : (current?.position ?? categories.length + 1);
  const active = input.active ?? (current ? isTrue(current.active) : true);
  const values = [parentId, code, name, input.kind, dreGroup, position, active ? 1 : 0];
  if (current) {
    await db.execute("UPDATE finance_categories SET parent_id=?, code=?, name=?, kind=?, dre_group=?, position=?, active=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [...values, companyId, current.id]);
    return current.id;
  }
  const categoryId = uuidv4();
  await db.execute("INSERT INTO finance_categories (id, company_id, parent_id, code, name, kind, dre_group, position, active) VALUES (?,?,?,?,?,?,?,?,?)", [categoryId, companyId, ...values]);
  return categoryId;
}

/** Exclui (soft delete) categoria sem subcategorias ativas e sem lançamentos; em uso, o caminho é desativar. */
export async function deleteCategory(db: FinanceDb, companyId: string, id: string): Promise<void> {
  const categories = await loadCategories(db, companyId);
  if (!categories.some((category) => category.id === id)) throw new Error("Categoria não encontrada.");
  if (categories.some((category) => category.parent_id === id)) throw new Error("Esta categoria tem subcategorias: exclua ou mova as subcategorias antes.");
  // Faturas, pedidos de compra e produtos levam a categoria para as contas que geram depois.
  const uses: [string, string][] = [
    ["payables", "category_id"],
    ["receivables", "category_id"],
    ["bank_transactions", "category_id"],
    ["recurring_entries", "category_id"],
    ["invoices", "category_id"],
    ["purchase_orders", "category_id"],
    ["products", "revenue_category_id"],
  ];
  for (const [table, column] of uses) {
    if (await hasRows(db, table, column, companyId, id)) throw new Error("Categoria em uso em lançamentos, faturas, pedidos ou produtos: desative em vez de excluir.");
  }
  await db.execute("UPDATE finance_categories SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE company_id=? AND id=?", [companyId, id]);
}

// ---------------------------------------------------------------------------------------------------------------
// Centros de custo
// ---------------------------------------------------------------------------------------------------------------

export async function saveCostCenter(db: FinanceDb, companyId: string, input: { name: string; departmentId?: string | null }, id?: string): Promise<string> {
  const name = blank(input.name);
  if (!name) throw new Error("Informe o nome do centro de custo.");
  if (id) {
    const current = (await db.select<CostCenter[]>("SELECT * FROM cost_centers WHERE company_id=? AND id=?", [companyId, id]))[0];
    if (!current || current.deleted_at) throw new Error("Centro de custo não encontrado.");
    await db.execute("UPDATE cost_centers SET name=?, department_id=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [name, blank(input.departmentId), companyId, id]);
    return id;
  }
  const costCenterId = uuidv4();
  await db.execute("INSERT INTO cost_centers (id, company_id, name, department_id) VALUES (?,?,?,?)", [costCenterId, companyId, name, blank(input.departmentId)]);
  return costCenterId;
}

export async function deleteCostCenter(db: FinanceDb, companyId: string, id: string): Promise<void> {
  for (const table of ["payables", "receivables", "recurring_entries", "purchase_orders"]) {
    if (await hasRows(db, table, "cost_center_id", companyId, id)) throw new Error("Centro de custo em uso em lançamentos ou pedidos de compra: não pode ser excluído.");
  }
  await db.execute("UPDATE cost_centers SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE company_id=? AND id=?", [companyId, id]);
}

// ---------------------------------------------------------------------------------------------------------------
// Recorrências
// ---------------------------------------------------------------------------------------------------------------

export const RECURRING_FREQUENCIES: readonly RecurringFrequency[] = ["semanal", "mensal", "bimestral", "trimestral", "semestral", "anual"];

export interface RecurringInput {
  kind: RecurringKind;
  description: string;
  amount: number;
  frequency: RecurringFrequency;
  dayOfMonth?: number | null;
  startDate: string;
  endDate?: string | null;
  /** Fornecedor (pagar) ou cliente (receber). */
  partyId?: string | null;
  categoryId?: string | null;
  costCenterId?: string | null;
  bankAccountId?: string | null;
  notes?: string | null;
  active?: boolean;
}

export async function saveRecurring(db: FinanceDb, companyId: string, input: RecurringInput, userId: string | null, id?: string, today = todayIso()): Promise<string> {
  if (input.kind !== "pagar" && input.kind !== "receber") throw new Error("Tipo inválido: pagar ou receber.");
  const description = blank(input.description);
  if (!description) throw new Error("Informe a descrição.");
  const amount = positiveAmount(input.amount);
  if (!RECURRING_FREQUENCIES.includes(input.frequency)) throw new Error("Frequência inválida.");
  const startDate = assertIsoDay(blank(input.startDate), "Data de início");
  const endDate = optionalDay(input.endDate, "Data de fim");
  if (endDate && endDate < startDate) throw new Error("A data de fim vem antes do início.");
  const day = input.dayOfMonth == null || String(input.dayOfMonth).trim() === "" ? null : Number(input.dayOfMonth);
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) throw new Error("Dia do vencimento deve ser de 1 a 31.");
  const party = blank(input.partyId);
  const values = [
    input.kind,
    description,
    amount,
    input.frequency,
    day,
    startDate,
    endDate,
    input.kind === "pagar" ? party : null,
    input.kind === "receber" ? party : null,
    blank(input.categoryId),
    blank(input.costCenterId),
    blank(input.bankAccountId),
    input.active === false ? 0 : 1,
    blank(input.notes),
  ];
  if (id) {
    const current = await getRecurring(db, companyId, id);
    // Reativar pelo formulário é retomar: também pula a pausa.
    const resuming = input.active !== false && !isTrue(current.active);
    const lastCompetence = resuming ? resumeCompetence({ frequency: input.frequency, last_competence: current.last_competence }, today) : (current.last_competence ?? null);
    await db.execute(
      "UPDATE recurring_entries SET kind=?, description=?, amount=?, frequency=?, day_of_month=?, start_date=?, end_date=?, supplier_id=?, customer_id=?, category_id=?, cost_center_id=?, bank_account_id=?, active=?, notes=?, last_competence=?, updated_at=datetime('now') WHERE company_id=? AND id=?",
      [...values, lastCompetence, companyId, id],
    );
    return id;
  }
  const recurringId = uuidv4();
  await db.execute(
    "INSERT INTO recurring_entries (id, company_id, kind, description, amount, frequency, day_of_month, start_date, end_date, supplier_id, customer_id, category_id, cost_center_id, bank_account_id, active, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [recurringId, companyId, ...values, userId],
  );
  return recurringId;
}

async function getRecurring(db: FinanceDb, companyId: string, id: string): Promise<RecurringEntry> {
  const current = (await db.select<RecurringEntry[]>("SELECT * FROM recurring_entries WHERE company_id=? AND id=?", [companyId, id]))[0];
  if (!current || current.deleted_at) throw new Error("Recorrência não encontrada.");
  return current;
}

/** Pausa ou retoma. Retomar pula as competências da pausa (resumeCompetence): só gera do mês de `today` em diante. */
export async function setRecurringActive(db: FinanceDb, companyId: string, id: string, active: boolean, today = todayIso()): Promise<void> {
  const current = await getRecurring(db, companyId, id);
  const lastCompetence = active && !isTrue(current.active) ? resumeCompetence(current, today) : (current.last_competence ?? null);
  await db.execute("UPDATE recurring_entries SET active=?, last_competence=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [active ? 1 : 0, lastCompetence, companyId, id]);
}

/** Exclui (soft delete) a recorrência; os lançamentos já gerados continuam. */
export async function deleteRecurring(db: FinanceDb, companyId: string, id: string): Promise<void> {
  await db.execute("UPDATE recurring_entries SET deleted_at=datetime('now'), active=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [0, companyId, id]);
}
