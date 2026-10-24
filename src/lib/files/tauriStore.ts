// Bytes dos documentos no app desktop: $APPDATA/files/<companyId>/<sha256[0..2]>/<sha256> (tauri-plugin-fs).
// capabilities/default.json libera ler, gravar, renomear, apagar e mkdir só em $APPDATA/**; o backup (.cmbackup) leva a
// pasta files/ junto com o banco.
import { BaseDirectory, exists, mkdir, readFile, remove, rename, stat, writeFile } from "@tauri-apps/plugin-fs";
import { isValidStorageKey, type FileBackend } from "./backend";

/** Pasta dos arquivos dentro de $APPDATA. */
export const FILES_DIR = "files";

const inAppData = { baseDir: BaseDirectory.AppData };
const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

/** Caminho relativo a $APPDATA. Só chave válida: o escopo do fs libera $APPDATA inteiro, onde também está o banco. */
function pathFor(key: string): string {
  if (!isValidStorageKey(key)) throw new Error("Chave de armazenamento inválida.");
  return `${FILES_DIR}/${key}`;
}

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
    // que o dedupe trataria como pronto. O sufixo aleatório separa dois envios do mesmo conteúdo no mesmo instante.
    const partial = `${path}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.part`;
    try {
      await writeFile(partial, bytes, inAppData);
      await rename(partial, path, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData });
    } catch (error) {
      // Falha no meio da gravação (disco cheio) também deixa um pedaço do .part: apaga.
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
