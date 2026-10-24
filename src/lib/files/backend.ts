// Onde ficam os bytes dos documentos. A chave (documents.storage_key) é "<companyId>/<sha256[0..2]>/<sha256>",
// relativa à pasta de arquivos: no desktop, $APPDATA/files/<chave> (tauriStore.ts); no navegador, IndexedDB (demoStore.ts).
// O nome do arquivo nunca entra no caminho: é o hash do conteúdo, então mesmo conteúdo = mesmo arquivo (dedupe).

export interface FileBackend {
  /** Onde os bytes ficam, para mensagens ("disco", "navegador"...). */
  readonly kind: string;
  /** false = os arquivos somem ao recarregar a página (navegador sem IndexedDB). */
  readonly persistent: boolean;
  exists(key: string): Promise<boolean>;
  /** Tamanho em bytes, ou null se não existe. */
  size(key: string): Promise<number | null>;
  write(key: string, bytes: Uint8Array): Promise<void>;
  /** Lê os bytes; falha se não existe. */
  read(key: string): Promise<Uint8Array>;
  /** Apaga; não falha se já não existe. */
  remove(key: string): Promise<void>;
}

const COMPANY_ID = /^[A-Za-z0-9_-]{1,100}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const STORAGE_KEY = /^[A-Za-z0-9_-]{1,100}\/[0-9a-f]{2}\/[0-9a-f]{64}$/;

export function isValidCompanyId(companyId: string): boolean {
  return COMPANY_ID.test(companyId);
}

/** Chave válida: só empresa/xx/hash, nada de "..", barra inicial ou outro separador. */
export function isValidStorageKey(key: string | null | undefined): key is string {
  return typeof key === "string" && STORAGE_KEY.test(key);
}

export function storageKeyFor(companyId: string, sha256: string): string {
  if (!isValidCompanyId(companyId) || !SHA256.test(sha256)) throw new Error("Chave de armazenamento inválida.");
  return `${companyId}/${sha256.slice(0, 2)}/${sha256}`;
}

export interface MemoryFileBackend extends FileBackend {
  /** Chaves gravadas, em ordem. */
  keys(): string[];
}

/** Bytes em memória: testes e navegador sem IndexedDB (somem ao recarregar). */
export function createMemoryFileBackend(kind = "memória"): MemoryFileBackend {
  const blobs = new Map<string, Uint8Array>();
  return {
    kind,
    persistent: false,
    async exists(key) {
      return blobs.has(key);
    },
    async size(key) {
      return blobs.get(key)?.byteLength ?? null;
    },
    async write(key, bytes) {
      blobs.set(key, bytes.slice());
    },
    async read(key) {
      const bytes = blobs.get(key);
      if (!bytes) throw new Error(`arquivo ausente: ${key}`);
      return bytes.slice();
    },
    async remove(key) {
      blobs.delete(key);
    },
    keys() {
      return [...blobs.keys()].sort();
    },
  };
}
