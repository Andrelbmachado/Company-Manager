// Sincroniza uma agenda por link iCal (calendar_sources.kind = 'ical') com calendar_events: baixa o .ics, expande as
// recorrências numa janela (90 dias para trás, 1 ano para frente) e faz upsert por uid. Evento que sumiu da fonte
// recebe deleted_at; o que já terminou antes da janela fica como histórico. Falha (link fora do ar, 404, arquivo que
// não é agenda) grava uma mensagem legível em last_error e não apaga nada. SQL nos padrões do banco demo.
import { v4 as uuidv4 } from "uuid";
import type { CalendarRange } from "@/components/shared/CalendarView";
import { addDays, APP_TIME_ZONE, todayIn, zonedInstant } from "@/components/shared/calendar/layout";
import type { DatabaseLike } from "@/lib/db/demo";
import type { CalendarEvent, CalendarSource } from "@/types";
import { defaultCalendarFetcher, FETCH_TIMEOUT_MS, inTauri, type CalendarFetcher } from "./fetcher";
import { IcsError, parseIcs, type IcsOccurrence } from "./ical";

export type { CalendarFetcher } from "./fetcher";

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  /** Mensagem legível quando a sincronização falhou (a mesma gravada em last_error). */
  error?: string;
}

export interface SyncOptions {
  now?: Date;
  timeZone?: string;
  pastDays?: number;
  futureDays?: number;
}

export const SYNC_PAST_DAYS = 90;
export const SYNC_FUTURE_DAYS = 365;
/** Intervalo da sincronização automática com a tela aberta. */
export const SYNC_INTERVAL_MINUTES = 15;

/** Período gravado: de `pastDays` antes de hoje até um ano depois (fim exclusivo), dias no fuso do app. */
export function syncWindow(now = new Date(), timeZone = APP_TIME_ZONE, pastDays = SYNC_PAST_DAYS, futureDays = SYNC_FUTURE_DAYS): CalendarRange {
  const today = todayIn(now, timeZone);
  return { start: addDays(today, -pastDays), end: addDays(today, futureDays + 1) };
}

/** Link digitado → URL http(s) (webcal:// vira https://). Null se não for um link de agenda. */
export function normalizeCalendarUrl(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().replace(/^webcals?:\/\//i, "https://");
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    return url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}

class SyncFailure extends Error {}

function statusMessage(status: number): string {
  if (status === 404 || status === 410) return `Agenda não encontrada (${status}): o link foi apagado ou está errado.`;
  if (status === 401 || status === 403) return `Acesso negado (${status}): a agenda não é pública ou o endereço secreto foi trocado.`;
  if (status >= 500) return `O servidor da agenda está fora do ar (${status}). Tente de novo mais tarde.`;
  return `O link respondeu com erro ${status}.`;
}

function fetchErrorMessage(error: unknown): string {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/abort|timeout|timed out/i.test(text)) return "O link demorou demais para responder. Tente de novo mais tarde.";
  if (/plugin[\s\S]*not found|http\.fetch|not allowed|forbidden url|scope/i.test(text)) return "O app ainda não tem permissão para acessar a internet (plugin HTTP). Atualize o app para sincronizar agendas.";
  const base = "Não foi possível acessar o link: confira a internet e se o endereço está certo.";
  return typeof window !== "undefined" && !inTauri() ? `${base} No navegador, Google, iCloud e Outlook bloqueiam o acesso direto; no app desktop a sincronização funciona.` : base;
}

async function download(url: string, fetcher: CalendarFetcher): Promise<string> {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5" }, signal: controller?.signal });
  } catch (error) {
    throw new SyncFailure(fetchErrorMessage(error));
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!response.ok) throw new SyncFailure(statusMessage(response.status));
  try {
    return await response.text();
  } catch (error) {
    throw new SyncFailure(fetchErrorMessage(error));
  }
}

interface EventRow {
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: number;
  location: string | null;
  description: string | null;
  user_id: string | null;
}

const COMPARED: (keyof EventRow)[] = ["title", "starts_at", "ends_at", "all_day", "location", "description", "user_id"];

function rowFor(occurrence: IcsOccurrence, source: CalendarSource): EventRow {
  return {
    title: occurrence.title,
    starts_at: occurrence.start,
    ends_at: occurrence.end ?? null,
    all_day: occurrence.allDay ? 1 : 0,
    location: occurrence.location,
    description: occurrence.description,
    user_id: source.user_id ?? null,
  };
}

const blankToNull = (value: unknown) => (value === undefined || value === "" ? null : value);
const same = (key: keyof EventRow, a: unknown, b: unknown) => (key === "all_day" ? Number(a) === Number(b) : blankToNull(a) === blankToNull(b));

/** O evento gravado termina depois do início da janela (senão é histórico e fica). */
function endsAfter(event: CalendarEvent, windowStart: string, timeZone: string): boolean {
  if (Number(event.all_day) === 1) {
    const endDay = event.ends_at && event.ends_at > event.starts_at ? event.ends_at.slice(0, 10) : addDays(event.starts_at.slice(0, 10), 1);
    return endDay > windowStart;
  }
  const end = Date.parse(event.ends_at ?? event.starts_at);
  return Number.isNaN(end) || end > Date.parse(zonedInstant(windowStart, 0, timeZone));
}

async function loadSource(db: DatabaseLike, sourceId: string): Promise<CalendarSource> {
  const rows = await db.select<CalendarSource[]>("SELECT * FROM calendar_sources WHERE id = ? AND deleted_at IS NULL", [sourceId]);
  const source = rows[0];
  if (!source) throw new Error("Agenda não encontrada.");
  return source;
}

