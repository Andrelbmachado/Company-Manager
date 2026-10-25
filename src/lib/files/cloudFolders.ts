// Pastas de nuvem nos Documentos, sem login de terceiros: o app lê e grava na pasta que o app do serviço já sincroniza
// no Mac (iCloud Drive em ~/Library/Mobile Documents/com~apple~CloudDocs; Google Drive, OneDrive e Dropbox em
// ~/Library/CloudStorage/<Serviço>-<conta>). O cadastro fica em cloud_folders (migration 0012).
//
// Segurança: tudo passa por uma pasta conectada (raiz) mais nomes simples dentro dela. Nunca "..", caminho absoluto,
// item oculto ou link simbólico — o app não segue link nenhum, nem para dentro (não dá para saber para onde aponta sem
// realpath, que o plugin-fs não tem). A pasta de dados do próprio app (com.company.manager: banco, anexos, backups)
// nunca é conectada nem aberta, nem dentro de uma pasta conectada. O escopo do Tauri (capabilities/default.json) é a
// segunda barreira: ele resolve links e só libera as pastas de nuvem padrão, mais a pasta escolhida no seletor durante
// a sessão.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { can } from "@/lib/permissions/rbac";
import type { CloudFolder, CloudProvider, Role } from "@/types";
import { formatBytes } from "./format";
import { HARD_MAX_FILE_BYTES, readBlobBytes, sanitizeFileName } from "./store";
import { tauriCloudEnv, tauriCloudFs } from "./tauriCloudFs";

// ── Serviços ─────────────────────────────────────────────────────

export const CLOUD_PROVIDER_ORDER: readonly CloudProvider[] = ["icloud", "gdrive", "onedrive", "dropbox", "outro"];

export const CLOUD_PROVIDERS: Record<CloudProvider, { label: string; install: string }> = {
  icloud: {
    label: "iCloud Drive",
    install: "Ative o iCloud Drive em Ajustes do Sistema > [seu nome] > iCloud > iCloud Drive. A pasta fica em ~/Library/Mobile Documents/com~apple~CloudDocs.",
  },
  gdrive: {
    label: "Google Drive",
    install: "Instale o Google Drive para computador (google.com/drive/download) e entre com a conta. A pasta aparece em ~/Library/CloudStorage.",
  },
  onedrive: {
    label: "OneDrive",
    install: "Instale o OneDrive pela App Store (ou microsoft.com/onedrive/download) e entre com a conta. A pasta aparece em ~/Library/CloudStorage.",
  },
  dropbox: {
    label: "Dropbox",
    install: "Instale o Dropbox (dropbox.com/install) e entre com a conta. A pasta aparece em ~/Library/CloudStorage.",
  },
  outro: {
    label: "Outra pasta",
    install: "Qualquer pasta do Mac, inclusive de outro serviço de nuvem que sincroniza uma pasta local.",
  },
};

export const ICLOUD_RELATIVE = "Library/Mobile Documents/com~apple~CloudDocs";
export const CLOUD_STORAGE_RELATIVE = "Library/CloudStorage";
/** Pastas antigas, direto na home (Backup and Sync, OneDrive e Dropbox de antes do CloudStorage). */
const LEGACY_ROOTS: readonly [CloudProvider, string][] = [
  ["gdrive", "Google Drive"],
  ["onedrive", "OneDrive"],
  ["dropbox", "Dropbox"],
];

export interface DetectedCloudFolder {
  provider: CloudProvider;
  path: string;
  label: string;
}

const trimSlash = (value: string) => value.replace(/\/+$/, "");
const providerRank = (provider: CloudProvider) => CLOUD_PROVIDER_ORDER.indexOf(provider);
const compareNames = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });

/** Pasta de ~/Library/CloudStorage → serviço e conta ("GoogleDrive-ana@gmail.com", "OneDrive-Pessoal", "Dropbox"). */
function parseStorageEntry(name: string): { provider: CloudProvider; account: string | null } | null {
  const match = /^(GoogleDrive|OneDrive|Dropbox)(?:-(.+))?$/.exec(name);
  if (!match) return null;
  const provider: CloudProvider = match[1] === "GoogleDrive" ? "gdrive" : match[1] === "OneDrive" ? "onedrive" : "dropbox";
  if (provider === "gdrive" && !match[2]) return null;
  return { provider, account: match[2] ?? null };
}

