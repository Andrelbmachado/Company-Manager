// Armazenamento do app desktop ($APPDATA/files/<chave>) com o plugin fs simulado em memória: caminho, gravação
// atômica (.part + rename) e recusa de chave fora do formato (o escopo do fs libera $APPDATA inteiro, banco incluso).
import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => {
  const files = new Map<string, Uint8Array>();
  const missing = (path: string) => new Error(`arquivo inexistente: ${path}`);
  return {
    files,
    exists: vi.fn(async (path: string) => files.has(path)),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (path: string, data: Uint8Array) => {
      files.set(path, data.slice());
    }),
    rename: vi.fn(async (from: string, to: string) => {
      const data = files.get(from);
      if (!data) throw missing(from);
      files.delete(from);
      files.set(to, data);
    }),
    remove: vi.fn(async (path: string) => {
      if (!files.delete(path)) throw missing(path);
    }),
    readFile: vi.fn(async (path: string) => {
      const data = files.get(path);
      if (!data) throw missing(path);
      return data.slice();
    }),
    stat: vi.fn(async (path: string) => {
      const data = files.get(path);
      if (!data) throw missing(path);
      return { size: data.byteLength };
    }),
  };
});

vi.mock("@tauri-apps/plugin-fs", async (original) => ({
  ...(await original<object>()),
  exists: fs.exists,
  mkdir: fs.mkdir,
  writeFile: fs.writeFile,
  rename: fs.rename,
  remove: fs.remove,
  readFile: fs.readFile,
  stat: fs.stat,
}));

import { BaseDirectory } from "@tauri-apps/plugin-fs";
import { tauriFileBackend } from "./tauriStore";

const SHA = "ab".repeat(32);
const KEY = `empresa-1/ab/${SHA}`;
const FINAL = `files/${KEY}`;
const inAppData = { baseDir: BaseDirectory.AppData };

beforeEach(() => {
  fs.files.clear();
  vi.clearAllMocks();
});

describe("tauriFileBackend", () => {
  it("grava em $APPDATA/files/<empresa>/<aa>/<sha> passando por um .part, e lê, mede e apaga", async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    await tauriFileBackend.write(KEY, bytes);

    expect(fs.mkdir).toHaveBeenCalledWith("files/empresa-1/ab", { ...inAppData, recursive: true });
    const [partial, , writeOptions] = fs.writeFile.mock.calls[0] as unknown as [string, Uint8Array, object];
    expect(partial).toMatch(new RegExp(`^${FINAL}\\.[a-z0-9]+\\.part$`));
    expect(writeOptions).toEqual(inAppData);
    expect(fs.rename).toHaveBeenCalledWith(partial, FINAL, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData });
    expect([...fs.files.keys()]).toEqual([FINAL]);

    expect(await tauriFileBackend.exists(KEY)).toBe(true);
    expect(await tauriFileBackend.size(KEY)).toBe(4);
    expect(Array.from(await tauriFileBackend.read(KEY))).toEqual([1, 2, 3, 4]);
    await tauriFileBackend.remove(KEY);
    expect(await tauriFileBackend.size(KEY)).toBeNull();
    await expect(tauriFileBackend.remove(KEY)).resolves.toBeUndefined();
  });

  it("falha no meio da gravação (disco cheio) ou ao renomear não deixa .part nem arquivo final", async () => {
    fs.writeFile.mockImplementationOnce(async (path: string) => {
      fs.files.set(path, Uint8Array.from([1])); // pedaço gravado antes do erro
      throw new Error("No space left on device");
    });
    await expect(tauriFileBackend.write(KEY, Uint8Array.from([1, 2, 3]))).rejects.toThrow(/No space left/);
    expect([...fs.files.keys()]).toEqual([]);

    fs.rename.mockRejectedValueOnce(new Error("rename falhou"));
    await expect(tauriFileBackend.write(KEY, Uint8Array.from([1, 2, 3]))).rejects.toThrow(/rename falhou/);
    expect([...fs.files.keys()]).toEqual([]);
  });

  it("chave fora do formato <empresa>/<aa>/<sha256> nunca chega ao plugin (o escopo de $APPDATA inclui o banco)", async () => {
    for (const key of ["../company-manager.db", `empresa-1/ab/${SHA}/../../../company-manager.db`, "/etc/passwd", "", `empresa-1/ab/${SHA}.part`]) {
      await expect(tauriFileBackend.remove(key), key).rejects.toThrow(/inválida/);
      await expect(tauriFileBackend.read(key), key).rejects.toThrow(/inválida/);
      await expect(tauriFileBackend.write(key, Uint8Array.from([1])), key).rejects.toThrow(/inválida/);
      await expect(tauriFileBackend.exists(key), key).rejects.toThrow(/inválida/);
      await expect(tauriFileBackend.size(key), key).rejects.toThrow(/inválida/);
    }
    for (const fn of [fs.exists, fs.mkdir, fs.writeFile, fs.rename, fs.remove, fs.readFile, fs.stat]) expect(fn).not.toHaveBeenCalled();
  });
});
