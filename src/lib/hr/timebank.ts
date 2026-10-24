// Banco de horas (hr_time_entries, 0008): minutos positivos = crédito (hora extra), negativos = débito (compensação).
// Só lançamentos aprovados entram no saldo; pendentes aparecem à parte e recusados não contam.
// As funções com `db` recebem o banco (getDb() da tela ou o SQLite dos testes); o SQL segue os padrões do banco demo.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import type { HrTimeEntry } from "@/types";

export interface TimeBankSummary {
  /** Saldo aprovado (créditos + débitos aprovados), em minutos. */
  balance: number;
  credits: number;
  /** Negativo (soma dos débitos aprovados). */
  debits: number;
  /** Soma dos lançamentos pendentes (ainda fora do saldo). */
  pending: number;
  pendingCount: number;
}

type EntryLike = Pick<HrTimeEntry, "minutes" | "status">;

export function timeBankSummary(entries: readonly EntryLike[]): TimeBankSummary {
  const summary: TimeBankSummary = { balance: 0, credits: 0, debits: 0, pending: 0, pendingCount: 0 };
  for (const entry of entries) {
    const minutes = Math.round(Number(entry.minutes) || 0);
    if (entry.status === "aprovada") {
      summary.balance += minutes;
      if (minutes > 0) summary.credits += minutes;
      else summary.debits += minutes;
    } else if (entry.status === "pendente") {
      summary.pending += minutes;
      summary.pendingCount += 1;
    }
  }
  return summary;
}

export function timeBankByEmployee(entries: readonly (EntryLike & Pick<HrTimeEntry, "employee_id">)[]): Map<string, TimeBankSummary> {
  const groups = new Map<string, EntryLike[]>();
  for (const entry of entries) groups.set(entry.employee_id, [...(groups.get(entry.employee_id) ?? []), entry]);
  return new Map([...groups].map(([employeeId, list]) => [employeeId, timeBankSummary(list)]));
}

/** 150 → "+2h30", −60 → "−1h00", 0 → "0h00". `signed: false` mostra só o tamanho (sem sinal). */
export function formatMinutes(minutes: number, options: { signed?: boolean } = {}): string {
  const signed = options.signed ?? true;
  const total = Math.round(Math.abs(minutes));
  const text = `${Math.floor(total / 60)}h${String(total % 60).padStart(2, "0")}`;
  if (!signed || total === 0) return text;
  return `${minutes < 0 ? "−" : "+"}${text}`;
}

/**
 * Duração digitada → minutos (negativo = débito). Aceita "2:30", "2h30", "2h", "45min", "45m", "1,5" e "1.5" (horas
 * decimais), com "-"/"−" ou "+" na frente. Texto sem duração ou com minutos ≥ 60 → null.
 */
export function parseDuration(text: string): number | null {
  const raw = text.trim().replace(/\s+/g, "").toLowerCase();
  const match = raw.match(/^([+\-−]?)(.*)$/);
  if (!match) return null;
  const sign = match[1] === "-" || match[1] === "−" ? -1 : 1;
  const body = match[2];
  let minutes: number | null = null;
  let parts: RegExpMatchArray | null;
  if ((parts = body.match(/^(\d+):(\d{1,2})$/))) minutes = Number(parts[2]) < 60 ? Number(parts[1]) * 60 + Number(parts[2]) : null;
  else if ((parts = body.match(/^(\d+)h(\d{1,2})?(?:min|m)?$/))) minutes = !parts[2] || Number(parts[2]) < 60 ? Number(parts[1]) * 60 + Number(parts[2] ?? 0) : null;
  else if ((parts = body.match(/^(\d+)(?:min|m)$/))) minutes = Number(parts[1]);
  else if ((parts = body.match(/^(\d+)(?:[.,](\d+))?$/))) minutes = Math.round(Number(`${parts[1]}.${parts[2] ?? "0"}`) * 60);
  return minutes === null ? null : sign * minutes;
}

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** Até quantos dias à frente uma compensação (débito) pode ser combinada. */
export const MAX_DAYS_AHEAD = 60;