const rootLabel = (provider: CloudProvider, account: string | null) => (account ? `${CLOUD_PROVIDERS[provider].label} (${account})` : CLOUD_PROVIDERS[provider].label);

/**
 * Pastas de nuvem que existem no Mac. `exists` responde se um caminho existe; `list` devolve os nomes dentro de uma
 * pasta (usado só em ~/Library/CloudStorage, onde o nome da pasta traz a conta). Ordem: iCloud, Google Drive,
 * OneDrive, Dropbox; dentro do serviço, pelo nome.
 */
export function detectCloudFolders(home: string, exists: (path: string) => boolean, list: (dir: string) => string[] = () => []): DetectedCloudFolder[] {
  const base = trimSlash(home);
  const found: DetectedCloudFolder[] = [];
  const icloud = `${base}/${ICLOUD_RELATIVE}`;
  if (exists(icloud)) found.push({ provider: "icloud", path: icloud, label: CLOUD_PROVIDERS.icloud.label });

  const storage = `${base}/${CLOUD_STORAGE_RELATIVE}`;
  let names: string[] = [];
  try {
    names = list(storage);
  } catch {
    names = [];
  }
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const entry = parseStorageEntry(name);
    if (entry) found.push({ provider: entry.provider, path: `${storage}/${name}`, label: rootLabel(entry.provider, entry.account) });
  }

  for (const [provider, folder] of LEGACY_ROOTS) {
    const legacy = `${base}/${folder}`;
    // O ~/Dropbox de hoje é atalho para o CloudStorage: com o novo achado, o antigo fica de fora.
    if (!found.some((item) => item.provider === provider) && exists(legacy)) found.push({ provider, path: legacy, label: CLOUD_PROVIDERS[provider].label });
  }

  return found.sort((a, b) => providerRank(a.provider) - providerRank(b.provider) || compareNames(a.label, b.label));
}

/** De qual serviço é a pasta (pelo caminho); fora das pastas padrão, "outro". */
export function providerForPath(home: string, localPath: string): CloudProvider {
  const base = trimSlash(home);
  const target = trimSlash(localPath);
  const inside = (root: string) => target === root || target.startsWith(`${root}/`);
  if (inside(`${base}/${ICLOUD_RELATIVE}`)) return "icloud";
  const storage = `${base}/${CLOUD_STORAGE_RELATIVE}`;
  if (target.startsWith(`${storage}/`)) return parseStorageEntry(target.slice(storage.length + 1).split("/")[0])?.provider ?? "outro";
  for (const [provider, folder] of LEGACY_ROOTS) if (inside(`${base}/${folder}`)) return provider;
  return "outro";
}

/** Nome sugerido: o do serviço (com a conta) quando é a pasta inteira do serviço; senão o nome da pasta. */
export function defaultCloudLabel(home: string, localPath: string): string {
  const base = trimSlash(home);
  const target = trimSlash(localPath);
  if (target === `${base}/${ICLOUD_RELATIVE}`) return CLOUD_PROVIDERS.icloud.label;
  const storage = `${base}/${CLOUD_STORAGE_RELATIVE}`;
  if (target.startsWith(`${storage}/`) && !target.slice(storage.length + 1).includes("/")) {
    const entry = parseStorageEntry(target.slice(storage.length + 1));
    if (entry) return rootLabel(entry.provider, entry.account);
  }
  for (const [provider, folder] of LEGACY_ROOTS) if (target === `${base}/${folder}`) return CLOUD_PROVIDERS[provider].label;
  return target.split("/").filter(Boolean).pop() ?? CLOUD_PROVIDERS.outro.label;
}

/** Onde o seletor de pasta abre para cada serviço: a pasta achada, senão a pasta padrão do serviço, senão a home. */
export function pickerStartPath(home: string, provider: CloudProvider, detected: DetectedCloudFolder[]): string {
  const base = trimSlash(home);
  const found = detected.find((item) => item.provider === provider);
  if (found) return found.path;
  if (provider === "icloud") return `${base}/${ICLOUD_RELATIVE}`;
  if (provider === "outro") return base;
  return `${base}/${CLOUD_STORAGE_RELATIVE}`;
}

