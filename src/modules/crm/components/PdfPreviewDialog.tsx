import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { saveBlobAs } from "@/lib/files/saveAs";
import { buildProposalPdf, loadProposalDocument, proposalFileName } from "@/lib/crm/proposalPdf";
import { BTN_PRIMARY, BTN_SECONDARY } from "./ui";
import { errorText, Modal } from "./Modal";
import { useCrmSession } from "./useCrm";

/** Gera o PDF da proposta (dados atuais) com o nome de arquivo sugerido. */
export async function proposalPdfFile(companyId: string, proposalId: string): Promise<{ blob: Blob; fileName: string }> {
  const doc = await loadProposalDocument(await getDb(), companyId, proposalId);
  return { blob: new Blob([buildProposalPdf(doc)], { type: "application/pdf" }), fileName: proposalFileName(doc) };
}

/** Pré-visualização do PDF da proposta, com o botão de salvar. */
export function PdfPreviewDialog({ proposalId, onClose }: { proposalId: string; onClose: () => void }) {
  const { companyId } = useCrmSession();
  const { data, error, isLoading } = useQuery({
    queryKey: ["proposal-pdf", companyId, proposalId],
    queryFn: () => proposalPdfFile(companyId, proposalId),
    gcTime: 0,
    staleTime: 0,
  });
  // A URL nasce e morre no mesmo efeito (no StrictMode o efeito roda duas vezes; uma URL de useMemo seria revogada em uso).
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const next = URL.createObjectURL(data.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [data]);
  const [saved, setSaved] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => (data ? saveBlobAs(data.blob, data.fileName, { filters: [{ name: "PDF", extensions: ["pdf"] }] }) : null),
    onSuccess: (path) => setSaved(path),
  });

  return (
    <Modal
      title="PDF da proposta"
      description={data?.fileName}
      size="xl"
      onClose={onClose}
      footer={
        <>
          {saved && <span className="mr-auto self-center text-sm text-muted-foreground">Salvo: {saved}</span>}
          {save.error && <span role="alert" className="mr-auto self-center text-sm text-destructive">{errorText(save.error)}</span>}
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>Fechar</button>
          <button type="button" onClick={() => save.mutate()} disabled={!data || save.isPending} className={BTN_PRIMARY}>
            <Download size={14} /> Baixar PDF
          </button>
        </>
      }
    >
      {isLoading ? (
        <div className="h-[60vh] animate-pulse rounded-lg bg-muted/30" />
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">{errorText(error)}</p>
      ) : url ? (
        <iframe src={url} title="Pré-visualização do PDF da proposta" className="h-[65vh] w-full rounded-lg border bg-white" />
      ) : null}
    </Modal>
  );
}
