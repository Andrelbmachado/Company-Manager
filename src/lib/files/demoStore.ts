// Bytes dos documentos no navegador (banco demo): IndexedDB, porque o localStorage do banco demo tem só ~5 MB.
// Chave = documents.storage_key. Sem IndexedDB (janela privada antiga, bloqueio do navegador), cai para a memória:
// funciona até recarregar a página, e `persistent: false` deixa a tela avisar.
import { createMemoryFileBackend, type FileBackend } from "./backend";

const DB_NAME = "cm_demo_files_v1";
const STORE = "blobs";

let backend: FileBackend | null = null;
let opening: Promise<IDBDatabase> | null = null;

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha no IndexedDB."));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o IndexedDB."));
    request.onblocked = () => reject(new Error("IndexedDB bloqueado por outra aba."));
  }).catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

async function withStore<T>(factory: IDBFactory, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase(factory);
  const transaction = db.transaction(STORE, mode);
  const result = promisify(run(transaction.objectStore(STORE)));
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Falha no IndexedDB."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Gravação cancelada pelo navegador (espaço insuficiente?)."));
  });
  return result;
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function indexedDbBackend(factory: IDBFactory): FileBackend {
  return {
    kind: "navegador (IndexedDB)",
    persistent: true,
    async exists(key) {
      return (await withStore(factory, "readonly", (store) => store.count(key))) > 0;
    },
    async size(key) {
      return toBytes(await withStore(factory, "readonly", (store) => store.get(key)))?.byteLength ?? null;
    },
    async write(key, bytes) {
      // Grava um ArrayBuffer próprio (cópia): o IndexedDB clona o valor, e uma view parcial levaria o buffer inteiro.
      await withStore(factory, "readwrite", (store) => store.put(bytes.slice().buffer, key));
    },
    async read(key) {
      const bytes = toBytes(await withStore(factory, "readonly", (store) => store.get(key)));
      if (!bytes) throw new Error(`arquivo ausente: ${key}`);
      return bytes;
    },
    async remove(key) {
      await withStore(factory, "readwrite", (store) => store.delete(key));
    },
  };
}

/**
 * Armazenamento do navegador (um por página). Se o IndexedDB não existe ou não abre (Firefox em janela privada, cota
 * bloqueada), passa a usar a memória até recarregar a página, e `persistent` vira false.
 */
export function demoFileBackend(): FileBackend {
  if (backend) return backend;
  const memory = createMemoryFileBackend("memória do navegador");
  const factory = typeof indexedDB === "undefined" ? null : indexedDB;
  let current: FileBackend = factory ? indexedDbBackend(factory) : memory;
  let checked = !factory;

  async function resolve(): Promise<FileBackend> {
    if (checked) return current;
    try {
      await openDatabase(factory!);
    } catch (error) {
      console.warn("[arquivos] IndexedDB indisponível; arquivos ficam só na memória desta página.", error);
      current = memory;
    }
    checked = true;
    return current;
  }

  backend = {
    get kind() {
      return current.kind;
    },
    get persistent() {
      return current.persistent;
    },
    exists: async (key) => (await resolve()).exists(key),
    size: async (key) => (await resolve()).size(key),
    write: async (key, bytes) => (await resolve()).write(key, bytes),
    read: async (key) => (await resolve()).read(key),
    remove: async (key) => (await resolve()).remove(key),
  };
  return backend;
}