// ── Erros e caminhos ─────────────────────────────────────────────

export type CloudFolderErrorCode = "invalid" | "outside" | "missing" | "no_access" | "not_dir" | "not_file" | "empty" | "too_large" | "unreadable" | "duplicate" | "forbidden" | "not_found";

/** Erro com mensagem pronta para a tela (pt-BR). */
export class CloudFolderError extends Error {
  readonly code: CloudFolderErrorCode;
  constructor(code: CloudFolderErrorCode, message: string) {
    super(message);
    this.name = "CloudFolderError";
    this.code = code;
  }
}

export function describeCloudError(error: unknown): string {
  if (error instanceof CloudFolderError) return error.message;
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return detail ? `Não foi possível concluir: ${detail}` : "Não foi possível concluir a operação na pasta da nuvem.";
}

/**
 * Pasta de dados do app no Mac ($APPDATA com o banco, anexos e backups; também caches e WebKit): mesmo nome do
 * identifier do tauri.conf.json. O disco do Mac não diferencia maiúsculas, então a comparação também não.
 */
const APP_FOLDER = "com.company.manager";
const isAppFolder = (name: string) => name.normalize("NFC").toLowerCase() === APP_FOLDER;

/** Caminho completo da pasta conectada, sem barra no fim. Recusa relativo, "~", ".", "..", a raiz e a pasta do app. */
export function normalizeLocalPath(localPath: string): string {
  const value = String(localPath ?? "").trim();
  if (!value) throw new CloudFolderError("invalid", "Escolha uma pasta.");
  if (!value.startsWith("/")) throw new CloudFolderError("invalid", "Use o caminho completo da pasta, começando com /.");
  if (value.includes("\u0000")) throw new CloudFolderError("invalid", "Caminho de pasta inválido.");
  const segments = value.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) throw new CloudFolderError("invalid", "Caminho com “.” ou “..” não é aceito: use o caminho completo da pasta.");
  if (segments.length === 0) throw new CloudFolderError("invalid", "A raiz do disco não pode ser conectada: escolha uma pasta.");
  if (segments.some(isAppFolder)) throw new CloudFolderError("invalid", "A pasta interna do Company Manager não pode ser conectada.");
  return `/${segments.join("/")}`;
}

/** Subpasta dentro da pasta conectada, como lista de nomes simples. */
export function cloudSubpath(relative: string | readonly string[]): string[] {
  let segments: string[];
  if (typeof relative === "string") {
    if (relative.startsWith("/")) throw new CloudFolderError("outside", "Caminho fora da pasta conectada.");
    segments = relative.split("/").filter(Boolean);
  } else {
    segments = [...relative];
  }
  for (const segment of segments) {
    if (!segment || segment.includes("/") || segment.includes("\u0000")) throw new CloudFolderError("invalid", "Nome de pasta ou arquivo inválido.");
    if (segment === "." || segment === "..") throw new CloudFolderError("outside", "Caminho com “..” sai da pasta conectada e não é aceito.");
    if (segment.startsWith(".")) throw new CloudFolderError("invalid", "Itens ocultos (nome começando com ponto) não são abertos pelo app.");
    if (isAppFolder(segment)) throw new CloudFolderError("invalid", "A pasta interna do Company Manager não é aberta pelas pastas de nuvem.");
  }
  return segments;
}

const joinPath = (root: string, segments: readonly string[]) => (segments.length ? `${root}/${segments.join("/")}` : root);

/** Chave para comparar pastas: o disco do Mac não diferencia maiúsculas nem a forma do acento. */
const pathKey = (localPath: string) => localPath.normalize("NFC").toLocaleLowerCase("pt-BR");

// ── Disco ────────────────────────────────────────────────────────

export interface CloudFileInfo {
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  mtime: Date | null;
}

export interface CloudDirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

