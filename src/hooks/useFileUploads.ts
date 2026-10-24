import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { describeFileError, sanitizeFileName, saveFile, type SaveFileMeta } from "@/lib/files/store";
import type { DocumentRow } from "@/types";

export interface UploadSummary {
  saved: DocumentRow[];
  failed: { name: string; message: string }[];
}

/**
 * Envio de vários arquivos, um por vez (a numeração de versões depende da ordem). Um arquivo recusado não impede os
 * outros: o resumo traz os gravados e os recusados com o motivo. Invalida ["documents", companyId] no fim.
 */
export function useFileUploads({ companyId, userId }: { companyId: string; userId: string }) {
  const qc = useQueryClient();
  const [summary, setSummary] = useState<UploadSummary | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ files, meta }: { files: File[]; meta: Omit<SaveFileMeta, "userId"> }): Promise<UploadSummary> => {
      const result: UploadSummary = { saved: [], failed: [] };
      for (const file of files) {
        try {
          result.saved.push(await saveFile(companyId, file, { ...meta, userId }));
        } catch (error) {
          result.failed.push({ name: sanitizeFileName(file.name), message: describeFileError(error) });
        }
      }
      return result;
    },
    onMutate: () => setSummary(null),
    onSuccess: setSummary,
    onError: (error) => setSummary({ saved: [], failed: [{ name: "Envio", message: describeFileError(error) }] }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["documents", companyId] }),
  });

  return {
    upload: (files: Iterable<File> | ArrayLike<File>, meta: Omit<SaveFileMeta, "userId"> = {}) => {
      const list = Array.from(files);
      if (list.length > 0) mutation.mutate({ files: list, meta });
    },
    uploadAsync: (files: Iterable<File> | ArrayLike<File>, meta: Omit<SaveFileMeta, "userId"> = {}) => mutation.mutateAsync({ files: Array.from(files), meta }),
    busy: mutation.isPending,
    summary,
    clear: () => setSummary(null),
  };
}
