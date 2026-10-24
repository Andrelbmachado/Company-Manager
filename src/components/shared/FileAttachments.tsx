import { Paperclip } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { cn } from "@/lib/utils";

export interface FileAttachmentsProps {
  /** Tipo da entidade dona dos anexos (documents.entity_type), ex.: "customer", "ticket", "invoice". */
  entityType: string;
  entityId: string;
  /** Pode enviar e remover anexos (a tela decide pelo RBAC do recurso). */
  canEdit?: boolean;
  className?: string;
}

/**
 * Anexos de um registro (documents com entity_type/entity_id, migration 0009). Contrato estável: as telas de detalhe já
 * podem usar; por enquanto mostra só o estado vazio, até o armazenamento de arquivos ser ligado aqui.
 */
export function FileAttachments(props: FileAttachmentsProps) {
  return (
    <section aria-label="Anexos" className={cn("rounded-lg border", props.className)} data-entity-type={props.entityType} data-entity-id={props.entityId}>
      <EmptyState
        icon={Paperclip}
        title="Anexos em breve"
        description={props.canEdit ? "Aqui você vai enviar, baixar e ver as versões dos arquivos deste registro." : "Os arquivos deste registro vão aparecer aqui."}
        className="py-8"
      />
    </section>
  );
}

export default FileAttachments;