/** O que o app usa do disco (Tauri: tauriCloudFs.ts; testes: src/test/cloudFs.ts). */
export interface CloudFs {
  readDir(path: string): Promise<CloudDirEntry[]>;
  /** Segue links (só para a pasta conectada em si). */
  stat(path: string): Promise<CloudFileInfo>;
  /** Não segue links. */
  lstat(path: string): Promise<CloudFileInfo>;
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<Uint8Array>;
  /** Cria o arquivo; falha se já existe (nunca sobrescreve). */
  writeNewFile(path: string, bytes: Uint8Array): Promise<void>;
}

/** Home do Mac e seletor de pasta (Tauri: tauriCloudFs.ts). */
export interface CloudEnv {
  homeDir(): Promise<string>;
  /** Seletor de pasta do sistema; devolve o caminho escolhido ou null. A pasta escolhida fica liberada na sessão. */
  pickFolder(options: { defaultPath?: string; title?: string }): Promise<string | null>;
}

let fsOverride: CloudFs | null = null;
let envOverride: CloudEnv | null = null;

/** Troca o disco usado (testes). null volta ao do Tauri. */
export function setCloudFs(fs: CloudFs | null): void {
  fsOverride = fs;
}

export function getCloudFs(): CloudFs {
  return fsOverride ?? tauriCloudFs;
}

/** Troca a home e o seletor de pasta (testes). null volta aos do Tauri. */
export function setCloudEnv(env: CloudEnv | null): void {
  envOverride = env;
}

export function getCloudEnv(): CloudEnv {
  return envOverride ?? tauriCloudEnv;
}

/** Pastas de nuvem do Mac (detectCloudFolders com o disco de verdade). */
export async function scanCloudFolders(home: string, fs: CloudFs = getCloudFs()): Promise<DetectedCloudFolder[]> {
  const base = trimSlash(home);
  const storage = `${base}/${CLOUD_STORAGE_RELATIVE}`;
  const candidates = [`${base}/${ICLOUD_RELATIVE}`, ...LEGACY_ROOTS.map(([, folder]) => `${base}/${folder}`)];
  const present = new Set<string>();
  await Promise.all(
    candidates.map(async (candidate) => {
      if (await fs.exists(candidate).catch(() => false)) present.add(candidate);
    }),
  );
  let names: string[] = [];
  try {
    names = (await fs.readDir(storage)).filter((entry) => entry.isDirectory).map((entry) => entry.name);
  } catch {
    names = [];
  }
  return detectCloudFolders(base, (candidate) => present.has(candidate), (dir) => (dir === storage ? names : []));
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error ?? ""));
const isAccessError = (error: unknown) => /forbidden|not allowed|EACCES|EPERM|permission denied|operation not permitted/i.test(errorText(error));

/** A pasta conectada existe e é pasta. */
async function checkRoot(root: string, fs: CloudFs): Promise<string> {
  const base = normalizeLocalPath(root);
  let info: CloudFileInfo;
  try {
    info = await fs.stat(base);
  } catch (error) {
    if (isAccessError(error)) throw new CloudFolderError("no_access", "O app não tem acesso a esta pasta. Escolha a pasta de novo para liberar o acesso.");
    throw new CloudFolderError("missing", `Pasta não encontrada: ${base}. Ela foi movida ou o app da nuvem está desligado?`);
  }
  if (!info.isDirectory) throw new CloudFolderError("not_dir", `${base} não é uma pasta.`);
  return base;
}

/** Caminho de um item dentro da pasta conectada, conferindo cada parte: existe, não é link e (até o último) é pasta. */
async function resolveInside(root: string, segments: readonly string[], fs: CloudFs): Promise<{ path: string; info: CloudFileInfo | null }> {
  const base = await checkRoot(root, fs);
  let info: CloudFileInfo | null = null;
  for (let index = 0; index < segments.length; index++) {
    const current = joinPath(base, segments.slice(0, index + 1));
    try {
      info = await fs.lstat(current);
    } catch (error) {
      if (isAccessError(error)) throw new CloudFolderError("no_access", "O app não tem acesso a este item da pasta conectada.");
      throw new CloudFolderError("missing", `“${segments[index]}” não encontrado na pasta conectada.`);
    }
    if (info.isSymlink) throw new CloudFolderError("outside", `“${segments[index]}” é um link (atalho) e o app não segue links: abra a pasta original.`);
    if (index < segments.length - 1 && !info.isDirectory) throw new CloudFolderError("not_dir", `“${segments[index]}” não é uma pasta.`);
  }
  return { path: joinPath(base, segments), info };
}

