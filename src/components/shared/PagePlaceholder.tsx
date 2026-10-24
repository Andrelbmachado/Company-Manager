import type { LucideIcon } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";

interface PagePlaceholderProps {
  title: string;
  description?: string;
  icon: LucideIcon;
  /** O que a tela vai fazer quando estiver pronta. */
  message: string;
}

/**
 * Página provisória de uma subpágina (src/app/subpages.ts): título da tela e aviso de que está em construção.
 * A tarefa do módulo troca o conteúdo da página; rota, aba e busca já funcionam.
 */
export function PagePlaceholder({ title, description, icon, message }: PagePlaceholderProps) {
  return (
    <div className="space-y-5">
      <PageHeader title={title} description={description} />
      <EmptyState icon={icon} title="Em construção" description={message} />
    </div>
  );
}
