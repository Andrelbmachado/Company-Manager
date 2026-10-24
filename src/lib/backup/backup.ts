// Backup do banco e dos anexos (só no app desktop). O trabalho pesado fica nos comandos Tauri de
// src-tauri/src/backup.rs: `.cmbackup` = zip com manifest.json, company-manager.db (VACUUM INTO) e files/.
// Aqui: chamar os comandos, decidir o backup automático diário (um por dia local; o Rust guarda os 14 mais recentes)
// e utilitários da tela (settings/pages/BackupPage.tsx).
import { invoke } from "@tauri-apps/api/core";
import { getDb, isTauriRuntime } from "@/lib/db/client";
import { todayIso } from "@/lib/utils";
import type { BackupInfo } from "@/types";

/** Tipo do backup (campo `kind` do Rust; o tipo `BackupInfo` de src/types só tem `automatic`). */
export type BackupKind = "manual" | "automatico" | "antes_da_restauracao";

export interface BackupEntry extends BackupInfo {
  kind: BackupKind;
  /** Anexos guardados no backup. */
  files_count: number;
}

export const BACKUP_EXTENSION = "cmbackup";
/** Backups automáticos guardados (o Rust apaga os mais antigos; os manuais nunca). */
export const KEEP_AUTOMATIC_BACKUPS = 14;
export const BACKUP_KIND_LABELS: Record<BackupKind, string> = {
  manual: "Manual",
  automatico: "Automático (diário)",
  antes_da_restauracao: "Antes de restaurar",
};
export const DESKTOP_ONLY_MESSAGE =
  "Backup e restauração funcionam só no app desktop. No navegador, os dados de demonstração ficam guardados apenas neste navegador.";

export function backupAvailable(): boolean {
  return isTauriRuntime();
}

function requireDesktop(): void {
  if (!backupAvailable()) throw new Error(DESKTOP_ONLY_MESSAGE);
}

type RawBackup = BackupInfo & { kind?: BackupKind | null; files_count?: number | null };

export function backupKind(info: RawBackup): BackupKind {
  return info.kind ?? (info.automatic ? "automatico" : "manual");
}

function normalize(info: RawBackup): BackupEntry {
  return { ...info, kind: backupKind(info), files_count: info.files_count ?? 0 };
}

/** Faz um backup agora: em `path` (escolhido em "salvar como"; ganha `.cmbackup`) ou na pasta de backups do app. */
export async function backupToFile(path?: string | null): Promise<BackupEntry> {
  requireDesktop();
  return normalize(await invoke<RawBackup>("backup_db", { destPath: path ?? null, automatic: false }));
}

/** Backups da pasta do app, do mais novo para o mais antigo. Vazio no navegador. */
export async function listBackups(): Promise<BackupEntry[]> {
  if (!backupAvailable()) return [];
  const list = await invoke<RawBackup[]>("list_backups");
  return list.map(normalize);
}

/** Dia local ("YYYY-MM-DD") de um instante ISO. */
function localDay(instant: string): string {
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? "" : todayIso(date);
}

/** Falta o backup automático de hoje (dia local)? Manuais e "antes de restaurar" não contam. */
export function needsDailyBackup(backups: readonly BackupEntry[], now = new Date()): boolean {
  const today = todayIso(now);
  return !backups.some((backup) => backup.kind === "automatico" && localDay(backup.created_at) === today);
}

let dailyInFlight: Promise<BackupEntry | null> | null = null;

/** Faz o backup automático do dia, se ainda não houver. Só no desktop; devolve o backup criado ou null. */
export function runDailyBackup(now = new Date()): Promise<BackupEntry | null> {
  if (!backupAvailable()) return Promise.resolve(null);
  dailyInFlight ??= (async () => {
    // O banco precisa existir e estar com as migrations aplicadas antes da cópia (o primeiro getDb() cuida disso).
    await getDb();
    if (!needsDailyBackup(await listBackups(), now)) return null;
    return normalize(await invoke<RawBackup>("backup_db", { destPath: null, automatic: true }));
  })().finally(() => {
    dailyInFlight = null;
  });
  return dailyInFlight;
}

/**
 * Agenda o backup automático: uma vez pouco depois de abrir o app e depois de hora em hora (o app aberto de um dia
 * para o outro também ganha o backup do dia). Erros só vão para o console. Devolve a função que para o agendamento.
 */
export function startDailyBackup(options: { delayMs?: number; intervalMs?: number } = {}): () => void {
  const { delayMs = 15_000, intervalMs = 60 * 60 * 1000 } = options;
  const run = () => {
    runDailyBackup().catch((error: unknown) => console.warn("[backup] backup automático não foi feito:", error));
  };
  const timeout = setTimeout(run, delayMs);
  const interval = setInterval(run, intervalMs);
  return () => {
    clearTimeout(timeout);
    clearInterval(interval);
  };
}

/** Nome sugerido no "salvar como": company-manager-backup-2026-10-24-0905.cmbackup (data e hora locais). */
export function suggestedBackupFileName(now = new Date()): string {
  const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return `company-manager-backup-${todayIso(now)}-${time}.${BACKUP_EXTENSION}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

/** Os comandos Tauri rejeitam com o texto do erro (string), não com Error. */
export function describeBackupError(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  return "Erro desconhecido no backup.";
}