export interface CloudEntry {
  name: string;
  isDir: boolean;
  size: number;
  /** Data de modificação ISO; "" se o disco não informou. */
  modified: string;
  /** Arquivo do iCloud que ainda não foi baixado neste Mac (marcador ".nome.icloud"). */
  cloudOnly?: boolean;
}

const ICLOUD_PLACEHOLDER = /^\.(.+)\.icloud$/;

/** Itens da pasta conectada (ou de uma subpasta): pastas primeiro, sem ocultos, sem links e sem a pasta do app. */
export async function listCloudFolder(root: string, relative: string | readonly string[] = "", fs: CloudFs = getCloudFs()): Promise<CloudEntry[]> {
  const segments = cloudSubpath(relative);
  const { path: dir, info } = await resolveInside(root, segments, fs);
  if (info && !info.isDirectory) throw new CloudFolderError("not_dir", `“${segments[segments.length - 1]}” não é uma pasta.`);
  let raw: CloudDirEntry[];
  try {
    raw = await fs.readDir(dir);
  } catch (error) {
    if (isAccessError(error)) throw new CloudFolderError("no_access", "O app não tem acesso a esta pasta. Escolha a pasta de novo para liberar o acesso.");
    throw new CloudFolderError("unreadable", `Não foi possível ler a pasta: ${errorText(error)}`);
  }
  const visible = raw.filter((entry) => !entry.isSymlink && !entry.name.startsWith(".") && !isAppFolder(entry.name) && (entry.isDirectory || entry.isFile));
  const names = new Set(visible.map((entry) => entry.name));
  const entries: CloudEntry[] = await Promise.all(
    visible.map(async (entry) => {
      const stats = await fs.lstat(joinPath(dir, [entry.name])).catch(() => null);
      return {
        name: entry.name,
        isDir: entry.isDirectory,
        size: entry.isFile ? stats?.size ?? 0 : 0,
        modified: stats?.mtime ? stats.mtime.toISOString() : "",
      };
    }),
  );
  for (const entry of raw) {
    const placeholder = entry.isFile ? ICLOUD_PLACEHOLDER.exec(entry.name) : null;
    if (placeholder && !names.has(placeholder[1]) && !isAppFolder(placeholder[1])) entries.push({ name: placeholder[1], isDir: false, size: 0, modified: "", cloudOnly: true });
  }
  return entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || compareNames(a.name, b.name));
}

/** Bytes de um arquivo da pasta conectada. */
export async function readCloudFile(root: string, relative: string | readonly string[], fs: CloudFs = getCloudFs(), options: { maxBytes?: number } = {}): Promise<Uint8Array> {
  const segments = cloudSubpath(relative);
  if (segments.length === 0) throw new CloudFolderError("not_file", "Escolha um arquivo.");
  const { path: file, info } = await resolveInside(root, segments, fs);
  if (!info?.isFile) throw new CloudFolderError("not_file", `“${segments[segments.length - 1]}” não é um arquivo.`);
  const maxBytes = options.maxBytes ?? HARD_MAX_FILE_BYTES;
  if (info.size > maxBytes) throw new CloudFolderError("too_large", `Arquivo grande demais para abrir pelo app (${formatBytes(info.size)}; limite ${formatBytes(maxBytes)}). Abra pelo Finder.`);
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (isAccessError(error)) throw new CloudFolderError("no_access", "O app não tem acesso a este arquivo. Escolha a pasta de novo para liberar o acesso.");
    throw new CloudFolderError("unreadable", `Não foi possível ler o arquivo: ${errorText(error)}`);
  }
}

function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

const MAX_NAME_ATTEMPTS = 500;

