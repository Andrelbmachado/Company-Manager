// Pastas de nuvem nos testes: o mesmo contrato do adaptador do Tauri (lib/files/tauriCloudFs.ts), mas lendo e gravando
// de verdade numa pasta temporária com node:fs. Assim os testes usam links simbólicos reais (para dentro e para fora
// da pasta conectada) e conferem o que ficou em disco.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { lstat, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CloudFileInfo, CloudFs } from "@/lib/files/cloudFolders";

function info(stats: import("node:fs").Stats): CloudFileInfo {
  return { isDirectory: stats.isDirectory(), isFile: stats.isFile(), isSymlink: stats.isSymbolicLink(), size: stats.size, mtime: stats.mtime };
}

export function createNodeCloudFs(): CloudFs {
  return {
    async readDir(dir) {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory(), isFile: entry.isFile(), isSymlink: entry.isSymbolicLink() }));
    },
    async stat(target) {
      return info(await stat(target));
    },
    async lstat(target) {
      return info(await lstat(target));
    },
    async exists(target) {
      try {
        await lstat(target);
        return true;
      } catch {
        return false;
      }
    },
    async readFile(target) {
      return new Uint8Array(await readFile(target));
    },
    async writeNewFile(target, bytes) {
      // "wx": falha se já existe (o mesmo createNew do plugin-fs).
      await writeFile(target, bytes, { flag: "wx" });
    },
  };
}

export interface TempHome {
  /** Pasta temporária que faz o papel da home do Mac. */
  readonly home: string;
  /** Caminho absoluto dentro da home. */
  at(...parts: string[]): string;
  /** Cria as pastas (relativas à home) e devolve o caminho absoluto. */
  mkdir(...parts: string[]): string;
  dispose(): void;
}

export function createTempHome(): TempHome {
  const home = mkdtempSync(path.join(os.tmpdir(), "cm-cloud-"));
  const at = (...parts: string[]) => path.join(home, ...parts);
  return {
    home,
    at,
    mkdir(...parts) {
      const dir = at(...parts);
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    dispose() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}
