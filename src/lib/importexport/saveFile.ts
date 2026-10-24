// Salvar o arquivo gerado (exportação, modelo, relatório de erros): no app desktop abre o "Salvar como" do sistema
// (o caminho escolhido entra no escopo do plugin-fs); no navegador, download comum.
import { isTauriRuntime } from "@/lib/db/client";
import { readBytes } from "./parse";

const FILTERS: Record<string, { name: string; extensions: string[] }> = {
  csv: { name: "CSV (separado por ponto e vírgula)", extensions: ["csv"] },
  xlsx: { name: "Excel", extensions: ["xlsx"] },
};

/** Salva o Blob com o nome sugerido. Devolve false se a pessoa cancelou o "Salvar como". */
export async function saveBlob(blob: Blob, filename: string): Promise<boolean> {
  if (isTauriRuntime()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const extension = /\.([^.]+)$/.exec(filename)?.[1]?.toLowerCase() ?? "";
    const path = await save({ defaultPath: filename, filters: FILTERS[extension] ? [FILTERS[extension]] : undefined });
    if (!path) return false;
    await writeFile(path, await readBytes(blob));
    return true;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoga depois: alguns navegadores ainda leem o blob logo após o clique.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