/** Mesmas regras de tamanho dos documentos: 0 bytes (pasta arrastada, leitura que falhou) e acima do limite não vão. */
function checkUploadSize(name: string, size: number, maxBytes: number): void {
  if (size === 0) throw new CloudFolderError("empty", `“${name}” está vazio (0 bytes).`);
  if (size > maxBytes) throw new CloudFolderError("too_large", `“${name}” tem ${formatBytes(size, { roundUp: true })}; o limite é ${formatBytes(maxBytes)} por arquivo.`);
}

/** Bytes do arquivo escolhido ou arrastado: o tamanho é conferido antes de ler, para não carregar um arquivo enorme à toa. */
async function readUpload(file: Blob, name: string, maxBytes: number): Promise<Uint8Array> {
  checkUploadSize(name, file.size, maxBytes);
  try {
    return await readBlobBytes(file);
  } catch {
    throw new CloudFolderError("unreadable", `Não foi possível ler “${name}”. Se for uma pasta, envie os arquivos de dentro dela.`);
  }
}

/**
 * Grava um arquivo novo na pasta conectada (ou subpasta) e devolve o nome usado. Nunca sobrescreve: nome repetido
 * vira "nome (2).ext", "nome (3).ext"... O nome passa pelo mesmo saneamento dos documentos (sem pastas nem "..").
 */
export async function writeCloudFile(
  root: string,
  folder: string | readonly string[],
  fileName: string,
  bytes: Uint8Array,
  fs: CloudFs = getCloudFs(),
  options: { maxBytes?: number } = {},
): Promise<string> {
  const segments = cloudSubpath(folder);
  const { path: dir, info } = await resolveInside(root, segments, fs);
  if (info && !info.isDirectory) throw new CloudFolderError("not_dir", `“${segments[segments.length - 1]}” não é uma pasta.`);
  const maxBytes = options.maxBytes ?? HARD_MAX_FILE_BYTES;
  const clean = sanitizeFileName(fileName);
  checkUploadSize(clean, bytes.byteLength, maxBytes);
  const writeError = (error: unknown) =>
    isAccessError(error)
      ? new CloudFolderError("no_access", "O app não tem acesso para gravar nesta pasta. Escolha a pasta de novo para liberar o acesso.")
      : new CloudFolderError("unreadable", `Não foi possível gravar “${clean}”: ${errorText(error)}`);
  const [stem, extension] = splitExtension(clean);
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
    const candidate = attempt === 1 ? clean : `${stem} (${attempt})${extension}`;
    const target = joinPath(dir, [candidate]);
    let taken: boolean;
    try {
      taken = await fs.exists(target);
    } catch (error) {
      // No Tauri, um link com esse nome apontando para fora do escopo responde "forbidden path".
      throw writeError(error);
    }
    if (taken) continue;
    try {
      await fs.writeNewFile(target, bytes);
      return candidate;
    } catch (error) {
      // Outro envio criou o mesmo nome entre a checagem e a gravação: tenta o próximo.
      if (await fs.exists(target).catch(() => false)) continue;
      throw writeError(error);
    }
  }
  throw new CloudFolderError("invalid", `Já existem arquivos demais com o nome “${clean}” nesta pasta.`);
}

// ── Cadastro (cloud_folders) ─────────────────────────────────────

/** Papéis que veem todas as pastas dos Documentos (o "*" de ROOT_ACCESS em modules/documents/access.ts; o teste de lá confere). */
export const CLOUD_FULL_ACCESS_ROLES: readonly Role[] = ["ceo", "admin", "gerente", "auditor"];

const MAX_LABEL_LENGTH = 80;

export interface CloudActor {
  role: Role;
  userId: string;
}

/** Vê a pasta conectada: quem conectou e quem vê todas as pastas dos Documentos. */
export function canSeeCloudFolder(role: Role, userId: string, folder: Pick<CloudFolder, "created_by">): boolean {
  if (!can(role, "view", "documents")) return false;
  return folder.created_by === userId || CLOUD_FULL_ACCESS_ROLES.includes(role);
}

/** Renomeia, troca a pasta ou desconecta: quem conectou, ou quem vê todas, desde que tenha `edit` em documents. */
export function canManageCloudFolder(role: Role, userId: string, folder: Pick<CloudFolder, "created_by">): boolean {
  if (!can(role, "edit", "documents")) return false;
  return folder.created_by === userId || CLOUD_FULL_ACCESS_ROLES.includes(role);
}

