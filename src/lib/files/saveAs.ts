// "Salvar como" único do app para qualquer arquivo que vai para o disco da pessoa: documento guardado (downloadFile),
// PDF da proposta, exportação/modelo/relatório de erros da importação e relatórios. No app desktop abre o diálogo
// Salvar do sistema (o caminho escolhido fica liberado para o plugin-fs) e grava lá; no navegador, download comum.
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { isTauriRuntime } from "@/lib/db/client";

export interface SaveAsOptions {
  /** Título da janela do diálogo (só no desktop). */
  title?: string;
  /** Tipos oferecidos no diálogo (só no desktop). */
  filters?: { name: string; extensions: string[] }[];
}

/** Bytes de um Blob/File (FileReader quando o ambiente não tem Blob.arrayBuffer, como o jsdom e WebViews antigas). */
export async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler o arquivo."));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Salva o Blob com o nome sugerido. Desktop: devolve o caminho gravado, ou null se a pessoa cancelou o diálogo.
 * Navegador: dispara o download e devolve o nome.
 */
export async function saveBlobAs(blob: Blob, fileName: string, options: SaveAsOptions = {}): Promise<string | null> {
  if (isTauriRuntime()) {
    const target = await save({
      ...(options.title ? { title: options.title } : {}),
      defaultPath: fileName,
      ...(options.filters?.length ? { filters: options.filters } : {}),
    });
    if (!target) return null;
    await writeFile(target, await readBlobBytes(blob));
    return target;
  }
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoga depois: alguns navegadores ainda leem o blob logo após o clique.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return fileName;
}
