// Recorrências (aluguel, licenças, contratos): geram as contas a pagar/receber de cada competência sem duplicar.
// Regras:
// - Sem histórico (last_competence vazio), começa na competência do mês de hoje (ou no início, se for depois):
//   cadastrar uma recorrência não cria o passado. Com histórico, recupera as competências que faltam até o mês de hoje.
// - Gera a competência do mês inteiro, mesmo com vencimento ainda por vir (é a previsão do fluxo de caixa).
// - Mensal/bimestral/trimestral/semestral/anual contam os meses a partir do início; o dia é day_of_month (ou o dia do
//   início), limitado ao fim do mês (31 → 28 em fevereiro). Semanal: a cada 7 dias desde o início, competência = dia.
// - No máximo um lançamento por competência: o índice único (recurring_entry_id, competence) do SQLite inclui os
//   excluídos (lançamento apagado não volta) e o id é determinístico (uuid v5), então INSERT OR IGNORE também não
//   duplica no banco demo, que não aplica UNIQUE. Antes de gravar, a competência já lançada é procurada aqui.
import { v5 as uuidv5 } from "uuid";
import { roundMoney } from "@/lib/money";
import { formatDay } from "@/lib/utils";
import type { RecurringEntry, RecurringFrequency, RecurringKind } from "@/types";
import { addDays, addMonths, daysBetween, daysInMonth, isIsoDay, isTrue, monthLabel, monthsBetween, rowsAffected, type FinanceDb } from "./financeCommon";

/** Namespace dos ids dos lançamentos gerados (uuid v5 de "<recorrência>:<competência>"). */
const RECURRING_NAMESPACE = "8d5b6f0e-3c1a-4e7b-9f2d-6a4c8e1b2d3f";

const MONTH_STEP: Record<Exclude<RecurringFrequency, "semanal">, number> = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  semanal: "Semanal",
  mensal: "Mensal",
  bimestral: "Bimestral",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};

export interface Occurrence {
  /** 'YYYY-MM' (semanal: 'YYYY-MM-DD'). */
  competence: string;
  dueDate: string;
}

type Schedule = Pick<RecurringEntry, "frequency" | "start_date" | "end_date" | "day_of_month" | "last_competence">;

/** Ocorrências depois da última gerada (ou desde o mês de `today`), até o mês `untilMonth`, no máximo `max`. */
function occurrences(entry: Schedule, today: string, untilMonth: string, max: number): Occurrence[] {
  if (!isIsoDay(entry.start_date) || !isIsoDay(today)) return [];
  const currentMonth = today.slice(0, 7);
  const end = entry.end_date && isIsoDay(entry.end_date) ? entry.end_date : null;
  const list: Occurrence[] = [];

  if (entry.frequency === "semanal") {
    const last = entry.last_competence ? (entry.last_competence.length === 7 ? `${entry.last_competence}-${daysInMonth(entry.last_competence)}` : entry.last_competence) : null;
    const lower = last ? addDays(last, 1) : `${currentMonth}-01`;
    const limit = `${untilMonth}-${String(daysInMonth(untilMonth)).padStart(2, "0")}`;
    let date = entry.start_date;
    if (date < lower) date = addDays(entry.start_date, 7 * Math.ceil(daysBetween(entry.start_date, lower) / 7));
    while (date <= limit && list.length < max) {
      if (end && date > end) break;
      list.push({ competence: date, dueDate: date });
      date = addDays(date, 7);
    }
    return list;
  }

  const step = MONTH_STEP[entry.frequency] ?? 1;
  const startMonth = entry.start_date.slice(0, 7);
  const anchorDay = Math.min(31, Math.max(1, Math.trunc(Number(entry.day_of_month) || Number(entry.start_date.slice(8, 10)))));
  let month = entry.last_competence ? addMonths(entry.last_competence.slice(0, 7), 1) : currentMonth;
  if (month < startMonth) month = startMonth;
  const offset = ((monthsBetween(startMonth, month) % step) + step) % step;
  if (offset !== 0) month = addMonths(month, step - offset);
  while (month <= untilMonth && list.length < max) {
    const dueDate = `${month}-${String(Math.min(anchorDay, daysInMonth(month))).padStart(2, "0")}`;
    if (end && dueDate > end) break;
    if (dueDate >= entry.start_date) list.push({ competence: month, dueDate });
    month = addMonths(month, step);
  }
  return list;
}

