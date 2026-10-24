// Bytes dos documentos no app desktop: $APPDATA/files/<companyId>/<sha256[0..2]>/<sha256> (tauri-plugin-fs).
// capabilities/default.json libera ler, gravar, renomear, apagar e mkdir só em $APPDATA/**; o backup (.cmbackup) leva a
// pasta files/ junto com o banco.
import { BaseDirectory, exists, mkdir, readFile, remove, rename, stat, writeFile } from "@tauri-apps/plugin-fs";
import type { FileBackend } from "./backend";

/** Pasta dos arquivos dentro de $APPDATA. */
export const FILES_DIR = "files";

const inAppData = { baseDir: BaseDirectory.AppData };
const pathFor = (key: string) => `${FILES_DIR}/${key}`;
const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

export const tauriFileBackend: FileBackend = {
  kind: "disco",
  persistent: true,
  async exists(key) {
    return exists(pathFor(key), inAppData);
  },
  async size(key) {
    const path = pathFor(key);
    if (!(await exists(path, inAppData))) return null;
    return (await stat(path, inAppData)).size;
  },
  async write(key, bytes) {
    const path = pathFor(key);
    await mkdir(parentOf(path), { ...inAppData, recursive: true });
    // Grava num .part e renomeia: um arquivo cortado no meio (app fechado, disco cheio) nunca fica com o nome final,
    // que o dedupe trataria como pronto.
    const partial = `${path}.${Date.now().toString(36)}.part`;
    await writeFile(partial, bytes, inAppData);
    try {
      await rename(partial, path, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData });
    } catch (error) {
      await remove(partial, inAppData).catch(() => undefined);
      throw error;
    }
  },
  async read(key) {
    return readFile(pathFor(key), inAppData);
  },
  async remove(key) {
    const path = pathFor(key);
    if (await exists(path, inAppData)) await remove(path, inAppData);
  },
};
