// Documentos com arquivo real (migration 0009). Bytes fora do banco, endereçados pelo SHA-256 do conteúdo
// (`<companyId>/<sha[0..2]>/<sha>`, ver backend.ts): mesmo conteúdo = um arquivo só, e o nome enviado nunca vira caminho.
// Metadados em `documents`; cada versão é uma linha: mesmo título no mesmo lugar (pasta, ou registro dono do anexo)
// → nova linha com version + 1 e parent_version_id = versão anterior. A versão atual é a ponta da corrente (a linha
// ativa que nenhuma outra aponta como anterior). SQL só nos padrões do banco demo (documents é tabela "leniente" lá:
// WHERE não entendido vira filtro por empresa em silêncio), com filtros finos e agrupamentos em TypeScript.
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { v4 as uuidv4 } from "uuid";
import { getDb, isTauriRuntime } from "@/lib/db/client";
import type { DatabaseLike } from "@/lib/db/demo";
import { emit } from "@/lib/events/bus";
import type { DocumentRow } from "@/types";
import { isValidCompanyId, isValidStorageKey, storageKeyFor, type FileBackend } from "./backend";
import { demoFileBackend } from "./demoStore";
import { fileTypeLabel, formatBytes, guessMime } from "./format";
import { sha256Hex } from "./sha256";
import { tauriFileBackend } from "./tauriStore";

export { sha256Hex } from "./sha256";

/** Limite padrão por arquivo. A empresa pode mudar em settings (`documents.max_file_mb`, número de MB). */
export const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Teto do limite configurável: o arquivo inteiro passa pela memória (leitura, hash e IPC do Tauri). */
export const HARD_MAX_FILE_BYTES = 500 * 1024 * 1024;
export const MAX_FILE_SETTING = "documents.max_file_mb";
const MAX_NAME_LENGTH = 180;
/** Proteção contra corrente de versões circular ou absurda (dado corrompido). */
const MAX_CHAIN = 1000;

export type FileStoreErrorCode =
  | "empty"
  | "too_large"
  | "unreadable"
  | "invalid"
  | "no_content"
  | "missing"
  | "corrupted"
  | "name_taken";

/** Erro com mensagem pronta para a tela (pt-BR). */
export class FileStoreError extends Error {
  readonly code: FileStoreErrorCode;
  constructor(code: FileStoreErrorCode, message: string) {
    super(message);
    this.name = "FileStoreError";
    this.code = code;
  }
}

// ── Armazenamento ─────────────────────────────────────────────────

let backendOverride: FileBackend | null = null;

/** Troca o armazenamento (testes). `null` volta ao padrão: disco no desktop, IndexedDB no navegador. */
export function setFileBackend(backend: FileBackend | null): void {
  backendOverride = backend;
}

export function getFileBackend(): FileBackend {
  return backendOverride ?? (isTauriRuntime() ? tauriFileBackend : demoFileBackend());
}