async function recordError(db: DatabaseLike, source: CalendarSource, message: string): Promise<SyncResult> {
  await db.execute("UPDATE calendar_sources SET last_error = ? WHERE id = ? AND company_id = ?", [message, source.id, source.company_id]);
  return { added: 0, updated: 0, removed: 0, error: message };
}

async function runSync(db: DatabaseLike, sourceId: string, fetcher: CalendarFetcher, options: SyncOptions): Promise<SyncResult> {
  const source = await loadSource(db, sourceId);
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? APP_TIME_ZONE;
  if (source.kind !== "ical") return recordError(db, source, "Esta agenda não é por link iCal.");
  const url = normalizeCalendarUrl(source.url);
  if (!url) return recordError(db, source, "Link da agenda inválido: use o endereço http(s) ou webcal do formato iCal (.ics).");

  const period = syncWindow(now, timeZone, options.pastDays, options.futureDays);
  let occurrences: IcsOccurrence[];
  try {
    const text = await download(url, fetcher);
    occurrences = parseIcs(text, period, { timeZone });
  } catch (error) {
    if (error instanceof SyncFailure || error instanceof IcsError) return recordError(db, source, error.message);
    throw error;
  }

  const stamp = now.toISOString();
  const existing = await db.select<CalendarEvent[]>("SELECT * FROM calendar_events WHERE company_id = ? AND source_id = ? AND deleted_at IS NULL", [source.company_id, source.id]);
  const byUid = new Map(existing.filter((event) => event.uid).map((event) => [event.uid as string, event]));
  const seen = new Set<string>();
  const result: SyncResult = { added: 0, updated: 0, removed: 0 };

  for (const occurrence of occurrences) {
    if (seen.has(occurrence.uid)) continue;
    seen.add(occurrence.uid);
    const row = rowFor(occurrence, source);
    const current = byUid.get(occurrence.uid);
    if (!current) {
      await db.execute(
        "INSERT INTO calendar_events (id, company_id, source_id, uid, title, starts_at, ends_at, all_day, location, description, user_id, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [uuidv4(), source.company_id, source.id, occurrence.uid, row.title, row.starts_at, row.ends_at, row.all_day, row.location, row.description, row.user_id, "externo", stamp, stamp],
      );
      result.added++;
    } else if (COMPARED.some((key) => !same(key, current[key as keyof CalendarEvent], row[key]))) {
      await db.execute(
        "UPDATE calendar_events SET title = ?, starts_at = ?, ends_at = ?, all_day = ?, location = ?, description = ?, user_id = ?, updated_at = ? WHERE id = ? AND company_id = ?",
        [row.title, row.starts_at, row.ends_at, row.all_day, row.location, row.description, row.user_id, stamp, current.id, source.company_id],
      );
      result.updated++;
    }
  }

  for (const event of existing) {
    if (!event.uid || seen.has(event.uid) || !endsAfter(event, period.start, timeZone)) continue;
    await db.execute("UPDATE calendar_events SET deleted_at = ?, updated_at = ? WHERE id = ? AND company_id = ?", [stamp, stamp, event.id, source.company_id]);
    result.removed++;
  }

  await db.execute("UPDATE calendar_sources SET last_sync_at = ?, last_error = NULL WHERE id = ? AND company_id = ?", [stamp, source.id, source.company_id]);
  return result;
}

// Uma sincronização por agenda de cada vez (abrir a tela e o intervalo de 15 min podem coincidir): a segunda chamada
// recebe o resultado da que já está rodando em vez de inserir os mesmos uids de novo.
const running = new WeakMap<object, Map<string, Promise<SyncResult>>>();

/**
 * Sincroniza a agenda `sourceId`. Erro de rede, de HTTP ou de conteúdo volta em `error` (e fica em last_error);
 * agenda inexistente ou excluída lança erro.
 */
export function syncSource(db: DatabaseLike, sourceId: string, fetcher: CalendarFetcher = defaultCalendarFetcher, options: SyncOptions = {}): Promise<SyncResult> {
  let perDb = running.get(db);
  if (!perDb) {
    perDb = new Map();
    running.set(db, perDb);
  }
  const current = perDb.get(sourceId);
  if (current) return current;
  const map = perDb;
  const promise = runSync(db, sourceId, fetcher, options).finally(() => map.delete(sourceId));
  map.set(sourceId, promise);
  return promise;
}

export interface CompanySyncEntry {
  sourceId: string;
  name: string;
  result: SyncResult;
}

/**
 * Sincroniza as agendas por link da empresa, uma por vez (uma com erro não impede as outras). Com
 * `olderThanMinutes`, pula as sincronizadas com sucesso há menos tempo que isso.
 */
export async function syncCompanySources(
  db: DatabaseLike,
  companyId: string,
  fetcher: CalendarFetcher = defaultCalendarFetcher,
  options: SyncOptions & { olderThanMinutes?: number } = {},
): Promise<CompanySyncEntry[]> {
  const now = options.now ?? new Date();
  const sources = await db.select<CalendarSource[]>("SELECT * FROM calendar_sources WHERE company_id = ? AND deleted_at IS NULL", [companyId]);
  const due = sources
    .filter((source) => source.kind === "ical")
    .filter((source) => {
      if (options.olderThanMinutes === undefined || !source.last_sync_at || source.last_error) return true;
      const last = Date.parse(source.last_sync_at);
      return Number.isNaN(last) || now.getTime() - last >= options.olderThanMinutes * 60_000;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id));
  const results: CompanySyncEntry[] = [];
  for (const source of due) {
    let result: SyncResult;
    try {
      result = await syncSource(db, source.id, fetcher, { ...options, now });
    } catch (error) {
      result = { added: 0, updated: 0, removed: 0, error: error instanceof Error ? error.message : String(error) };
    }
    results.push({ sourceId: source.id, name: source.name, result });
  }
  return results;
}
