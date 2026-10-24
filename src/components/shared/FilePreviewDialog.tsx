import { useEffect, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { decodeText, formatBytes, previewKind, previewMime } from "@/lib/files/format";
import { describeFileError, downloadFile, openFile, readBlobBytes } from "@/lib/files/store";
import type { DocumentRow } from "@/types";
import { useModalFocus } from "./useModalFocus";

/** Texto mostrado na pré-visualização (o resto só baixando). */
const TEXT_PREVIEW_BYTES = 256 * 1024;

type Loaded = { status: "loading" } | { status: "error"; message: string } | { status: "url"; url: string } | { status: "text"; text: string; truncated: boolean };

/**
 * Pré-visualização de PDF, imagem e texto. O blob ganha o tipo da pré-visualização (nunca o informado pelo arquivo),
 * então um HTML disfarçado de .pdf não roda como página dentro do app.
 */
export function FilePreviewDialog({ doc, onClose }: { doc: DocumentRow; onClose: () => void }) {
  const panel = useModalFocus<HTMLDivElement>(onClose);
  const kind = previewKind(doc);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    if (!kind) {
      setLoaded({ status: "error", message: "Este tipo de arquivo não tem pré-visualização. Use Baixar." });
      return;
    }
    setLoaded({ status: "loading" });
    (async () => {
      try {
        const blob = await openFile(doc);
        if (kind === "text") {
          const bytes = await readBlobBytes(blob);
          if (!cancelled) setLoaded({ status: "text", text: decodeText(bytes.subarray(0, TEXT_PREVIEW_BYTES)), truncated: bytes.byteLength > TEXT_PREVIEW_BYTES });
          return;
        }
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([blob], { type: previewMime(kind, doc) }));
        setLoaded({ status: "url", url });
      } catch (error) {
        if (!cancelled) setLoaded({ status: "error", message: describeFileError(error) });
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc, kind]);

  async function download() {
    setDownloadError(null);
    try {
      await downloadFile(doc);
    } catch (error) {
      setDownloadError(describeFileError(error));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Pré-visualização: ${doc.title}`}
        className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{doc.title}</h2>
            <p className="text-xs text-muted-foreground">
              {[doc.type, `v${doc.version}`, doc.size_bytes ? formatBytes(doc.size_bytes) : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={download} disabled={!doc.storage_key} className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50">
              <Download size={14} aria-hidden="true" /> Baixar
            </button>
            <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-2 text-muted-foreground hover:bg-muted"><X size={17} /></button>
          </div>
        </div>
        {downloadError && <p role="alert" className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">{downloadError}</p>}
        <div className="min-h-0 flex-1 overflow-auto bg-muted/30">
          {loaded.status === "loading" && (
            <p className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Carregando arquivo…</p>
          )}
          {loaded.status === "error" && <p role="alert" className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">{loaded.message}</p>}
          {loaded.status === "url" && kind === "image" && (
            <div className="flex h-full items-center justify-center p-4"><img src={loaded.url} alt={doc.title} className="max-h-full max-w-full object-contain" /></div>
          )}
          {loaded.status === "url" && kind === "pdf" && <iframe src={loaded.url} title={doc.title} className="h-full w-full bg-white" />}
          {loaded.status === "text" && (
            <div className="p-4">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{loaded.text}</pre>
              {loaded.truncated && <p className="mt-3 text-xs text-muted-foreground">Mostrando os primeiros {formatBytes(TEXT_PREVIEW_BYTES)}. Baixe o arquivo para ver tudo.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