/** Competências que já deviam estar lançadas em `today` (do mês de hoje para trás, desde a última gerada). */
export function competencesDue(entry: Schedule, today: string, maxPeriods = 36): Occurrence[] {
  return isIsoDay(today) ? occurrences(entry, today, today.slice(0, 7), maxPeriods) : [];
}

/** Próximo lançamento que a recorrência vai gerar (para a tela); null se já terminou. */
export function nextOccurrence(entry: Schedule, today: string): Occurrence | null {
  if (!isIsoDay(today)) return null;
  return occurrences(entry, today, addMonths(today.slice(0, 7), 25), 1)[0] ?? null;
}

/** "Aluguel (10/2026)" ou, semanal, "Diarista (16/10/2026)". */
export function occurrenceDescription(description: string, competence: string): string {
  return `${description} (${competence.length === 7 ? monthLabel(competence) : formatDay(competence)})`;
}

export function generatedEntryId(recurringId: string, competence: string): string {
  return uuidv5(`${recurringId}:${competence}`, RECURRING_NAMESPACE);
}

export interface RecurringRunResult {
  created: number;
  /** Competências que já tinham lançamento (não gravadas de novo). */
  skipped: number;
  payableIds: string[];
  receivableIds: string[];
}

export interface RunRecurringOptions {
  /** Só estes tipos (o papel pode criar contas a pagar mas não a receber, por exemplo). Padrão: os dois. */
  kinds?: RecurringKind[];
  maxPeriods?: number;
}

/** Gera os lançamentos das recorrências ativas da empresa até o mês de `today` ('YYYY-MM-DD', dia local). */
export async function runRecurring(db: FinanceDb, companyId: string, today: string, options: RunRecurringOptions = {}): Promise<RecurringRunResult> {
  if (!isIsoDay(today)) throw new Error("Data de referência inválida: use o formato AAAA-MM-DD.");
  const kinds = options.kinds ?? ["pagar", "receber"];
  const result: RecurringRunResult = { created: 0, skipped: 0, payableIds: [], receivableIds: [] };
  const entries = await db.select<RecurringEntry[]>("SELECT * FROM recurring_entries WHERE company_id=? AND deleted_at IS NULL", [companyId]);

  for (const entry of [...entries].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!isTrue(entry.active) || !kinds.includes(entry.kind)) continue;
    const due = competencesDue(entry, today, options.maxPeriods);
    if (due.length === 0) continue;
    const table = entry.kind === "pagar" ? "payables" : "receivables";
    // Inclui excluídos: a competência apagada continua "lançada".
    const existing = await db.select<{ competence?: string | null }[]>(`SELECT * FROM ${table} WHERE company_id=? AND recurring_entry_id=?`, [companyId, entry.id]);
    const launched = new Set(existing.map((row) => row.competence).filter(Boolean));

    for (const occurrence of due) {
      if (launched.has(occurrence.competence)) {
        result.skipped++;
        continue;
      }
      const id = generatedEntryId(entry.id, occurrence.competence);
      const description = occurrenceDescription(entry.description, occurrence.competence);
      const common = [roundMoney(Number(entry.amount) || 0), occurrence.dueDate, "aberta", entry.cost_center_id ?? null, entry.category_id ?? null, entry.bank_account_id ?? null, today, occurrence.competence, "recurring_entry", entry.id, entry.id, 0];
      const written =
        entry.kind === "pagar"
          ? await db.execute(
              "INSERT OR IGNORE INTO payables (id, company_id, description, supplier_id, amount, due_date, status, cost_center_id, category_id, bank_account_id, issue_date, competence, ref_type, ref_id, recurring_entry_id, paid_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              [id, companyId, description, entry.supplier_id ?? null, ...common],
            )
          : await db.execute(
              "INSERT OR IGNORE INTO receivables (id, company_id, description, customer_id, amount, due_date, status, cost_center_id, category_id, bank_account_id, issue_date, competence, ref_type, ref_id, recurring_entry_id, received_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              [id, companyId, description, entry.customer_id ?? null, ...common],
            );
      if (rowsAffected(written) > 0) {
        result.created++;
        (entry.kind === "pagar" ? result.payableIds : result.receivableIds).push(id);
      } else {
        result.skipped++;
      }
    }

    const last = due[due.length - 1].competence;
    if (last !== entry.last_competence) {
      await db.execute("UPDATE recurring_entries SET last_competence=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [last, companyId, entry.id]);
    }
  }
  return result;
}