// ── Nomes e pastas ────────────────────────────────────────────────

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
// Marcas de direção do texto disfarçam extensão ("fatura‮fdp.exe" aparece como "fatura exe.pdf").
const BIDI_CHARS = /[‎‏‪-‮⁦-⁩]/g;
const FORBIDDEN_CHARS = /[<>:"|?*]/g;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Nome seguro para mostrar e baixar: só a última parte do caminho (sem pastas nem ".."), sem caracteres de controle,
 * de direção ou proibidos no Windows/macOS, sem pontos/espaços nas pontas, NFC e no máximo 180 caracteres (mantendo a
 * extensão). Vazio vira `fallback`.
 */
export function sanitizeFileName(name: string, fallback = "arquivo"): string {
  const segments = String(name ?? "")
    .normalize("NFC")
    .split(/[/\\]/)
    .filter((segment) => segment.trim() !== "");
  let clean = (segments.pop() ?? "")
    .replace(CONTROL_CHARS, "")
    .replace(BIDI_CHARS, "")
    .replace(FORBIDDEN_CHARS, "_")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  if (!clean) return fallback;
  if (RESERVED_NAMES.test(clean.split(".")[0])) clean = `_${clean}`;
  const chars = Array.from(clean);
  if (chars.length > MAX_NAME_LENGTH) {
    const dot = clean.lastIndexOf(".");
    const ext = dot > 0 && clean.length - dot <= 11 ? clean.slice(dot) : "";
    clean = chars.slice(0, MAX_NAME_LENGTH - Array.from(ext).length).join("").trimEnd() + ext;
  }
  return clean;
}

/** Pasta lógica "A/B/C": cada parte saneada como nome de arquivo; partes vazias, "." e ".." somem. */
export function normalizeFolder(folder: string | null | undefined): string {
  return String(folder ?? "")
    .normalize("NFC")
    .split(/[/\\]/)
    .map((segment) => sanitizeFileName(segment, ""))
    .filter(Boolean)
    .join("/");
}

/** Onde o documento mora: um registro (anexo) ou uma pasta ("" = raiz). */
export interface DocumentContainer {
  entityType: string | null;
  entityId: string | null;
  folder: string;
}

const ENTITY_TYPE = /^[a-z][a-z0-9_]{0,39}$/;

function pathSegments(filePath: string | null | undefined): string[] {
  return String(filePath ?? "").split("/").filter(Boolean);
}

/** Pasta de um documento de pasta: a coluna `folder` (0009) ou, em registro antigo, o file_path sem o nome. */
export function documentFolder(doc: Pick<DocumentRow, "folder" | "file_path" | "entity_type">): string {
  if (doc.entity_type) return "";
  if (doc.folder != null) return normalizeFolder(doc.folder);
  return pathSegments(doc.file_path).slice(0, -1).join("/");
}

export function containerOf(doc: Pick<DocumentRow, "folder" | "file_path" | "entity_type" | "entity_id">): DocumentContainer {
  return doc.entity_type
    ? { entityType: doc.entity_type, entityId: doc.entity_id ?? "", folder: "" }
    : { entityType: null, entityId: null, folder: documentFolder(doc) };
}

/** file_path (caminho lógico mostrado na tela): "/pasta/nome" ou, para anexo, "/Anexos/<tipo>/<id>/nome". */
export function filePathFor(container: DocumentContainer, title: string): string {
  if (container.entityType) return `/Anexos/${container.entityType}/${sanitizeFileName(container.entityId ?? "", "registro")}/${title}`;
  return `/${container.folder ? `${container.folder}/` : ""}${title}`;
}

const titleKey = (title: string) => title.normalize("NFC").toLocaleLowerCase("pt-BR");

// ── Consultas ─────────────────────────────────────────────────────

/** Só a versão atual de cada documento (a ponta de cada corrente), na ordem recebida. */
export function currentVersions<T extends Pick<DocumentRow, "id" | "parent_version_id" | "deleted_at">>(rows: T[]): T[] {
  const active = rows.filter((row) => !row.deleted_at);
  const parents = new Set(active.map((row) => row.parent_version_id).filter(Boolean));
  return active.filter((row) => !parents.has(row.id));
}

/** Documentos de pasta (sem os anexos de registros), versão atual, mais recentes primeiro. */
export async function listFolderDocuments(companyId: string): Promise<DocumentRow[]> {
  const db = await getDb();
  const rows = await db.select<DocumentRow[]>(
    "SELECT * FROM documents WHERE company_id=? AND entity_type IS NULL AND deleted_at IS NULL ORDER BY created_at DESC",
    [companyId],
  );
  return currentVersions(rows);
}

/** Anexos de um registro, versão atual, mais recentes primeiro. */
export async function listAttachments(companyId: string, entityType: string, entityId: string): Promise<DocumentRow[]> {
  const db = await getDb();
  const rows = await db.select<DocumentRow[]>(
    "SELECT * FROM documents WHERE company_id=? AND entity_type=? AND entity_id=? AND deleted_at IS NULL ORDER BY created_at DESC",
    [companyId, entityType, entityId],
  );
  return currentVersions(rows);
}

/** Todos os anexos de registros da empresa (versão atual), para a aba "Anexos de registros". */
export async function listAllAttachments(companyId: string): Promise<DocumentRow[]> {
  const db = await getDb();
  const rows = await db.select<DocumentRow[]>(
    "SELECT * FROM documents WHERE company_id=? AND entity_type IS NOT NULL AND deleted_at IS NULL ORDER BY created_at DESC",
    [companyId],
  );
  return currentVersions(rows);
}

async function fetchDocument(db: DatabaseLike, companyId: string, id: string): Promise<DocumentRow | null> {
  const rows = await db.select<DocumentRow[]>("SELECT * FROM documents WHERE company_id=? AND id=?", [companyId, id]);
  return rows[0] ?? null;
}

/** Versão atual da corrente de `doc` (relida do banco). */
async function latestOf(db: DatabaseLike, doc: DocumentRow): Promise<DocumentRow> {
  let cursor = (await fetchDocument(db, doc.company_id, doc.id)) ?? doc;
  const seen = new Set([cursor.id]);
  for (let step = 0; step < MAX_CHAIN; step++) {
    const [child] = await db.select<DocumentRow[]>(
      "SELECT * FROM documents WHERE company_id=? AND parent_version_id=? AND deleted_at IS NULL ORDER BY version DESC LIMIT 1",
      [doc.company_id, cursor.id],
    );
    if (!child || seen.has(child.id)) break;
    seen.add(child.id);
    cursor = child;
  }
  return cursor;
}

/** Todas as versões ativas do documento, da atual para a primeira. */
export async function listVersions(doc: DocumentRow): Promise<DocumentRow[]> {
  const db = await getDb();
  const latest = await latestOf(db, doc);
  const chain = latest.deleted_at ? [] : [latest];
  const seen = new Set([latest.id]);
  let cursor = latest;
  while (cursor.parent_version_id && !seen.has(cursor.parent_version_id) && seen.size < MAX_CHAIN) {
    const parent = await fetchDocument(db, doc.company_id, cursor.parent_version_id);
    if (!parent) break;
    seen.add(parent.id);
    if (!parent.deleted_at) chain.push(parent);
    cursor = parent;
  }
  return chain;
}

/** Versão atual do documento com este título neste lugar (sem diferenciar maiúsculas), ou null. */
async function findCurrentVersion(db: DatabaseLike, companyId: string, container: DocumentContainer, title: string): Promise<DocumentRow | null> {
  const rows = container.entityType
    ? await db.select<DocumentRow[]>(
        "SELECT * FROM documents WHERE company_id=? AND entity_type=? AND entity_id=? AND deleted_at IS NULL",
        [companyId, container.entityType, container.entityId],
      )
    : await db.select<DocumentRow[]>("SELECT * FROM documents WHERE company_id=? AND entity_type IS NULL AND deleted_at IS NULL", [companyId]);
  const wanted = titleKey(title);
  const matches = currentVersions(rows).filter(
    (row) => titleKey(row.title) === wanted && (container.entityType ? true : documentFolder(row) === container.folder),
  );
  return matches.sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0] ?? null;
}

