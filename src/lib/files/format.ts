// Funções puras de arquivo: extensão, tipo MIME, tamanho legível e o que dá para pré-visualizar com segurança.

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  heic: "image/heic",
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  ofx: "application/x-ofx",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);
const TEXT_EXTENSIONS = new Set(["txt", "log", "csv", "md", "json", "xml", "ofx"]);

/** Extensão em minúsculas, sem o ponto ("" se não tem). Ignora "extensão" longa ou com símbolos. */
export function fileExtension(name: string | null | undefined): string {
  const value = String(name ?? "");
  const dot = value.lastIndexOf(".");
  if (dot <= 0 || dot === value.length - 1) return "";
  const ext = value.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

/** Rótulo da coluna documents.type (PDF, XLSX...), igual ao que a tela antiga gravava. */
export function fileTypeLabel(name: string): string {
  return fileExtension(name).toUpperCase() || "ARQUIVO";
}

/** MIME informado pelo navegador (se bem formado) ou deduzido da extensão. */
export function guessMime(name: string, given?: string | null): string {
  const informed = String(given ?? "").trim().toLowerCase().split(";")[0];
  if (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(informed)) return informed;
  return MIME_BY_EXTENSION[fileExtension(name)] ?? "application/octet-stream";
}

/** "512 bytes", "12,4 KB", "50 MB" (pt-BR; número inteiro sem casas). Valor inválido ou negativo vira "0 bytes". */
export function formatBytes(bytes: number | null | undefined): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value < 1024) {
    const whole = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    return `${whole} ${whole === 1 ? "byte" : "bytes"}`;
  }
  const units = ["KB", "MB", "GB"];
  let amount = value;
  let unit = -1;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  const text = Number.isInteger(amount) ? String(amount) : amount.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${text} ${units[unit]}`;
}

export type PreviewKind = "image" | "pdf" | "text";

/**
 * O que a tela pode mostrar sem risco. HTML nunca: um blob: criado pelo app tem a mesma origem do app (e acesso ao
 * Tauri), então HTML/SVG só entram como <img> (sem script) ou como texto.
 */
export function previewKind(doc: { title?: string | null; mime?: string | null }): PreviewKind | null {
  const ext = fileExtension(doc.title);
  const mime = String(doc.mime ?? "").toLowerCase();
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (TEXT_EXTENSIONS.has(ext) || mime === "text/plain" || mime === "text/csv") return "text";
  return null;
}

/** MIME que a pré-visualização usa no blob: nunca o informado pelo arquivo (que poderia ser text/html). */
export function previewMime(kind: PreviewKind, doc: { title?: string | null }): string {
  if (kind === "pdf") return "application/pdf";
  if (kind === "image") return MIME_BY_EXTENSION[fileExtension(doc.title)] ?? "image/png";
  return "text/plain";
}

/**
 * Data e hora no fuso local ("24/10/2026 14:03"). Aceita ISO com fuso e o `datetime('now')` do SQLite
 * ("2026-10-24 17:03:00", que é UTC sem marca de fuso).
 */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const iso = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

/**
 * Texto de um arquivo: UTF-8 (com ou sem BOM); se não for UTF-8 válido, Windows-1252 (CSV antigo do Excel).
 * `truncated`: os bytes são só o começo do arquivo (pré-visualização). O corte pode cair no meio de um caractere
 * ("ç" = 2 bytes); sem descartar esse pedaço, o UTF-8 estrito falharia e o texto inteiro viraria "Ã§".
 */
export function decodeText(bytes: Uint8Array, options: { truncated?: boolean } = {}): string {
  const utf8 = options.truncated ? bytes.subarray(0, completeUtf8Length(bytes)) : bytes;
  try {
    // O TextDecoder já descarta o BOM do começo.
    return new TextDecoder("utf-8", { fatal: true }).decode(utf8);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Tamanho sem o caractere UTF-8 incompleto do fim (byte inicial seguido de menos continuações do que pede). */
function completeUtf8Length(bytes: Uint8Array): number {
  const end = bytes.length;
  for (let back = 1; back <= Math.min(4, end); back++) {
    const byte = bytes[end - back];
    if ((byte & 0xc0) === 0x80) continue; // continuação (10xxxxxx): o início do caractere está antes
    const needed = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return needed > back ? end - back : end;
  }
  return end;
}
