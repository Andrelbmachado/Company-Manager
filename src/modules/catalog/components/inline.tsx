// Peças das telas comerciais (catálogo, vendas, CRM, prospecção) depois da Tarefa 6 do redesign: os detalhes que antes
// abriam numa gaveta aparecem num painel na própria página, logo abaixo da tabela; e a atualização que a
// EditableTable espera (onRefresh devolve a promessa da recarga).
import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useRequiredSession } from "@/hooks/useSession";
import type { EditActor } from "@/lib/commercial/guard";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";
import { TRADE_QUERY_ROOTS } from "./tradeKit";

/** Grade de rótulo + valor do painel de detalhes. */
export function InfoGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>{children}</div>;
}

export function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm">{value === null || value === undefined || value === "" ? "—" : value}</div>
    </div>
  );
}

/** Painel de detalhes na página (não é diálogo): título, ações e um botão de fechar. */
export function InlinePanel({ title, subtitle, actions, onClose, children, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; onClose?: () => void; children: ReactNode; className?: string }) {
  const label = typeof title === "string" ? title : undefined;
  return (
    <section aria-label={label ? `Detalhes: ${label}` : "Detalhes"} className={cn("space-y-4 rounded-xl border bg-card p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {onClose && (
            <button type="button" aria-label="Fechar detalhes" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Botão pequeno das ações de linha da EditableTable. */
export const ROW_ACTION = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50";
export const ROW_DANGER = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50";

/** Recarrega as consultas das raízes dadas e espera terminar (o onRefresh da EditableTable). */
export async function refreshQueries(qc: QueryClient, roots: readonly string[]): Promise<void> {
  await Promise.all(roots.map((root) => qc.invalidateQueries({ queryKey: [root] })));
}

/** onRefresh das tabelas de catálogo, vendas e compras: recarrega tudo do comércio (como invalidateTrade) e espera. */
export function refreshTrade(qc: QueryClient): Promise<void> {
  return refreshQueries(qc, TRADE_QUERY_ROOTS);
}

/** Quem grava pelas tabelas (papel da sessão para a permissão na camada de dados). */
export function useEditActor(): EditActor {
  const session = useRequiredSession();
  return { role: session.membership.role as Role, userId: session.user.id };
}