/** Conectar uma pasta nova: `create` em documents. */
export function canConnectCloudFolder(role: Role): boolean {
  return can(role, "create", "documents");
}

export const cloudFoldersQueryKey = (companyId: string) => ["documents", companyId, "cloud-folders"] as const;

type FolderAccess = Pick<CloudFolder, "local_path" | "created_by">;

function assertSees(actor: CloudActor, folder: FolderAccess): void {
  if (!canSeeCloudFolder(actor.role, actor.userId, folder)) throw new CloudFolderError("forbidden", "Seu perfil não tem acesso a esta pasta conectada.");
}

/** Lista para a tela: confere se a pessoa vê a pasta antes de ler o disco. */
export async function browseCloudFolder(actor: CloudActor, folder: FolderAccess, relative: string | readonly string[] = "", fs: CloudFs = getCloudFs()): Promise<CloudEntry[]> {
  assertSees(actor, folder);
  return listCloudFolder(folder.local_path, relative, fs);
}

/** Abre (pré-visualizar, baixar) para a tela: confere se a pessoa vê a pasta. */
export async function openCloudFile(actor: CloudActor, folder: FolderAccess, relative: string | readonly string[], fs: CloudFs = getCloudFs()): Promise<Uint8Array> {
  assertSees(actor, folder);
  return readCloudFile(folder.local_path, relative, fs);
}

/**
 * Envio pela tela: `attach` em documents e ver a pasta; devolve o nome gravado (nunca sobrescreve). `content` pode ser
 * o próprio arquivo escolhido/arrastado: o tamanho (0 bytes, limite) é conferido antes de ler.
 */
export async function sendToCloudFolder(
  actor: CloudActor,
  folder: FolderAccess,
  folderPath: string | readonly string[],
  fileName: string,
  content: Uint8Array | Blob,
  options: { maxBytes?: number; fs?: CloudFs } = {},
): Promise<string> {
  if (!can(actor.role, "attach", "documents") || !canSeeCloudFolder(actor.role, actor.userId, folder)) {
    throw new CloudFolderError("forbidden", "Seu perfil não tem permissão para enviar arquivos para esta pasta.");
  }
  const maxBytes = options.maxBytes ?? HARD_MAX_FILE_BYTES;
  const bytes = ArrayBuffer.isView(content) ? new Uint8Array(content.buffer, content.byteOffset, content.byteLength) : await readUpload(content, sanitizeFileName(fileName), maxBytes);
  return writeCloudFile(folder.local_path, folderPath, fileName, bytes, options.fs ?? getCloudFs(), { maxBytes });
}

function cleanLabel(label: string | null | undefined): string {
  return String(label ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);
}

function cleanProvider(provider: string | null | undefined): CloudProvider | null {
  return CLOUD_PROVIDER_ORDER.includes(provider as CloudProvider) ? (provider as CloudProvider) : null;
}