// ── Limite ────────────────────────────────────────────────────────

/** Limite por arquivo da empresa: settings `documents.max_file_mb` (número de MB, até 500) ou 50 MB. */
export async function getMaxFileBytes(companyId: string): Promise<number> {
  try {
    const db = await getDb();
    const rows = await db.select<{ value_json?: string | null }[]>("SELECT * FROM settings WHERE company_id=? AND key=?", [companyId, MAX_FILE_SETTING]);
    const raw = rows[0]?.value_json;
    if (raw != null) {
      const parsed: unknown = JSON.parse(raw);
      const mb = Number(typeof parsed === "object" && parsed !== null ? (parsed as { mb?: unknown }).mb : parsed);
      if (Number.isFinite(mb) && mb > 0) return Math.min(Math.round(mb * 1024 * 1024), HARD_MAX_FILE_BYTES);
    }
  } catch {
    // configuração ilegível: vale o padrão
  }
  return DEFAULT_MAX_FILE_BYTES;
}

// ── Gravar ────────────────────────────────────────────────────────

/** Bytes de um Blob/File (FileReader quando o ambiente não tem Blob.arrayBuffer, como o jsdom). */
export async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler o arquivo."));
    reader.readAsArrayBuffer(blob);
  });
}

/** Texto UTF-8 de um Blob (pré-visualização de .txt/.csv). */
export async function readBlobText(blob: Blob): Promise<string> {
  return new TextDecoder("utf-8").decode(await readBlobBytes(blob));
}

