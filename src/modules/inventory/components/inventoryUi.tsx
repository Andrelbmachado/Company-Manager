// Peças comuns das telas de estoque: chaves de consulta, mensagens de erro, selo do tipo de movimentação e campos.
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, X } from "lucide-react";
import { StockError } from "@/lib/inventory/stock";
import { MOVEMENT_TYPE_LABELS } from "@/lib/inventory/queries";
import { cn } from "@/lib/utils";
import type { StockMovementType } from "@/types";

/** Todas as consultas do estoque começam com ["inventory", companyId]: invalidar o prefixo atualiza todas as telas. */
export const inventoryKeys = {
  all: (companyId: string) => ["inventory", companyId] as const,
  snapshot: (companyId: string) => ["inventory", companyId, "snapshot"] as const,
  movements: (companyId: string) => ["inventory", companyId, "movements"] as const,
  counts: (companyId: string) => ["inventory", companyId, "counts"] as const,
  count: (companyId: string, countId: string) => ["inventory", companyId, "count", countId] as const,
  reorder: (companyId: string) => ["inventory", companyId, "reorder"] as const,
  locations: (companyId: string) => ["inventory", companyId, "locations"] as const,
  custodies: (companyId: string) => ["inventory-custodies", companyId] as const,
};

/** Depois de mexer no estoque: telas do estoque, opções de item da custódia e indicadores do dashboard. */
export function useInvalidateInventory(companyId: string): (options?: { purchases?: boolean }) => void {
  const qc = useQueryClient();
  return (options) => {
    void qc.invalidateQueries({ queryKey: inventoryKeys.all(companyId) });
    void qc.invalidateQueries({ queryKey: ["inventory-options", companyId] });
    void qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
    if (options?.purchases) {
      // Pedidos de compra gerados pela reposição aparecem em Compras (chaves daquele módulo).
      void qc.invalidateQueries({ predicate: (query) => /purchas/i.test(String(query.queryKey[0])) });
    }
  };
}

/** Mensagem para a tela: a da regra de estoque ou um aviso genérico com o detalhe técnico. */
export function errorText(error: unknown): string {
  if (error instanceof StockError) return error.message;
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return detail ? `Não foi possível concluir: ${detail}` : "Não foi possível concluir a operação.";
}

/** Número digitado em pt-BR ("1.234,5" ou "2,5") ou com ponto ("2.5"); vazio → NaN. */
export function parseDecimal(text: string): number {
  const value = text.trim();
  if (!value) return Number.NaN;
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
  return Number(normalized);
}

export const INPUT = "h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
export const BUTTON_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50";
export const BUTTON_OUTLINE = "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50";

const TYPE_TONE: Record<StockMovementType, string> = {
  entrada: "bg-status-success text-white",
  saida: "bg-status-orange text-white",
  transferencia: "bg-status-info text-white",
  ajuste: "bg-status-violet text-white",
};

export function MovementTypeBadge({ type }: { type: StockMovementType }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", TYPE_TONE[type] ?? "bg-status-neutral text-white")}>
      {MOVEMENT_TYPE_LABELS[type] ?? type}
    </span>
  );
}

export function ErrorBanner({ message, onClose }: { message: string | null; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
      <AlertCircle size={16} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
      <p className="flex-1">{message}</p>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Fechar aviso" className="rounded p-0.5 text-muted-foreground hover:bg-muted">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-lg bg-muted/30" />
      ))}
    </div>
  );
}

export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