/** Regras de um lançamento. Hora extra (crédito) só até hoje; compensação pode ser combinada para os próximos dias. */
export function validateTimeEntry(input: { date: string; minutes: number | null; reason: string }, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Informe a data do lançamento.";
  if (input.minutes === null || !Number.isFinite(input.minutes) || input.minutes === 0) return "Informe a duração (ex.: 1:30 para hora extra, -2:00 para compensação).";
  if (Math.abs(input.minutes) > 24 * 60) return "Um lançamento não pode passar de 24 horas.";
  if (!input.reason.trim()) return "Informe o motivo.";
  const offset = dayNumber(input.date) - dayNumber(today);
  if (input.minutes > 0 && offset > 0) return "Hora extra não pode ter data no futuro.";
  if (offset > MAX_DAYS_AHEAD) return `A compensação pode ser combinada para no máximo ${MAX_DAYS_AHEAD} dias à frente.`;
  if (offset < -365) return "O lançamento não pode ter mais de 1 ano.";
  return null;
}

// ── Banco ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function fetchTimeEntries(db: DatabaseLike, companyId: string): Promise<HrTimeEntry[]> {
  return db.select<HrTimeEntry[]>("SELECT * FROM hr_time_entries WHERE company_id=? AND deleted_at IS NULL ORDER BY entry_date DESC", [companyId]);
}

export async function fetchEmployeeTimeEntries(db: DatabaseLike, companyId: string, employeeId: string): Promise<HrTimeEntry[]> {
  return db.select<HrTimeEntry[]>("SELECT * FROM hr_time_entries WHERE company_id=? AND employee_id=? AND deleted_at IS NULL ORDER BY entry_date DESC", [companyId, employeeId]);
}

export interface NewTimeEntry {
  employeeId: string;
  date: string;
  minutes: number | null;
  reason: string;
}

/**
 * Grava um lançamento. Quem é do RH lança já aprovado (`approvedBy` = quem lançou); o colaborador lança pendente
 * (o RH aprova ou recusa em Gestão de RH > Banco de horas). Devolve o id.
 */
export async function addTimeEntry(db: DatabaseLike, companyId: string, input: NewTimeEntry, actorId: string, today: string, approvedBy: string | null = null): Promise<string> {
  const problem = validateTimeEntry({ date: input.date, minutes: input.minutes, reason: input.reason }, today);
  if (problem) throw new Error(problem);
  const id = uuidv4();
  const decidedAt = approvedBy ? new Date().toISOString() : null;
  await db.execute(
    "INSERT INTO hr_time_entries (id, company_id, employee_id, entry_date, minutes, reason, status, decided_by, decided_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, companyId, input.employeeId, input.date, input.minutes, input.reason.trim(), approvedBy ? "aprovada" : "pendente", approvedBy, decidedAt, actorId],
  );
  return id;
}

/** Aprova ou recusa um lançamento pendente. Confere no banco (outra pessoa pode ter decidido antes). */
export async function decideTimeEntry(db: DatabaseLike, companyId: string, id: string, approve: boolean, actorId: string): Promise<void> {
  const [current] = await db.select<HrTimeEntry[]>("SELECT * FROM hr_time_entries WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, id]);
  if (!current) throw new Error("Lançamento não encontrado.");
  if (current.status !== "pendente") throw new Error("Este lançamento já foi decidido.");
  await db.execute(
    "UPDATE hr_time_entries SET status=?, decided_by=?, decided_at=?, updated_at=datetime('now') WHERE company_id=? AND id=? AND status='pendente'",
    [approve ? "aprovada" : "recusada", actorId, new Date().toISOString(), companyId, id],
  );
}

/** O colaborador desiste de um lançamento ainda pendente (soft delete; decidido não se apaga). */
export async function withdrawTimeEntry(db: DatabaseLike, companyId: string, id: string, employeeId: string): Promise<void> {
  const [current] = await db.select<HrTimeEntry[]>("SELECT * FROM hr_time_entries WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, id]);
  if (!current || current.employee_id !== employeeId) throw new Error("Lançamento não encontrado.");
  if (current.status !== "pendente") throw new Error("Só dá para retirar lançamento ainda pendente.");
  await db.execute("UPDATE hr_time_entries SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE company_id=? AND id=? AND status='pendente'", [companyId, id]);
}