/** Pastas conectadas da empresa (ativas), pelo nome. */
export async function listCloudFolders(db: DatabaseLike, companyId: string): Promise<CloudFolder[]> {
  const rows = await db.select<CloudFolder[]>("SELECT * FROM cloud_folders WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  return rows.filter((row) => !row.deleted_at).sort((a, b) => compareNames(a.label, b.label) || a.id.localeCompare(b.id));
}

async function findFolder(db: DatabaseLike, companyId: string, id: string): Promise<CloudFolder> {
  const rows = await db.select<CloudFolder[]>("SELECT * FROM cloud_folders WHERE id=? AND company_id=? AND deleted_at IS NULL", [id, companyId]);
  const folder = rows.find((row) => row.id === id && row.company_id === companyId && !row.deleted_at);
  if (!folder) throw new CloudFolderError("not_found", "Pasta conectada não encontrada.");
  return folder;
}

/** O banco demo não aplica o UNIQUE (empresa, pasta): a duplicata é barrada aqui também. */
async function assertNotConnected(db: DatabaseLike, companyId: string, localPath: string, exceptId?: string): Promise<void> {
  const key = pathKey(localPath);
  const same = (await listCloudFolders(db, companyId)).find((row) => row.id !== exceptId && pathKey(trimSlash(row.local_path)) === key);
  if (same) throw new CloudFolderError("duplicate", `Esta pasta já está conectada (“${same.label}”).`);
}

const isUniqueError = (error: unknown) => /UNIQUE constraint failed/i.test(errorText(error));

export interface ConnectCloudFolderInput {
  localPath: string;
  provider?: CloudProvider | null;
  label?: string | null;
  /** Home do Mac, para sugerir o serviço e o nome pelo caminho. */
  home?: string | null;
}

/** Conecta uma pasta do Mac aos Documentos (só o cadastro; nada é copiado). */
export async function connectCloudFolder(db: DatabaseLike, companyId: string, actor: CloudActor, input: ConnectCloudFolderInput): Promise<CloudFolder> {
  if (!canConnectCloudFolder(actor.role)) throw new CloudFolderError("forbidden", "Seu perfil não tem permissão para conectar pastas aos Documentos.");
  const localPath = normalizeLocalPath(input.localPath);
  const provider = cleanProvider(input.provider) ?? (input.home ? providerForPath(input.home, localPath) : "outro");
  const label = cleanLabel(input.label) || (input.home ? defaultCloudLabel(input.home, localPath) : defaultCloudLabel("/", localPath));
  await assertNotConnected(db, companyId, localPath);
  const id = uuidv4();
  const now = new Date().toISOString();
  try {
    await db.execute(
      "INSERT INTO cloud_folders (id, company_id, provider, label, local_path, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
      [id, companyId, provider, label, localPath, actor.userId, now, now],
    );
  } catch (error) {
    if (isUniqueError(error)) throw new CloudFolderError("duplicate", "Esta pasta já está conectada.");
    throw error;
  }
  return findFolder(db, companyId, id);
}

export interface CloudFolderPatch {
  label?: string | null;
  provider?: CloudProvider | null;
  local_path?: string | null;
}

/** Renomeia, troca o serviço ou aponta para outra pasta. */
export async function updateCloudFolder(db: DatabaseLike, companyId: string, actor: CloudActor, id: string, patch: CloudFolderPatch): Promise<void> {
  const folder = await findFolder(db, companyId, id);
  if (!canManageCloudFolder(actor.role, actor.userId, folder)) throw new CloudFolderError("forbidden", "Seu perfil não tem permissão para alterar esta pasta conectada.");
  let label = folder.label;
  if (patch.label !== undefined) {
    label = cleanLabel(patch.label);
    if (!label) throw new CloudFolderError("invalid", "Dê um nome à pasta conectada.");
  }
  const provider = patch.provider !== undefined ? cleanProvider(patch.provider) ?? "outro" : folder.provider;
  let localPath = folder.local_path;
  if (patch.local_path !== undefined) {
    localPath = normalizeLocalPath(patch.local_path ?? "");
    await assertNotConnected(db, companyId, localPath, folder.id);
  }
  try {
    await db.execute("UPDATE cloud_folders SET label=?, provider=?, local_path=?, updated_at=? WHERE id=? AND company_id=? AND deleted_at IS NULL", [
      label,
      provider,
      localPath,
      new Date().toISOString(),
      folder.id,
      companyId,
    ]);
  } catch (error) {
    if (isUniqueError(error)) throw new CloudFolderError("duplicate", "Esta pasta já está conectada.");
    throw error;
  }
}

/** Desconecta (soft delete). Os arquivos da pasta no Mac e na nuvem não são tocados. */
export async function disconnectCloudFolder(db: DatabaseLike, companyId: string, actor: CloudActor, id: string): Promise<void> {
  const folder = await findFolder(db, companyId, id);
  if (!canManageCloudFolder(actor.role, actor.userId, folder)) throw new CloudFolderError("forbidden", "Seu perfil não tem permissão para desconectar esta pasta.");
  const now = new Date().toISOString();
  await db.execute("UPDATE cloud_folders SET deleted_at=?, updated_at=? WHERE id=? AND company_id=?", [now, now, folder.id, companyId]);
}