export interface SaveFileMeta {
  userId: string;
  /** Anexo de um registro (ex.: "customer" + id). Sem isso, o documento vai para `folder`. */
  entityType?: string | null;
  entityId?: string | null;
  /** Pasta lógica "Comercial/Contratos" ("" ou ausente = raiz). Ignorada em anexo. */
  folder?: string | null;
  /** Título no lugar do nome do arquivo. */
  title?: string;
  /** Envia como nova versão deste documento (mesmo título e lugar), qualquer que seja o nome do arquivo. */
  versionOf?: DocumentRow | null;
  description?: string | null;
  /** Limite em bytes; padrão: getMaxFileBytes(companyId). */
  maxBytes?: number;
}

function resolveContainer(meta: SaveFileMeta): DocumentContainer {
  if (meta.entityType || meta.entityId) {
    const entityType = String(meta.entityType ?? "");
    const entityId = String(meta.entityId ?? "").trim();
    if (!ENTITY_TYPE.test(entityType) || !entityId || entityId.length > 100) {
      throw new FileStoreError("invalid", "Registro inválido para anexar arquivos.");
    }
    return { entityType, entityId, folder: "" };
  }
  return { entityType: null, entityId: null, folder: normalizeFolder(meta.folder) };
}

const INSERT_DOCUMENT = `INSERT INTO documents (id, company_id, title, type, file_path, version, department_id, tags_json, entity_type, entity_id,
  uploaded_by, storage_key, original_name, mime, size_bytes, sha256, parent_version_id, folder, description, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

async function insertDocument(db: DatabaseLike, row: DocumentRow): Promise<void> {
  await db.execute(INSERT_DOCUMENT, [
    row.id, row.company_id, row.title, row.type ?? null, row.file_path, row.version, row.department_id ?? null, row.tags_json, row.entity_type ?? null,
    row.entity_id ?? null, row.uploaded_by ?? null, row.storage_key ?? null, row.original_name ?? null, row.mime ?? null, row.size_bytes ?? null,
    row.sha256 ?? null, row.parent_version_id ?? null, row.folder ?? null, row.description ?? null, row.created_at, row.updated_at,
  ]);
}

/** Atividade do documento; anexo entra no histórico do registro dono (ticket, cliente...). */
async function logActivity(doc: DocumentRow, actorId: string, type: string, title: string): Promise<void> {
  await emit({
    type,
    companyId: doc.company_id,
    actorId,
    entityType: doc.entity_type || "document",
    entityId: doc.entity_type ? doc.entity_id ?? doc.id : doc.id,
    title,
    module: "documents",
    metadata: { document_id: doc.id, version: doc.version, size_bytes: doc.size_bytes ?? null, sha256: doc.sha256 ?? null },
  });
}

/**
 * Grava o arquivo e devolve a linha nova de `documents`. Recusa 0 bytes e acima do limite (FileStoreError com a
 * mensagem para a tela). Mesmo título no mesmo lugar vira nova versão; o título da corrente é mantido.
 */
export async function saveFile(companyId: string, file: File, meta: SaveFileMeta): Promise<DocumentRow> {
  if (!isValidCompanyId(companyId)) throw new FileStoreError("invalid", "Empresa inválida para guardar arquivos.");
  const originalName = String(file.name ?? "");
  const shown = sanitizeFileName(originalName);
  const limit = meta.maxBytes ?? (await getMaxFileBytes(companyId));
  const checkSize = (size: number) => {
    if (size === 0) throw new FileStoreError("empty", `O arquivo "${shown}" está vazio (0 bytes).`);
    if (size > limit) throw new FileStoreError("too_large", `O arquivo "${shown}" tem ${formatBytes(size)}; o limite é ${formatBytes(limit)}.`);
  };
  checkSize(file.size);
  let bytes: Uint8Array;
  try {
    bytes = await readBlobBytes(file);
  } catch {
    throw new FileStoreError("unreadable", `Não foi possível ler "${shown}". Se for uma pasta, envie os arquivos de dentro dela.`);
  }
  checkSize(bytes.byteLength);

  const db = await getDb();
  const previous = meta.versionOf ? await latestOf(db, meta.versionOf) : null;
  const container = previous ? containerOf(previous) : resolveContainer(meta);
  const current = previous ?? (await findCurrentVersion(db, companyId, container, sanitizeFileName(meta.title ?? originalName)));
  const title = current ? current.title : sanitizeFileName(meta.title ?? originalName);

  const sha256 = await sha256Hex(bytes);
  const storageKey = storageKeyFor(companyId, sha256);
  const backend = getFileBackend();
  // Mesmo conteúdo já gravado = reaproveita. Tamanho diferente = arquivo truncado de uma falha antiga: regrava.
  const wroteNow = (await backend.size(storageKey)) !== bytes.byteLength;
  if (wroteNow) await backend.write(storageKey, bytes);

  const now = new Date().toISOString();
  const row: DocumentRow = {
    id: uuidv4(),
    company_id: companyId,
    title,
    type: fileTypeLabel(title),
    file_path: filePathFor(container, title),
    version: current ? Number(current.version ?? 1) + 1 : 1,
    department_id: current?.department_id ?? null,
    tags_json: current?.tags_json ?? "[]",
    entity_type: container.entityType,
    entity_id: container.entityId,
    uploaded_by: meta.userId,
    storage_key: storageKey,
    original_name: originalName.slice(0, 500),
    mime: guessMime(originalName || title, file.type),
    size_bytes: bytes.byteLength,
    sha256,
    parent_version_id: current?.id ?? null,
    folder: container.entityType ? null : container.folder || null,
    description: meta.description ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  try {
    await insertDocument(db, row);
  } catch (error) {
    if (wroteNow) await removeIfUnused(db, companyId, storageKey).catch(() => undefined);
    throw error;
  }
  await logActivity(row, meta.userId, current ? "document.version_added" : "document.uploaded", current ? `Nova versão (v${row.version}) de ${title}` : `Arquivo enviado: ${title}`);
  return row;
}

// ── Ler e baixar ──────────────────────────────────────────────────

/** Bytes do documento (conferidos pelo SHA-256). */
export async function openFile(doc: DocumentRow): Promise<Blob> {
  if (!doc.storage_key) throw new FileStoreError("no_content", `"${doc.title}" não tem arquivo salvo: é um registro antigo, só com os dados.`);
  const key = doc.storage_key;
  if (!isValidStorageKey(key) || !key.startsWith(`${doc.company_id}/`) || (doc.sha256 && !key.endsWith(`/${doc.sha256}`))) {
    throw new FileStoreError("invalid", "Caminho de arquivo inválido no cadastro do documento.");
  }
  const backend = getFileBackend();
  let bytes: Uint8Array;
  try {
    bytes = await backend.read(key);
  } catch {
    const hint = backend.persistent ? "" : " (neste navegador os arquivos ficam só na memória e somem ao recarregar a página)";
    throw new FileStoreError("missing", `O arquivo de "${doc.title}" não foi encontrado no armazenamento${hint}.`);
  }
  if (doc.sha256 && (await sha256Hex(bytes)) !== doc.sha256) {
    throw new FileStoreError("corrupted", `O arquivo de "${doc.title}" está corrompido (o conteúdo não confere com o enviado).`);
  }
  return new Blob([bytes.slice().buffer], { type: doc.mime || "application/octet-stream" });
}

/**
 * Baixa o documento. Desktop: diálogo "salvar como" (o caminho escolhido fica liberado para o plugin fs) e grava lá;
 * navegador: download do próprio navegador. Devolve false se a pessoa cancelou.
 */
export async function downloadFile(doc: DocumentRow): Promise<boolean> {
  const blob = await openFile(doc);
  const name = sanitizeFileName(doc.title);
  if (isTauriRuntime()) {
    const target = await save({ title: "Salvar arquivo", defaultPath: name });
    if (!target) return false;
    await writeFile(target, await readBlobBytes(blob));
    return true;
  }
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return true;
}

// ── Excluir, renomear, restaurar ──────────────────────────────────

/** Apaga os bytes se nenhuma linha ativa da empresa usa a mesma chave. */
async function removeIfUnused(db: DatabaseLike, companyId: string, storageKey: string): Promise<void> {
  if (!isValidStorageKey(storageKey)) return;
  const users = await db.select<DocumentRow[]>("SELECT * FROM documents WHERE company_id=? AND storage_key=? AND deleted_at IS NULL LIMIT 1", [companyId, storageKey]);
  if (users.length === 0) await getFileBackend().remove(storageKey);
}

/**
 * Exclusão lógica (deleted_at) do documento inteiro (todas as versões) ou, com `onlyThisVersion`, de uma versão
 * (a seguinte passa a apontar para a anterior). Os bytes só somem quando nenhuma linha ativa usa o mesmo arquivo.
 */
export async function deleteFile(doc: DocumentRow, options: { userId: string; onlyThisVersion?: boolean }): Promise<void> {
  const db = await getDb();
  const fresh = (await fetchDocument(db, doc.company_id, doc.id)) ?? doc;
  const targets = options.onlyThisVersion ? [fresh] : await listVersions(fresh);
  const now = new Date().toISOString();
  for (const row of targets) {
    await db.execute("UPDATE documents SET deleted_at=?, updated_at=? WHERE company_id=? AND id=?", [now, now, doc.company_id, row.id]);
  }
  if (options.onlyThisVersion) {
    await db.execute("UPDATE documents SET parent_version_id=?, updated_at=? WHERE company_id=? AND parent_version_id=? AND deleted_at IS NULL", [
      fresh.parent_version_id ?? null,
      now,
      doc.company_id,
      doc.id,
    ]);
  }
  for (const key of new Set(targets.map((row) => row.storage_key).filter((key): key is string => Boolean(key)))) {
    await removeIfUnused(db, doc.company_id, key);
  }
  await logActivity(
    doc,
    options.userId,
    options.onlyThisVersion ? "document.version_deleted" : "document.deleted",
    options.onlyThisVersion ? `Versão v${doc.version} excluída: ${doc.title}` : `Arquivo excluído: ${doc.title}`,
  );
}

/** Renomeia o documento (todas as versões). Nome já usado no mesmo lugar é recusado. */
export async function renameDocument(doc: DocumentRow, newTitle: string, userId: string): Promise<DocumentRow> {
  const title = sanitizeFileName(newTitle);
  const db = await getDb();
  const chain = await listVersions(doc);
  const latest = chain[0] ?? doc;
  if (title === latest.title) return latest;
  const container = containerOf(latest);
  const clash = await findCurrentVersion(db, latest.company_id, container, title);
  if (clash && clash.id !== latest.id) {
    throw new FileStoreError("name_taken", `Já existe "${clash.title}" ${container.entityType ? "neste registro" : "nesta pasta"}.`);
  }
  const type = fileTypeLabel(title);
  const filePath = filePathFor(container, title);
  const folder = container.entityType ? null : container.folder || null;
  const now = new Date().toISOString();
  for (const row of chain) {
    await db.execute("UPDATE documents SET title=?, type=?, file_path=?, folder=?, updated_at=? WHERE company_id=? AND id=?", [
      title, type, filePath, folder, now, latest.company_id, row.id,
    ]);
  }
  const renamed = { ...latest, title, type, file_path: filePath, folder, updated_at: now };
  await logActivity(renamed, userId, "document.renamed", `Arquivo renomeado: ${latest.title} → ${title}`);
  return renamed;
}

/** Volta o conteúdo de uma versão antiga como a próxima versão (sem regravar os bytes). */
export async function restoreVersion(version: DocumentRow, userId: string): Promise<DocumentRow> {
  if (!version.storage_key) throw new FileStoreError("no_content", `A versão v${version.version} de "${version.title}" não tem arquivo salvo.`);
  const db = await getDb();
  const latest = await latestOf(db, version);
  if (latest.id === version.id) return latest;
  if (!isValidStorageKey(version.storage_key) || !(await getFileBackend().exists(version.storage_key))) {
    throw new FileStoreError("missing", `O arquivo da versão v${version.version} não foi encontrado no armazenamento.`);
  }
  const now = new Date().toISOString();
  const row: DocumentRow = {
    ...latest,
    id: uuidv4(),
    version: Number(latest.version ?? 1) + 1,
    parent_version_id: latest.id,
    storage_key: version.storage_key,
    original_name: version.original_name ?? null,
    mime: version.mime ?? null,
    size_bytes: version.size_bytes ?? null,
    sha256: version.sha256 ?? null,
    uploaded_by: userId,
    description: `Restaurada da versão v${version.version}`,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await insertDocument(db, row);
  await logActivity(row, userId, "document.version_restored", `Versão v${version.version} restaurada como v${row.version}: ${row.title}`);
  return row;
}
