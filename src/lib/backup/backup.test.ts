// Camada TypeScript do backup: chama os comandos Tauri (backup_db, list_backups, restore_db, restart_app) e decide o
// backup automático diário. A cópia e a restauração em si (zip, VACUUM INTO, validação de versão) são testadas em Rust
// (src-tauri/src/backup.rs, `cargo test --lib backup`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupInfo, RestoreInfo } from "@/types";

const { invoke, getDb, isTauriRuntime } = vi.hoisted(() => ({
  invoke: vi.fn(),
  getDb: vi.fn(),
  isTauriRuntime: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/lib/db/client", () => ({ getDb, isTauriRuntime }));

import {
  backupKind,
  backupToFile,
  describeBackupError,
  formatBytes,
  listBackups,
  needsDailyBackup,
  runDailyBackup,
  startDailyBackup,
  suggestedBackupFileName,
  type BackupEntry,
} from "./backup";
import { restoreFromFile } from "./restore";

function info(overrides: Partial<BackupEntry> = {}): BackupEntry {
  return {
    path: "/app/backups/company-manager-20261024-100000-manual.cmbackup",
    file_name: "company-manager-20261024-100000-manual.cmbackup",
    size_bytes: 2048,
    created_at: new Date(2026, 9, 24, 10, 0).toISOString(),
    schema_version: 11,
    automatic: false,
    kind: "manual",
    files_count: 0,
    ...overrides,
  };
}

const at = (day: number, hour = 10) => new Date(2026, 9, day, hour, 0);

beforeEach(() => {
  invoke.mockReset();
  getDb.mockReset().mockResolvedValue({});
  isTauriRuntime.mockReset().mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("backupToFile / listBackups", () => {
  it("pede o backup ao app desktop no destino escolhido (ou na pasta do app, sem destino)", async () => {
    invoke.mockResolvedValueOnce(info({ path: "/Users/x/Documentos/copia.cmbackup" }));
    const saved = await backupToFile("/Users/x/Documentos/copia");
    expect(invoke).toHaveBeenCalledWith("backup_db", { destPath: "/Users/x/Documentos/copia", automatic: false });
    expect(saved.path).toBe("/Users/x/Documentos/copia.cmbackup");

    invoke.mockResolvedValueOnce(info());
    await backupToFile();
    expect(invoke).toHaveBeenLastCalledWith("backup_db", { destPath: null, automatic: false });
  });

  it("lista os backups com o tipo (o app antigo só dizia se era automático)", async () => {
    const legacy: BackupInfo = { ...info(), automatic: true };
    delete (legacy as Partial<BackupEntry>).kind;
    invoke.mockResolvedValueOnce([info({ kind: "antes_da_restauracao" }), legacy]);
    const list = await listBackups();
    expect(invoke).toHaveBeenCalledWith("list_backups");
    expect(list.map((entry) => entry.kind)).toEqual(["antes_da_restauracao", "automatico"]);
    expect(backupKind({ ...info(), automatic: false, kind: undefined as never })).toBe("manual");
  });

  it("no navegador (banco demo) não há backup: avisa em vez de chamar o app", async () => {
    isTauriRuntime.mockReturnValue(false);
    await expect(backupToFile()).rejects.toThrow(/app desktop/);
    await expect(listBackups()).resolves.toEqual([]);
    await expect(restoreFromFile("/x.cmbackup")).rejects.toThrow(/app desktop/);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("backup automático diário", () => {
  it("precisa de backup quando ainda não há um automático com a data local de hoje", () => {
    const today = at(24, 15);
    expect(needsDailyBackup([], today)).toBe(true);
    expect(needsDailyBackup([info({ kind: "automatico", automatic: true, created_at: at(24, 0).toISOString() })], today)).toBe(false);
    // Manual e "antes de restaurar" de hoje não contam; automático de ontem também não.
    expect(
      needsDailyBackup(
        [
          info({ kind: "manual", created_at: at(24, 9).toISOString() }),
          info({ kind: "antes_da_restauracao", created_at: at(24, 9).toISOString() }),
          info({ kind: "automatico", automatic: true, created_at: at(23, 23).toISOString() }),
        ],
        today,
      ),
    ).toBe(true);
  });

  it("usa o dia local, não o dia UTC do created_at", () => {
    // 23h50 locais do dia 23 podem ser dia 24 em UTC (Brasil): ainda é o backup do dia 23.
    const lateNight = new Date(2026, 9, 23, 23, 50);
    const backups = [info({ kind: "automatico", automatic: true, created_at: lateNight.toISOString() })];
    expect(needsDailyBackup(backups, at(23, 23))).toBe(false);
    expect(needsDailyBackup(backups, at(24, 0))).toBe(true);
  });

  it("abre o banco antes (migrations aplicadas), faz um automático e não repete no mesmo dia", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "list_backups") return [];
      if (command === "backup_db") return info({ kind: "automatico", automatic: true });
      throw new Error(`comando inesperado ${command}`);
    });
    const created = await runDailyBackup(at(24));
    expect(getDb).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("backup_db", { destPath: null, automatic: true });
    expect(created?.kind).toBe("automatico");

    invoke.mockReset().mockImplementation(async (command: string) => (command === "list_backups" ? [info({ kind: "automatico", automatic: true, created_at: at(24, 8).toISOString() })] : null));
    await expect(runDailyBackup(at(24, 18))).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("backup_db", expect.anything());
  });

  it("chamadas simultâneas fazem um backup só", async () => {
    invoke.mockImplementation(async (command: string) => (command === "list_backups" ? [] : info({ kind: "automatico", automatic: true })));
    await Promise.all([runDailyBackup(at(24)), runDailyBackup(at(24)), runDailyBackup(at(24))]);
    expect(invoke.mock.calls.filter(([command]) => command === "backup_db")).toHaveLength(1);
  });

  it("no navegador não faz nada", async () => {
    isTauriRuntime.mockReturnValue(false);
    await expect(runDailyBackup(at(24))).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("o agendador roda depois de um intervalo, repete de hora em hora e engole erros (só avisa no console)", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    invoke.mockImplementation(async (command: string) => {
      if (command === "list_backups") throw "pasta de backups sem permissão";
      return null;
    });
    const stop = startDailyBackup({ delayMs: 1000, intervalMs: 60_000 });
    expect(invoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("backup automático"), "pasta de backups sem permissão");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(invoke).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(invoke).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("restoreFromFile", () => {
  it("restaura e reinicia o app", async () => {
    const restored: RestoreInfo = { restored_from: "/b.cmbackup", safety_backup: info({ kind: "antes_da_restauracao" }), schema_version: 11, restart_required: true };
    invoke.mockImplementation(async (command: string) => (command === "restore_db" ? restored : undefined));
    await expect(restoreFromFile("/b.cmbackup")).resolves.toEqual(restored);
    expect(invoke.mock.calls).toEqual([["restore_db", { srcPath: "/b.cmbackup" }], ["restart_app"]]);
  });

  it("erro do app (arquivo corrompido, versão mais nova) chega com a mensagem e não reinicia", async () => {
    invoke.mockRejectedValueOnce("O backup está corrompido ou incompleto e não pode ser restaurado. O banco atual não foi alterado.");
    const error = await restoreFromFile("/ruim.cmbackup").catch((reason: unknown) => reason);
    expect(describeBackupError(error)).toContain("corrompido");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("restart: false deixa para quem chamou reiniciar", async () => {
    invoke.mockResolvedValueOnce({ restored_from: "/b.cmbackup", safety_backup: null, schema_version: 11, restart_required: true });
    await restoreFromFile("/b.cmbackup", { restart: false });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("utilitários", () => {
  it("sugere nome de arquivo com data e hora locais", () => {
    expect(suggestedBackupFileName(new Date(2026, 9, 24, 9, 5))).toBe("company-manager-backup-2026-10-24-0905.cmbackup");
  });

  it("formata tamanho em pt-BR", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(1.25 * 1024 * 1024 * 1024)).toBe("1,3 GB");
  });

  it("explica o erro venha ele como texto (comando Tauri) ou Error", () => {
    expect(describeBackupError("falhou")).toBe("falhou");
    expect(describeBackupError(new Error("quebrou"))).toBe("quebrou");
    expect(describeBackupError(undefined)).toMatch(/erro/i);
  });
});
