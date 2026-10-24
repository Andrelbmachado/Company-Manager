// Armazenamento de arquivos para testes: grava de verdade numa pasta temporária (mesmo layout de $APPDATA/files),
// para os testes contarem os arquivos em disco (dedupe) e corromperem um arquivo de propósito.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FileBackend } from "@/lib/files/backend";

export interface DiskFileBackend extends FileBackend {
  /** Pasta temporária (equivale a $APPDATA). */
  readonly root: string;
  /** Caminho absoluto do arquivo de uma storage_key. */
  pathFor(key: string): string;
  /** storage_keys gravadas em disco, em ordem. */
  listFiles(): string[];
  /** Apaga a pasta temporária. */
  dispose(): void;
}

export function createDiskFileBackend(): DiskFileBackend {
  const root = mkdtempSync(path.join(os.tmpdir(), "cm-files-"));
  const base = path.join(root, "files");
  const pathFor = (key: string) => path.join(base, ...key.split("/"));

  function walk(dir: string, prefix: string[]): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full, [...prefix, name]) : [[...prefix, name].join("/")];
    });
  }

  return {
    kind: "disco (teste)",
    persistent: true,
    root,
    pathFor,
    async exists(key) {
      return existsSync(pathFor(key));
    },
    async size(key) {
      const file = pathFor(key);
      return existsSync(file) ? statSync(file).size : null;
    },
    async write(key, bytes) {
      const file = pathFor(key);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(`${file}.part`, bytes);
      renameSync(`${file}.part`, file);
    },
    async read(key) {
      const file = pathFor(key);
      if (!existsSync(file)) throw new Error(`arquivo ausente: ${key}`);
      return new Uint8Array(readFileSync(file));
    },
    async remove(key) {
      const file = pathFor(key);
      if (existsSync(file)) unlinkSync(file);
    },
    listFiles() {
      return walk(base, []).sort();
    },
    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
