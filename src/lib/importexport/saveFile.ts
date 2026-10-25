// Salvar o arquivo gerado (exportação, modelo, relatório de erros) pelo "Salvar como" único do app
// (src/lib/files/saveAs.ts): diálogo do sistema no desktop, download comum no navegador.
import { saveBlobAs } from "@/lib/files/saveAs";

const FILTERS: Record<string, { name: string; extensions: string[] }> = {
  csv: { name: "CSV (separado por ponto e vírgula)", extensions: ["csv"] },
  xlsx: { name: "Excel", extensions: ["xlsx"] },
};

/** Salva o Blob com o nome sugerido. Devolve false se a pessoa cancelou o "Salvar como". */
export async function saveBlob(blob: Blob, filename: string): Promise<boolean> {
  const extension = /\.([^.]+)$/.exec(filename)?.[1]?.toLowerCase() ?? "";
  return (await saveBlobAs(blob, filename, { filters: FILTERS[extension] ? [FILTERS[extension]] : undefined })) !== null;
}
