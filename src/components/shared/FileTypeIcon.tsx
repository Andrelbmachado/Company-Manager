import { File, FileArchive, FileImage, FileSpreadsheet, FileText, type LucideProps } from "lucide-react";
import { fileExtension } from "@/lib/files/format";

const SPREADSHEET = new Set(["xls", "xlsx", "csv", "ods", "ofx"]);
const ARCHIVE = new Set(["zip", "rar", "7z", "gz", "tar"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "heic"]);
const TEXT = new Set(["pdf", "doc", "docx", "odt", "txt", "md", "rtf", "json", "xml", "log"]);

/** Ícone pelo tipo do arquivo (extensão do título ou a coluna `type` dos registros antigos). */
export function FileTypeIcon({ name, fileType, ...props }: { name?: string | null; fileType?: string | null } & LucideProps) {
  const ext = fileExtension(name) || String(fileType ?? "").toLowerCase();
  const Icon = SPREADSHEET.has(ext) ? FileSpreadsheet : ARCHIVE.has(ext) ? FileArchive : IMAGE.has(ext) ? FileImage : TEXT.has(ext) ? FileText : File;
  return <Icon aria-hidden="true" {...props} />;
}
