// Salvar um arquivo gerado (PDF da proposta): no app desktop pede o destino com o diálogo "Salvar como" (o diálogo libera
// esse caminho para o plugin fs); no navegador, baixa pelo link de download.
// TODO(integração): trocar por downloadFile de src/lib/files/store.ts (Tarefa 6) quando os branches se juntarem.
import { isTauriRuntime } from "@/lib/db/client";

export async function saveBlob(blob: Blob, fileName: string, filter: { name: string; extensions: string[] } = { name: "PDF", extensions: ["pdf"] }): Promise<string | null> {
  if (isTauriRuntime()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: fileName, filters: [filter] });
    if (!path) return null;
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return path;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return fileName;
}
